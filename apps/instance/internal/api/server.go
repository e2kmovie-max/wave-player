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
	Verifier      *auth.Verifier
	YTDLPBinary   string
	FFmpegBinary  string
	StartedAt     time.Time
	MaxStreams    int32 // 0 ⇒ no cap
}

// Server is an http.Handler that owns the instance state.
type Server struct {
	cfg     Config
	mux     *http.ServeMux
	active  atomic.Int32
	infoVer atomic.Pointer[toolVersions]
}

type toolVersions struct {
	YTDLP  string `json:"ytDlp"`
	FFmpeg string `json:"ffmpeg"`
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, streamer.ErrorCodeUnknown, "invalid json: "+err.Error())
		return
	}
	if strings.TrimSpace(req.URL) == "" {
		writeError(w, http.StatusBadRequest, streamer.ErrorCodeUnknown, "url is required")
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, streamer.ErrorCodeUnknown, "invalid json: "+err.Error())
		return
	}
	if strings.TrimSpace(req.URL) == "" {
		writeError(w, http.StatusBadRequest, streamer.ErrorCodeUnknown, "url is required")
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

	result := streamer.Pipeline(r.Context(), headerOnce, streamer.StreamOptions{
		URL:          req.URL,
		FormatID:     req.FormatID,
		CookiesFile:  cookieFilePath(cookieFile),
		UserAgent:    req.UserAgent,
		YTDLPBinary:  s.cfg.YTDLPBinary,
		FFmpegBinary: s.cfg.FFmpegBinary,
	})

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

// refreshToolVersions probes yt-dlp and ffmpeg once at startup and stores the
// strings for /health to report.
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
	s.infoVer.Store(v)
}
