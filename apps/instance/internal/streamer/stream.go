package streamer

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os/exec"
	"sync/atomic"
)

// StreamOptions describes a single streaming request.
type StreamOptions struct {
	URL          string
	FormatID     string // optional; "" lets yt-dlp pick best
	CookiesFile  string // optional Netscape file path
	UserAgent    string
	YTDLPBinary  string // defaults to "yt-dlp"
	FFmpegBinary string // defaults to "ffmpeg"
}

// PipelineResult summarises what happened during a Pipeline run. BytesOut is
// the number of bytes the pipeline wrote to dst. Err (if non-nil) is the
// classified PipelineError — callers should only return JSON / fail the
// request when BytesOut == 0; once any bytes have been flushed, the HTTP
// status has been committed and the best we can do is log.
type PipelineResult struct {
	BytesOut int64
	Err      *PipelineError
}

// Pipeline runs yt-dlp piped through ffmpeg, remuxing the stream to fragmented
// MP4 (suitable for streaming over HTTP without seek). Output is written to
// dst as it becomes available.
//
// The function blocks until either: ffmpeg finishes (in which case the
// underlying yt-dlp may still be wrapping up — it will be cleaned up on
// context cancel), the context is cancelled, or any of the processes errors.
//
// Layout:
//
//	yt-dlp --cookies <file> -o - -f <fmt> -- <url>  ──>  ffmpeg -i pipe: ... pipe:1  ──>  dst
func Pipeline(ctx context.Context, dst io.Writer, opts StreamOptions) PipelineResult {
	if dst == nil {
		return PipelineResult{Err: &PipelineError{
			Code:    ErrorCodeUnknown,
			Wrapped: errors.New("nil writer"),
		}}
	}
	if _, err := url.ParseRequestURI(opts.URL); err != nil {
		return PipelineResult{Err: &PipelineError{
			Code:    ErrorCodeUnknown,
			Message: "invalid url",
			Wrapped: fmt.Errorf("invalid url: %w", err),
		}}
	}

	ytdlpBin := opts.YTDLPBinary
	if ytdlpBin == "" {
		ytdlpBin = "yt-dlp"
	}
	ffmpegBin := opts.FFmpegBinary
	if ffmpegBin == "" {
		ffmpegBin = "ffmpeg"
	}

	ytArgs := []string{
		"-o", "-",
		"--no-warnings",
		"--no-playlist",
		"--no-progress",
		"--quiet",
	}
	if opts.FormatID != "" {
		ytArgs = append(ytArgs, "-f", opts.FormatID)
	}
	if opts.CookiesFile != "" {
		ytArgs = append(ytArgs, "--cookies", opts.CookiesFile)
	}
	if opts.UserAgent != "" {
		ytArgs = append(ytArgs, "--user-agent", opts.UserAgent)
	}
	ytArgs = append(ytArgs, "--", opts.URL)

	ytCmd := exec.CommandContext(ctx, ytdlpBin, ytArgs...) //nolint:gosec
	ytStdout, err := ytCmd.StdoutPipe()
	if err != nil {
		return PipelineResult{Err: &PipelineError{
			Code:    ErrorCodeUnknown,
			Wrapped: fmt.Errorf("ytdlp stdout pipe: %w", err),
		}}
	}
	var ytStderr bytes.Buffer
	ytCmd.Stderr = &ytStderr

	ffArgs := []string{
		"-hide_banner",
		"-loglevel", "error",
		"-i", "pipe:0",
		"-c", "copy",
		"-f", "mp4",
		"-movflags", "frag_keyframe+empty_moov+default_base_moof",
		"pipe:1",
	}
	ffCmd := exec.CommandContext(ctx, ffmpegBin, ffArgs...) //nolint:gosec
	ffCmd.Stdin = ytStdout
	counter := &countingWriter{w: dst}
	ffCmd.Stdout = counter
	ffCmd.Stderr = io.Discard

	if err := ytCmd.Start(); err != nil {
		return PipelineResult{Err: &PipelineError{
			Code:    ErrorCodeUnknown,
			Wrapped: fmt.Errorf("start yt-dlp: %w", err),
		}}
	}
	if err := ffCmd.Start(); err != nil {
		_ = ytCmd.Process.Kill()
		_, _ = ytCmd.Process.Wait()
		return PipelineResult{Err: &PipelineError{
			Code:    ErrorCodeUnknown,
			Wrapped: fmt.Errorf("start ffmpeg: %w", err),
		}}
	}

	ffErr := ffCmd.Wait()
	// ffmpeg has finished (success or context cancel); make sure yt-dlp is gone.
	if ytCmd.ProcessState == nil {
		_ = ytCmd.Process.Kill()
	}
	ytErr := ytCmd.Wait()

	res := PipelineResult{BytesOut: counter.n.Load()}

	if ctx.Err() != nil {
		// Caller cancelled. Don't classify as a yt-dlp failure even if stderr
		// looks suspicious — context cancel races with the pipeline shutdown.
		return res
	}

	// yt-dlp errored AND ffmpeg produced nothing? Classify and surface.
	if ytErr != nil && !isExpectedExit(ytErr) {
		code, msg := ClassifyYtdlpError(ytErr, ytStderr.String())
		res.Err = &PipelineError{
			Code:     code,
			Message:  msg,
			Wrapped:  fmt.Errorf("yt-dlp: %w", ytErr),
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

func isExpectedExit(err error) bool {
	var ee *exec.ExitError
	if !errors.As(err, &ee) {
		return false
	}
	// yt-dlp exits non-zero when its stdout pipe is closed early (which
	// happens whenever ffmpeg finishes first or the client disconnects).
	// Treat -1 (signaled), 1 (broken pipe), 141 (SIGPIPE) as expected.
	code := ee.ExitCode()
	return code == -1 || code == 1 || code == 141
}

// countingWriter wraps an io.Writer and exposes how many bytes have flowed
// through it so the caller can distinguish "nothing was ever written" (safe
// to surface a JSON error) from "we already streamed some bytes" (must just
// truncate cleanly).
type countingWriter struct {
	w io.Writer
	n atomic.Int64
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	if n > 0 {
		c.n.Add(int64(n))
	}
	return n, err
}
