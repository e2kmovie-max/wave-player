// Package streamer wraps yt-dlp + ffmpeg to expose info and streaming
// endpoints used by the master node.
package streamer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os/exec"
)

// FetchInfo runs `yt-dlp --dump-single-json` for the given source URL and
// optional cookies file, then trims the response down to the fields the
// master node actually consumes.
func FetchInfo(ctx context.Context, opts InfoOptions) (*Info, error) {
	if _, err := url.ParseRequestURI(opts.URL); err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}

	args := []string{
		"--dump-single-json",
		"--no-warnings",
		"--no-playlist",
		"--no-progress",
		"--quiet",
	}
	if opts.CookiesFile != "" {
		args = append(args, "--cookies", opts.CookiesFile)
	}
	if opts.UserAgent != "" {
		args = append(args, "--user-agent", opts.UserAgent)
	}
	args = append(args, "--", opts.URL)

	cmd := exec.CommandContext(ctx, opts.YTDLPBinary, args...) //nolint:gosec // args are sanitized
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) && len(ee.Stderr) > 0 {
			// Older Go versions populate ee.Stderr only when Stderr is unset;
			// we wrote it ourselves, so prefer our buffer when present.
			if stderr.Len() == 0 {
				stderr.Write(ee.Stderr)
			}
		}
		code, msg := ClassifyYtdlpError(err, stderr.String())
		return nil, &PipelineError{Code: code, Message: msg, Wrapped: fmt.Errorf("yt-dlp: %w", err)}
	}

	var raw rawInfo
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, &PipelineError{
			Code:    ErrorCodeUnknown,
			Message: "yt-dlp produced unparseable JSON",
			Wrapped: fmt.Errorf("parse yt-dlp json: %w", err),
		}
	}

	return raw.toInfo(), nil
}

// InfoOptions controls the FetchInfo call.
type InfoOptions struct {
	URL         string
	CookiesFile string // optional Netscape cookies path
	UserAgent   string
	YTDLPBinary string // defaults to "yt-dlp"
}

// Info is the trimmed response sent back to the master node.
type Info struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	Duration    float64  `json:"duration,omitempty"`
	Thumbnail   string   `json:"thumbnail,omitempty"`
	Uploader    string   `json:"uploader,omitempty"`
	Channel     string   `json:"channel,omitempty"`
	WebpageURL  string   `json:"webpageUrl,omitempty"`
	Extractor   string   `json:"extractor,omitempty"`
	Formats     []Format `json:"formats"`
}

// Format describes a streamable rendition; this is what the room UI lists in
// the quality picker.
type Format struct {
	FormatID   string  `json:"formatId"`
	Ext        string  `json:"ext,omitempty"`
	Resolution string  `json:"resolution,omitempty"`
	Height     int     `json:"height,omitempty"`
	Width      int     `json:"width,omitempty"`
	FPS        float64 `json:"fps,omitempty"`
	VCodec     string  `json:"vcodec,omitempty"`
	ACodec     string  `json:"acodec,omitempty"`
	Filesize   int64   `json:"filesize,omitempty"`
	HasAudio   bool    `json:"hasAudio"`
	HasVideo   bool    `json:"hasVideo"`
	Note       string  `json:"note,omitempty"`
}

type rawInfo struct {
	ID          string      `json:"id"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Duration    float64     `json:"duration"`
	Thumbnail   string      `json:"thumbnail"`
	Uploader    string      `json:"uploader"`
	Channel     string      `json:"channel"`
	WebpageURL  string      `json:"webpage_url"`
	Extractor   string      `json:"extractor"`
	Formats     []rawFormat `json:"formats"`
}

type rawFormat struct {
	FormatID   string  `json:"format_id"`
	Ext        string  `json:"ext"`
	Resolution string  `json:"resolution"`
	Height     int     `json:"height"`
	Width      int     `json:"width"`
	FPS        float64 `json:"fps"`
	VCodec     string  `json:"vcodec"`
	ACodec     string  `json:"acodec"`
	Filesize   int64   `json:"filesize"`
	FilesizeApprox int64 `json:"filesize_approx"`
	FormatNote string  `json:"format_note"`
}

func (r *rawInfo) toInfo() *Info {
	out := &Info{
		ID:          r.ID,
		Title:       r.Title,
		Description: r.Description,
		Duration:    r.Duration,
		Thumbnail:   r.Thumbnail,
		Uploader:    r.Uploader,
		Channel:     r.Channel,
		WebpageURL:  r.WebpageURL,
		Extractor:   r.Extractor,
		Formats:     make([]Format, 0, len(r.Formats)),
	}
	for _, f := range r.Formats {
		hasV := f.VCodec != "" && f.VCodec != "none"
		hasA := f.ACodec != "" && f.ACodec != "none"
		if !hasV && !hasA {
			continue // image-only / storyboards
		}
		fs := f.Filesize
		if fs == 0 {
			fs = f.FilesizeApprox
		}
		out.Formats = append(out.Formats, Format{
			FormatID:   f.FormatID,
			Ext:        f.Ext,
			Resolution: f.Resolution,
			Height:     f.Height,
			Width:      f.Width,
			FPS:        f.FPS,
			VCodec:     f.VCodec,
			ACodec:     f.ACodec,
			Filesize:   fs,
			HasAudio:   hasA,
			HasVideo:   hasV,
			Note:       f.FormatNote,
		})
	}
	return out
}
