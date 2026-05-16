package auth

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func sign(t *testing.T, secret, ts string, body []byte) string {
	t.Helper()
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts))
	mac.Write([]byte("."))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func newSignedRequest(t *testing.T, secret string, body []byte, ts int64, sig string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/info", bytes.NewReader(body))
	r.Header.Set("X-Wave-Timestamp", strconv.FormatInt(ts, 10))
	r.Header.Set("X-Wave-Signature", sig)
	if sig == "" {
		r.Header.Set("X-Wave-Signature", sign(t, secret, strconv.FormatInt(ts, 10), body))
	}
	return r
}

func handlerThatEchoes() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	})
}

func TestVerifier_AcceptsValidRequest(t *testing.T) {
	v, err := NewVerifier("the-secret")
	if err != nil {
		t.Fatalf("NewVerifier: %v", err)
	}
	body := []byte(`{"url":"https://example.com"}`)
	req := newSignedRequest(t, "the-secret", body, time.Now().UTC().Unix(), "")
	rr := httptest.NewRecorder()
	v.Middleware(handlerThatEchoes()).ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	if got := rr.Body.String(); got != string(body) {
		t.Fatalf("body roundtrip mismatch: got %q want %q", got, string(body))
	}
}

func TestVerifier_RejectsTamperedSignature(t *testing.T) {
	v, _ := NewVerifier("the-secret")
	body := []byte(`{"url":"https://example.com"}`)
	ts := time.Now().UTC().Unix()
	good := sign(t, "the-secret", strconv.FormatInt(ts, 10), body)
	// flip last hex char
	last := good[len(good)-1]
	flipped := good[:len(good)-1]
	if last == '0' {
		flipped += "1"
	} else {
		flipped += "0"
	}
	req := newSignedRequest(t, "the-secret", body, ts, flipped)
	rr := httptest.NewRecorder()
	v.Middleware(handlerThatEchoes()).ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
}

func TestVerifier_RejectsTamperedBody(t *testing.T) {
	v, _ := NewVerifier("the-secret")
	body := []byte(`{"url":"https://example.com"}`)
	ts := time.Now().UTC().Unix()
	good := sign(t, "the-secret", strconv.FormatInt(ts, 10), body)
	tamperedBody := []byte(`{"url":"https://evil.example/"}`)
	req := newSignedRequest(t, "the-secret", tamperedBody, ts, good)
	rr := httptest.NewRecorder()
	v.Middleware(handlerThatEchoes()).ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
}

func TestVerifier_RejectsExpiredTimestamp(t *testing.T) {
	v, _ := NewVerifier("the-secret")
	body := []byte(`{"url":"https://example.com"}`)
	ts := time.Now().UTC().Unix() - int64(MaxClockDriftSeconds) - 5
	req := newSignedRequest(t, "the-secret", body, ts, "")
	rr := httptest.NewRecorder()
	v.Middleware(handlerThatEchoes()).ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
}

func TestVerifier_RejectsFutureTimestamp(t *testing.T) {
	v, _ := NewVerifier("the-secret")
	body := []byte(`{"url":"https://example.com"}`)
	ts := time.Now().UTC().Unix() + int64(MaxClockDriftSeconds) + 5
	req := newSignedRequest(t, "the-secret", body, ts, "")
	rr := httptest.NewRecorder()
	v.Middleware(handlerThatEchoes()).ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
}

func TestVerifier_RejectsMissingHeaders(t *testing.T) {
	v, _ := NewVerifier("the-secret")
	body := []byte(`{}`)
	r := httptest.NewRequest(http.MethodPost, "/info", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	v.Middleware(handlerThatEchoes()).ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
}

func TestNewVerifier_RejectsEmptySecret(t *testing.T) {
	if _, err := NewVerifier(""); err == nil {
		t.Fatal("expected error for empty secret")
	}
}
