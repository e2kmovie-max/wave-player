package streamer

import (
	"errors"
	"net/http"
	"strings"
)

// ErrorCode is a small, stable enum the master node uses to decide whether to
// rotate the Google cookie pool, retry the request, or give up.
//
// The classification is best-effort string-matching against yt-dlp's stderr
// output; new patterns can be added by extending the table below without any
// API breakage on the master side.
type ErrorCode string

const (
	// ErrorCodeUnknown — yt-dlp failed but we could not classify the reason.
	ErrorCodeUnknown ErrorCode = "unknown"

	// ErrorCodeBotDetected — YouTube is asking the user to confirm they're not
	// a bot (the canonical "Sign in to confirm you're not a bot" message).
	// Rotate the cookie pool and retry.
	ErrorCodeBotDetected ErrorCode = "bot_detected"

	// ErrorCodeCaptcha — yt-dlp surfaced a captcha challenge.
	ErrorCodeCaptcha ErrorCode = "captcha"

	// ErrorCodeLoginRequired — age-restricted or members-only content that
	// requires authentication beyond the current cookies. Rotate to try a
	// different account.
	ErrorCodeLoginRequired ErrorCode = "login_required"

	// ErrorCodeForbidden — HTTP 403 from the upstream extractor.
	ErrorCodeForbidden ErrorCode = "forbidden"

	// ErrorCodeRateLimited — HTTP 429 or "too many requests".
	ErrorCodeRateLimited ErrorCode = "rate_limited"

	// ErrorCodeUnavailable — video unavailable / private / removed / geo-blocked.
	// Rotating cookies will not help; the master should surface the message.
	ErrorCodeUnavailable ErrorCode = "unavailable"

	// ErrorCodeNetwork — network/DNS/timeout talking to the upstream.
	ErrorCodeNetwork ErrorCode = "network"
)

// Rotatable reports whether the master should try a different GoogleAccount
// cookie record and retry the request.
func (c ErrorCode) Rotatable() bool {
	switch c {
	case ErrorCodeBotDetected, ErrorCodeCaptcha, ErrorCodeLoginRequired,
		ErrorCodeForbidden, ErrorCodeRateLimited:
		return true
	default:
		return false
	}
}

// HTTPStatus maps an ErrorCode to the HTTP status the instance should return.
// Picking a 4xx for things that are clearly upstream-state-driven (cookie
// expired, video unavailable) and 5xx for genuinely transient failures helps
// the master log/alert sanely without parsing the body in detail.
func (c ErrorCode) HTTPStatus() int {
	switch c {
	case ErrorCodeBotDetected, ErrorCodeCaptcha, ErrorCodeLoginRequired:
		return http.StatusUnauthorized // 401 — credentials no longer good
	case ErrorCodeForbidden:
		return http.StatusForbidden // 403
	case ErrorCodeRateLimited:
		return http.StatusTooManyRequests // 429
	case ErrorCodeUnavailable:
		return http.StatusGone // 410
	case ErrorCodeNetwork:
		return http.StatusBadGateway // 502
	default:
		return http.StatusBadGateway // 502
	}
}

// ClassifyYtdlpError inspects the yt-dlp error wrapper and its stderr capture
// and returns a stable ErrorCode plus a short human message.
//
// The function is intentionally permissive: when nothing matches we fall back
// to ErrorCodeUnknown so the API can still produce a JSON body.
func ClassifyYtdlpError(err error, stderr string) (ErrorCode, string) {
	if err == nil && stderr == "" {
		return ErrorCodeUnknown, ""
	}
	hay := strings.ToLower(stderr)
	if err != nil {
		hay = strings.ToLower(err.Error()) + "\n" + hay
	}

	switch {
	case containsAny(hay, "sign in to confirm you're not a bot", "confirm you're not a bot", "confirm you are not a bot"):
		return ErrorCodeBotDetected, firstLine(stderr, err)
	case containsAny(hay, "captcha", "g-recaptcha", "challenge required"):
		return ErrorCodeCaptcha, firstLine(stderr, err)
	case containsAny(hay,
		"sign in to confirm your age",
		"login required",
		"this video is only available for registered users",
		"members-only",
		"this video is available to this channel's members",
		"private video",
	):
		return ErrorCodeLoginRequired, firstLine(stderr, err)
	case containsAny(hay, "http error 403", "forbidden"):
		return ErrorCodeForbidden, firstLine(stderr, err)
	case containsAny(hay, "http error 429", "too many requests", "rate-limit", "rate limit"):
		return ErrorCodeRateLimited, firstLine(stderr, err)
	case containsAny(hay,
		"video unavailable",
		"this video is unavailable",
		"this video has been removed",
		"video is no longer available",
		"is not available in your country",
		"not available in your country",
		"geo restricted",
	):
		return ErrorCodeUnavailable, firstLine(stderr, err)
	case containsAny(hay,
		"unable to download webpage",
		"name or service not known",
		"connection refused",
		"connection reset",
		"timed out",
		"timeout",
		"network is unreachable",
	):
		return ErrorCodeNetwork, firstLine(stderr, err)
	}
	return ErrorCodeUnknown, firstLine(stderr, err)
}

func containsAny(haystack string, needles ...string) bool {
	for _, n := range needles {
		if strings.Contains(haystack, n) {
			return true
		}
	}
	return false
}

// firstLine returns the most useful single-line message we have: prefer the
// last non-empty line of stderr (yt-dlp prints the actual reason last), then
// fall back to err.Error().
func firstLine(stderr string, err error) string {
	lines := strings.Split(strings.ReplaceAll(stderr, "\r", "\n"), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		// Skip the "[youtube] foo: Downloading webpage" style chatter.
		lower := strings.ToLower(line)
		if strings.HasPrefix(lower, "[debug]") || strings.HasPrefix(lower, "[info]") ||
			strings.HasPrefix(lower, "[generic]") || strings.HasPrefix(lower, "[youtube]") &&
				!strings.Contains(lower, "error") {
			continue
		}
		return trimErrorPrefix(line)
	}
	if err != nil {
		return trimErrorPrefix(err.Error())
	}
	return ""
}

func trimErrorPrefix(s string) string {
	s = strings.TrimSpace(s)
	for _, p := range []string{"ERROR: ", "error: ", "ytdlp: ", "yt-dlp: "} {
		s = strings.TrimPrefix(s, p)
	}
	return s
}

// PipelineError carries a classified error from the stream pipeline so the
// caller can either return JSON (when no bytes have been written) or just log.
type PipelineError struct {
	Code     ErrorCode
	Message  string
	Wrapped  error
	BytesOut int64
}

func (e *PipelineError) Error() string {
	if e == nil {
		return ""
	}
	if e.Message != "" {
		return string(e.Code) + ": " + e.Message
	}
	if e.Wrapped != nil {
		return string(e.Code) + ": " + e.Wrapped.Error()
	}
	return string(e.Code)
}

func (e *PipelineError) Unwrap() error { return e.Wrapped }

// AsPipelineError extracts the typed pipeline error or nil.
func AsPipelineError(err error) *PipelineError {
	var pe *PipelineError
	if errors.As(err, &pe) {
		return pe
	}
	return nil
}
