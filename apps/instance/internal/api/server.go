// Package api wires the instance HTTP routes:
//
//	GET  /health   — unauthenticated liveness probe + tooling versions.
//	POST /info     — HMAC-protected; runs yt-dlp metadata for a URL.
//	POST /stream   — HMAC-protected; pipes yt-dlp → ffmpeg fMP4 → response.
//
// All handler bodies are JSON. Cookies arrive as a JSON array on the body and
// are written to a 0600 temp Netscape file for the duration of the handler.
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os/exec"
	"strings"
	"sync/atomic"
	"time"

	"github.com/e2kmovie-max/wave-player/apps/instance/internal/auth"
	"github.com/e2kmovie-max/wave-player/apps/instance/internal/cookies"
	"github.com/e2kmovie-max/wave-player/apps/instance/internal/streamer"
	"github.com/e2kmovie-max/wave-player/apps/instance/internal/version"
)

// Config is the runtime configuration for the HTTP server.
type Config struct {
	Verifier         *auth.Verifier
	YTDLPBinary      string
	FFmpegBinary     string
	StreamlinkBinary string
	StartedAt        time.Time
	MaxStreams       int32 // 0 ⇒ no cap

	// ThrottledRateBytesPerSecond, when > 0, is forwarded to yt-dlp via
	// --throttled-rate so a single slow client cannot starve the rest of
	// the instance.
	ThrottledRateBytesPerSecond int

	// UseStreamlinkForTwitch routes Twitch URLs through streamlink instead
	// of yt-dlp. Default true when StreamlinkBinary resolves on PATH.
	UseStreamlinkForTwitch bool

	// EnableTwitchAdSkip toggles streamlink's --twitch-disable-ads flag.
	EnableTwitchAdSkip bool
}

// Server is an http.Handler that owns the instance state.
type Server struct {
	cfg     Config
	mux     *http.ServeMux
	active  atomic.Int32
	infoVer atomic.Pointer[toolVersions]
}

type toolVersions struct {
	YTDLP      string `json:"ytDlp"`
	FFmpeg     string `json:"ffmpeg"`
	Streamlink string `json:"streamlink,omitempty"`
}

// New constructs the HTTP handler.
func New(cfg Config) *Server {
	if cfg.YTDLPBinary == "" {
		cfg.YTDLPBinary = "yt-dlp"
	}
	if cfg.FFmpegBinary == "" {
		cfg.FFmpegBinary = "ffmpeg"
	}
	if cfg.StartedAt.IsZero() {
		cfg.StartedAt = time.Now().UTC()
	}
	s := &Server{cfg: cfg, mux: http.NewServeMux()}
	s.routes()
	s.refreshToolVersions()
	// Auto-enable Twitch→streamlink routing if streamlink is present on PATH
	// and the caller did not explicitly opt out. This lets operators just
	// `apt install streamlink` to get faster Twitch playback.
	if s.cfg.StreamlinkBinary == "" {
		if p, err := exec.LookPath("streamlink"); err == nil {
			s.cfg.StreamlinkBinary = p
		}
	}
	if s.cfg.StreamlinkBinary != "" && !s.cfg.UseStreamlinkForTwitch {
		s.cfg.UseStreamlinkForTwitch = true
	}
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	if s.cfg.Verifier == nil {
		// Without a verifier we still register the routes but reject everything;
		// this is only meant for unit tests.
		s.mux.HandleFunc("POST /info", reject)
		s.mux.HandleFunc("POST /stream", reject)
		return
	}
	s.mux.Handle("POST /info", s.cfg.Verifier.Middleware(http.HandlerFunc(s.handleInfo)))
	s.mux.Handle("POST /stream", s.cfg.Verifier.Middleware(http.HandlerFunc(s.handleStream)))
}

func reject(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "instance secret not configured", http.StatusServiceUnavailable)
}

// handleHealth is unauthenticated by design — the master pings it without
// signing because the response carries no cookies and no per-room data.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	versions := s.infoVer.Load()
	if versions == nil {
		versions = &toolVersions{}
	}
	resp := map[string]any{
		"ok":            true,
		"version":       version.Version,
		"startedAt":     s.cfg.StartedAt.Format(time.RFC3339),
		"uptimeSeconds": int64(time.Since(s.cfg.StartedAt).Seconds()),
		"activeStreams": s.active.Load(),
		"maxStreams":    s.cfg.MaxStreams,
		"tools":         versions,
	}
	writeJSON(w, http.StatusOK, resp)
}

type infoRequest struct {
	URL       string            `json:"url"`
	UserAgent string            `json:"userAgent,omitempty"`
	Cookies   []cookies.Cookie  `json:"cookies,omitempty"`
}

func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	var req infoRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, streamer.ErrorCodeUnknown, "invalid json: "+err.Error())
		return
	}
	if err := streamer.ValidateSourceURL(req.URL); err != nil {
		writeError(w, http.StatusBadRequest, streamer.ErrorCodeUnknown, err.Error())
		return
	}

	cookieFile, err := cookies.Write(req.Cookies)
	if err != nil {
		writeError(w, http.StatusBadRequest, streamer.ErrorCodeUnknown, "write cookies: "+err.Error())
		return
	}
	defer cookieFile.Remove()

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	info, err := streamer.FetchInfo(ctx, streamer.InfoOptions{
		URL:         req.URL,
		CookiesFile: cookieFilePath(cookieFile),
		UserAgent:   req.UserAgent,
		YTDLPBinary: s.cfg.YTDLPBinary,
	})
	if err != nil {
		if pe := streamer.AsPipelineError(err); pe != nil {
			writeError(w, pe.Code.HTTPStatus(), pe.Code, pe.Message)
			return
		}
		writeError(w, http.StatusBadGateway, streamer.ErrorCodeUnknown, "yt-dlp: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, info)
}

type streamRequest struct {
	URL       string            `json:"url"`
	FormatID  string            `json:"formatId,omitempty"`
	UserAgent string            `json:"userAgent,omitempty"`
	Cookies   []cookies.Cookie  `json:"cookies,omitempty"`
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	if max := s.cfg.MaxStreams; max > 0 && s.active.Load() >= max {
		writeError(w, http.StatusServiceUnavailable, streamer.ErrorCodeUnknown, "instance is at max streams")
		return
	}

	var req streamRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, streamer.ErrorCodeUnknown, "invalid json: "+err.Error())
		return
	}
	if err := streamer.ValidateSourceURL(req.URL); err != nil {
		writeError(w, http.StatusBadRequest, streamer.ErrorCodeUnknown, err.Error())
		return
	}

	cookieFile, err := cookies.Write(req.Cookies)
	if err != nil {
		writeError(w, http.StatusBadRequest, streamer.ErrorCodeUnknown, "write cookies: "+err.Error())
		return
	}
	defer cookieFile.Remove()

	s.active.Add(1)
	defer s.active.Add(-1)

	flusher, _ := w.(http.Flusher)
	headerOnce := &headerOnceWriter{
		w:       w,
		flusher: flusher,
		writeHeader: func() {
			w.Header().Set("Content-Type", "video/mp4")
			w.Header().Set("Cache-Control", "no-store")
		},
	}

	var result streamer.PipelineResult
	if s.cfg.UseStreamlinkForTwitch && s.cfg.StreamlinkBinary != "" && streamer.IsTwitchURL(req.URL) {
		result = streamer.PipelineStreamlink(r.Context(), headerOnce, streamer.StreamlinkOptions{
			URL:              req.URL,
			Quality:          twitchQuality(req.FormatID),
			StreamlinkBinary: s.cfg.StreamlinkBinary,
			FFmpegBinary:     s.cfg.FFmpegBinary,
			UserAgent:        req.UserAgent,
			DisableAds:       s.cfg.EnableTwitchAdSkip,
		})
	} else {
		result = streamer.Pipeline(r.Context(), headerOnce, streamer.StreamOptions{
			URL:                         req.URL,
			FormatID:                    req.FormatID,
			CookiesFile:                 cookieFilePath(cookieFile),
			UserAgent:                   req.UserAgent,
			YTDLPBinary:                 s.cfg.YTDLPBinary,
			FFmpegBinary:                s.cfg.FFmpegBinary,
			ThrottledRateBytesPerSecond: s.cfg.ThrottledRateBytesPerSecond,
		})
	}

	if result.Err != nil && result.BytesOut == 0 {
		// Nothing has been flushed yet, so we can still return a JSON error.
		writeError(w, result.Err.Code.HTTPStatus(), result.Err.Code, result.Err.Message)
		return
	}
	// Otherwise the response has already been started — we can only stop
	// writing. The client sees a truncated MP4 and the master will surface a
	// best-effort error on the next /info or /health.
}

func cookieFilePath(f *cookies.File) string {
	if f == nil {
		return ""
	}
	return f.Path
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// headerOnceWriter defers committing the HTTP status (and the streaming
// Content-Type headers) until the pipeline actually produces bytes. This lets
// /stream return a JSON error response when yt-dlp fails before producing
// anything — and behave exactly like the old flushingWriter once the body
// starts flowing.
type headerOnceWriter struct {
	w           http.ResponseWriter
	flusher     http.Flusher
	writeHeader func()
	once        bool
}

func (hw *headerOnceWriter) Write(p []byte) (int, error) {
	if !hw.once {
		hw.once = true
		if hw.writeHeader != nil {
			hw.writeHeader()
		}
	}
	n, err := hw.w.Write(p)
	if hw.flusher != nil && n > 0 {
		hw.flusher.Flush()
	}
	return n, err
}

// writeError serialises a JSON error body that the master parses to decide on
// rotation and retries. The shape — { error, errorCode } — is stable across
// versions; new codes are added without breaking older masters.
func writeError(w http.ResponseWriter, status int, code streamer.ErrorCode, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	payload := map[string]string{
		"error":     message,
		"errorCode": string(code),
	}
	_ = json.NewEncoder(w).Encode(payload)
}

// refreshToolVersions probes yt-dlp, ffmpeg and (when configured) streamlink
// once at startup and stores the strings for /health to report.
func (s *Server) refreshToolVersions() {
	v := &toolVersions{}
	if out, err := exec.Command(s.cfg.YTDLPBinary, "--version").Output(); err == nil {
		v.YTDLP = strings.TrimSpace(string(out))
	}
	if out, err := exec.Command(s.cfg.FFmpegBinary, "-version").Output(); err == nil {
		// "ffmpeg version N.N.N Copyright …" – take the first line.
		first, _, _ := strings.Cut(string(out), "\n")
		v.FFmpeg = strings.TrimSpace(first)
	}
	if s.cfg.StreamlinkBinary != "" {
		if out, err := exec.Command(s.cfg.StreamlinkBinary, "--version").Output(); err == nil {
			first, _, _ := strings.Cut(string(out), "\n")
			v.Streamlink = strings.TrimSpace(first)
		}
	}
	s.infoVer.Store(v)
}

// decodeJSON reads an HMAC-verified body (already bounded by auth.MaxSignedBodyBytes)
// and rejects unknown fields so a misbehaving master cannot smuggle data the
// instance silently ignores.
func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

// twitchQuality maps an opaque formatId (passed through from the master) into
// a streamlink quality token. Streamlink does not understand yt-dlp format
// strings, so unrecognised inputs fall back to "best".
func twitchQuality(formatID string) string {
	switch strings.ToLower(strings.TrimSpace(formatID)) {
	case "", "best", "bestvideo", "bestvideo+bestaudio":
		return "best"
	case "worst":
		return "worst"
	}
	// Pass-through for explicit twitch quality tokens like "720p60" or "audio_only".
	// Keep it ASCII-only as a tiny defensive measure against shell-quoting bugs.
	for _, r := range formatID {
		if r < 0x20 || r > 0x7e || r == ' ' {
			return "best"
		}
	}
	return formatID
}
