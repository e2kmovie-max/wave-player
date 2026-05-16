package streamer

import (
	"errors"
	"testing"
)

func TestClassifyYtdlpError_BotDetected(t *testing.T) {
	code, msg := ClassifyYtdlpError(
		errors.New("exit status 1"),
		"ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you're not a bot. This helps protect our community.",
	)
	if code != ErrorCodeBotDetected {
		t.Fatalf("code = %q, want %q", code, ErrorCodeBotDetected)
	}
	if msg == "" {
		t.Fatalf("expected non-empty message")
	}
	if !code.Rotatable() {
		t.Fatal("bot_detected should be rotatable")
	}
	if code.HTTPStatus() != 401 {
		t.Fatalf("status = %d, want 401", code.HTTPStatus())
	}
}

func TestClassifyYtdlpError_Captcha(t *testing.T) {
	code, _ := ClassifyYtdlpError(nil, "ERROR: g-recaptcha required to continue")
	if code != ErrorCodeCaptcha {
		t.Fatalf("code = %q, want %q", code, ErrorCodeCaptcha)
	}
}

func TestClassifyYtdlpError_LoginRequired(t *testing.T) {
	for _, hay := range []string{
		"ERROR: Sign in to confirm your age",
		"ERROR: This video is available to this channel's members on level: …",
		"ERROR: Private video",
	} {
		code, _ := ClassifyYtdlpError(nil, hay)
		if code != ErrorCodeLoginRequired {
			t.Errorf("hay=%q: code = %q, want %q", hay, code, ErrorCodeLoginRequired)
		}
		if !code.Rotatable() {
			t.Errorf("login_required should be rotatable")
		}
	}
}

func TestClassifyYtdlpError_Forbidden(t *testing.T) {
	code, _ := ClassifyYtdlpError(nil, "ERROR: unable to download video data: HTTP Error 403: Forbidden")
	if code != ErrorCodeForbidden {
		t.Fatalf("code = %q, want %q", code, ErrorCodeForbidden)
	}
	if code.HTTPStatus() != 403 {
		t.Fatalf("status = %d, want 403", code.HTTPStatus())
	}
}

func TestClassifyYtdlpError_RateLimited(t *testing.T) {
	code, _ := ClassifyYtdlpError(nil, "HTTP Error 429: Too Many Requests")
	if code != ErrorCodeRateLimited {
		t.Fatalf("code = %q, want %q", code, ErrorCodeRateLimited)
	}
	if code.HTTPStatus() != 429 {
		t.Fatalf("status = %d, want 429", code.HTTPStatus())
	}
}

func TestClassifyYtdlpError_Unavailable(t *testing.T) {
	for _, hay := range []string{
		"ERROR: Video unavailable. This video has been removed by the uploader.",
		"ERROR: this video is not available in your country",
		"ERROR: This video is unavailable",
	} {
		code, _ := ClassifyYtdlpError(nil, hay)
		if code != ErrorCodeUnavailable {
			t.Errorf("hay=%q: code = %q, want %q", hay, code, ErrorCodeUnavailable)
		}
		if code.Rotatable() {
			t.Errorf("unavailable should NOT be rotatable")
		}
	}
}

func TestClassifyYtdlpError_Network(t *testing.T) {
	code, _ := ClassifyYtdlpError(errors.New("dial tcp: name or service not known"), "")
	if code != ErrorCodeNetwork {
		t.Fatalf("code = %q, want %q", code, ErrorCodeNetwork)
	}
}

func TestClassifyYtdlpError_Unknown(t *testing.T) {
	code, _ := ClassifyYtdlpError(errors.New("oh no"), "well that's weird")
	if code != ErrorCodeUnknown {
		t.Fatalf("code = %q, want %q", code, ErrorCodeUnknown)
	}
	if code.Rotatable() {
		t.Fatal("unknown should not be rotatable")
	}
	if code.HTTPStatus() != 502 {
		t.Fatalf("status = %d, want 502", code.HTTPStatus())
	}
}

func TestClassifyYtdlpError_FirstLineTrimsPrefixAndChatter(t *testing.T) {
	_, msg := ClassifyYtdlpError(nil, "[youtube] dQw4w9WgXcQ: Downloading webpage\nERROR: Video unavailable")
	if msg != "Video unavailable" {
		t.Fatalf("msg = %q, want %q", msg, "Video unavailable")
	}
}

func TestAsPipelineError(t *testing.T) {
	pe := &PipelineError{Code: ErrorCodeBotDetected, Message: "no good"}
	if got := AsPipelineError(pe); got != pe {
		t.Fatalf("expected wrapper to return the same pointer")
	}
	if AsPipelineError(errors.New("plain")) != nil {
		t.Fatalf("plain error should not be a PipelineError")
	}
}
