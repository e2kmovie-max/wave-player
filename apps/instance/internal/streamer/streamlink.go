package streamer

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os/exec"
	"strings"
)

// IsTwitchURL returns true when the URL is a Twitch live or VOD link that we
// would rather hand to streamlink than to yt-dlp.
//
// Streamlink is more robust for Twitch in two specific ways the watch-party
// flow runs into:
//
//   - It picks low-latency HLS by default and handles ad-rolls without
//     reshuffling the playlist mid-stream (yt-dlp tends to abort).
//   - It honours --twitch-disable-ads and OAuth-style headers cleanly.
//
// Anything else (YouTube, VK, anime sites, etc.) stays on yt-dlp where the
// extractor ecosystem is biggest.
func IsTwitchURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u == nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	host = strings.TrimPrefix(host, "www.")
	return host == "twitch.tv" || strings.HasSuffix(host, ".twitch.tv")
}

// StreamlinkOptions describes a single streamlink → ffmpeg pipeline run.
type StreamlinkOptions struct {
	URL              string
	Quality          string // e.g. "best", "720p60" — empty defaults to "best"
	StreamlinkBinary string // defaults to "streamlink"
	FFmpegBinary     string // defaults to "ffmpeg"
	OAuthToken       string // optional Twitch OAuth token
	DisableAds       bool   // pass --twitch-disable-ads
	UserAgent        string // forwarded to streamlink via --http-header
}

// PipelineStreamlink runs streamlink (Twitch) piped through ffmpeg to remux
// the HLS feed into fragmented MP4 — same downstream contract as Pipeline,
// so the master node treats Twitch and YouTube alike.
//
// streamlink writes the raw segments to stdout; ffmpeg reads them on stdin,
// performs a stream copy (no re-encode) and emits frag-MP4.
func PipelineStreamlink(ctx context.Context, dst io.Writer, opts StreamlinkOptions) PipelineResult {
	if dst == nil {
		return PipelineResult{Err: &PipelineError{
			Code:    ErrorCodeUnknown,
			Wrapped: errors.New("nil writer"),
		}}
	}
	if err := ValidateSourceURL(opts.URL); err != nil {
		return PipelineResult{Err: &PipelineError{
			Code:    ErrorCodeUnknown,
			Message: err.Error(),
			Wrapped: err,
		}}
	}
	if !IsTwitchURL(opts.URL) {
		return PipelineResult{Err: &PipelineError{
			Code:    ErrorCodeUnknown,
			Message: "streamlink pipeline is twitch-only",
			Wrapped: errors.New("non-twitch URL"),
		}}
	}

	slBin := opts.StreamlinkBinary
	if slBin == "" {
		slBin = "streamlink"
	}
	ffBin := opts.FFmpegBinary
	if ffBin == "" {
		ffBin = "ffmpeg"
	}
	quality := strings.TrimSpace(opts.Quality)
	if quality == "" {
		quality = "best"
	}

	slArgs := []string{
		"--stdout",
		"--quiet",
		"--retry-streams", "1",
		"--retry-max", "2",
		"--hls-live-restart",
	}
	if opts.DisableAds {
		slArgs = append(slArgs, "--twitch-disable-ads")
	}
	if opts.OAuthToken != "" {
		slArgs = append(slArgs, "--twitch-api-header", "Authorization=OAuth "+opts.OAuthToken)
	}
	if opts.UserAgent != "" {
		slArgs = append(slArgs, "--http-header", "User-Agent="+opts.UserAgent)
	}
	slArgs = append(slArgs, "--", opts.URL, quality)

	slCmd := exec.CommandContext(ctx, slBin, slArgs...) //nolint:gosec // args sanitized via ValidateSourceURL + quality whitelist
	slStdout, err := slCmd.StdoutPipe()
	if err != nil {
		return PipelineResult{Err: &PipelineError{
			Code:    ErrorCodeUnknown,
			Wrapped: fmt.Errorf("streamlink stdout pipe: %w", err),
		}}
	}
	var slStderr bytes.Buffer
	slCmd.Stderr = &slStderr

	ffArgs := []string{
		"-hide_banner",
		"-loglevel", "error",
		"-i", "pipe:0",
		"-c", "copy",
		"-f", "mp4",
		"-movflags", "frag_keyframe+empty_moov+default_base_moof",
		"pipe:1",
	}
	ffCmd := exec.CommandContext(ctx, ffBin, ffArgs...) //nolint:gosec
	ffCmd.Stdin = slStdout
	counter := &countingWriter{w: dst}
	ffCmd.Stdout = counter
	ffCmd.Stderr = io.Discard

	if err := slCmd.Start(); err != nil {
		return PipelineResult{Err: &PipelineError{
			Code:    ErrorCodeUnknown,
			Wrapped: fmt.Errorf("start streamlink: %w", err),
		}}
	}
	if err := ffCmd.Start(); err != nil {
		_ = slCmd.Process.Kill()
		_, _ = slCmd.Process.Wait()
		return PipelineResult{Err: &PipelineError{
			Code:    ErrorCodeUnknown,
			Wrapped: fmt.Errorf("start ffmpeg: %w", err),
		}}
	}

	ffErr := ffCmd.Wait()
	if slCmd.ProcessState == nil {
		_ = slCmd.Process.Kill()
	}
	slErr := slCmd.Wait()

	res := PipelineResult{BytesOut: counter.n.Load()}

	if ctx.Err() != nil {
		return res
	}

	if slErr != nil && !isExpectedExit(slErr) {
		code, msg := ClassifyStreamlinkError(slErr, slStderr.String())
		res.Err = &PipelineError{
			Code:     code,
			Message:  msg,
			Wrapped:  fmt.Errorf("streamlink: %w", slErr),
			BytesOut: res.BytesOut,
		}
		return res
	}
	if ffErr != nil {
		res.Err = &PipelineError{
			Code:     ErrorCodeUnknown,
			Message:  "ffmpeg failed",
			Wrapped:  fmt.Errorf("ffmpeg: %w", ffErr),
			BytesOut: res.BytesOut,
		}
		return res
	}
	return res
}

// ClassifyStreamlinkError boils streamlink stderr down to one of our generic
// ErrorCode values. Streamlink does not have rich exit codes; we mostly rely
// on its stderr messages.
func ClassifyStreamlinkError(_ error, stderr string) (ErrorCode, string) {
	msg := firstNonEmptyLine(stderr)
	if msg == "" {
		msg = "streamlink failed"
	}
	lower := strings.ToLower(stderr)
	switch {
	case strings.Contains(lower, "no playable streams"),
		strings.Contains(lower, "stream is offline"):
		return ErrorCodeUnavailable, msg
	case strings.Contains(lower, "forbidden"),
		strings.Contains(lower, "subscriber-only"):
		return ErrorCodeForbidden, msg
	case strings.Contains(lower, "rate limit"),
		strings.Contains(lower, "too many requests"):
		return ErrorCodeRateLimited, msg
	}
	return ErrorCodeUnknown, msg
}

func firstNonEmptyLine(s string) string {
	for _, line := range strings.Split(s, "\n") {
		if t := strings.TrimSpace(line); t != "" {
			return t
		}
	}
	return ""
}
