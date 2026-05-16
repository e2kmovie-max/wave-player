package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/e2kmovie-max/wave-player/apps/instance/internal/auth"
)

func TestHealth_NoAuthRequired(t *testing.T) {
	srv := New(Config{StartedAt: time.Now().UTC().Add(-30 * time.Second)})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var out map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, key := range []string{"ok", "version", "startedAt", "uptimeSeconds", "activeStreams", "tools"} {
		if _, ok := out[key]; !ok {
			t.Errorf("missing key %q in /health response: %+v", key, out)
		}
	}
}

func TestInfo_RejectsUnsignedRequest(t *testing.T) {
	v, _ := auth.NewVerifier("s3cret")
	srv := New(Config{Verifier: v})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/info", strings.NewReader(`{"url":"https://example.com"}`))
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%s", rr.Code, rr.Body.String())
	}
}

func TestStream_RejectsUnsignedRequest(t *testing.T) {
	v, _ := auth.NewVerifier("s3cret")
	srv := New(Config{Verifier: v})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/stream", strings.NewReader(`{"url":"https://example.com"}`))
	srv.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%s", rr.Code, rr.Body.String())
	}
}

func TestRoutes_WithoutVerifier_Reject(t *testing.T) {
	srv := New(Config{}) // no verifier
	for _, path := range []string{"/info", "/stream"} {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{}`))
		srv.ServeHTTP(rr, req)
		if rr.Code != http.StatusServiceUnavailable {
			body, _ := io.ReadAll(rr.Body)
			t.Errorf("%s status = %d, want 503; body=%s", path, rr.Code, string(body))
		}
	}
}
