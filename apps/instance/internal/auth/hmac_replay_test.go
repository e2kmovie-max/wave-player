package auth

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestVerifier_RejectsReplay(t *testing.T) {
	v, _ := NewVerifier("the-secret")
	body := []byte(`{"url":"https://example.com"}`)
	ts := time.Now().UTC().Unix()

	req1 := newSignedRequest(t, "the-secret", body, ts, "")
	rr1 := httptest.NewRecorder()
	v.Middleware(handlerThatEchoes()).ServeHTTP(rr1, req1)
	if rr1.Code != http.StatusOK {
		t.Fatalf("first call: status = %d, want 200", rr1.Code)
	}

	// Identical signature + timestamp — must be rejected even though it is
	// still inside the drift window.
	req2 := newSignedRequest(t, "the-secret", body, ts, "")
	rr2 := httptest.NewRecorder()
	v.Middleware(handlerThatEchoes()).ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusUnauthorized {
		t.Fatalf("replay: status = %d, want 401", rr2.Code)
	}
	if !strings.Contains(rr2.Body.String(), "replay") {
		t.Errorf("replay error message should mention replay; got %q", rr2.Body.String())
	}
}

func TestVerifier_RejectsOversizedBody(t *testing.T) {
	v, _ := NewVerifier("the-secret")
	// Build a body bigger than MaxSignedBodyBytes; we have to sign it with the
	// correct secret because the body-size check happens *during* signature
	// verification (after we know the timestamp is in window).
	big := bytes.Repeat([]byte{'A'}, MaxSignedBodyBytes+1024)
	ts := time.Now().UTC().Unix()
	r := httptest.NewRequest(http.MethodPost, "/info", bytes.NewReader(big))
	r.Header.Set("X-Wave-Timestamp", strconv.FormatInt(ts, 10))
	r.Header.Set("X-Wave-Signature", sign(t, "the-secret", strconv.FormatInt(ts, 10), big))

	rr := httptest.NewRecorder()
	v.Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("handler should not run on oversize body")
	})).ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "exceeds") {
		t.Errorf("expected error to mention size; got %q", rr.Body.String())
	}
}

func TestVerifier_AcceptsBodyAtLimit(t *testing.T) {
	v, _ := NewVerifier("the-secret")
	body := bytes.Repeat([]byte{'B'}, MaxSignedBodyBytes)
	ts := time.Now().UTC().Unix()
	r := httptest.NewRequest(http.MethodPost, "/info", bytes.NewReader(body))
	r.Header.Set("X-Wave-Timestamp", strconv.FormatInt(ts, 10))
	r.Header.Set("X-Wave-Signature", sign(t, "the-secret", strconv.FormatInt(ts, 10), body))

	got := 0
	rr := httptest.NewRecorder()
	v.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		b, _ := io.ReadAll(req.Body)
		got = len(b)
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	if got != len(body) {
		t.Fatalf("handler saw %d bytes, want %d", got, len(body))
	}
}
