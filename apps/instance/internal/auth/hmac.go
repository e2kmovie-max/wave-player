// Package auth verifies the master→instance HMAC signature.
//
// Each request from the master node carries:
//
//	X-Wave-Timestamp: <unix seconds>
//	X-Wave-Signature: <hex(hmac_sha256(timestamp + "." + body, instanceSecret))>
//
// The body is read once into memory (instance bodies are small JSON payloads)
// and the verified bytes are placed back on the request via [http.Request.Body]
// so the next handler can re-decode them.
package auth

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"
)

// MaxClockDriftSeconds caps how far the master and instance clocks may drift
// before requests are rejected. Generous enough to survive NTP hiccups but
// tight enough that captured signatures cannot be replayed days later.
const MaxClockDriftSeconds = 30

// Now is overridable for tests.
var Now = func() time.Time { return time.Now().UTC() }

// ErrSecretEmpty is returned by Verifier when constructed with an empty secret.
var ErrSecretEmpty = errors.New("auth: instance secret is empty")

// Verifier holds the shared HMAC secret.
type Verifier struct {
	secret []byte
}

// NewVerifier builds a Verifier; it is safe to share across goroutines.
func NewVerifier(secret string) (*Verifier, error) {
	if secret == "" {
		return nil, ErrSecretEmpty
	}
	return &Verifier{secret: []byte(secret)}, nil
}

// Middleware returns an http handler middleware that enforces the signature on
// every wrapped request.
func (v *Verifier) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := v.verify(r); err != nil {
			http.Error(w, "invalid signature: "+err.Error(), http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (v *Verifier) verify(r *http.Request) error {
	tsHeader := r.Header.Get("X-Wave-Timestamp")
	sigHeader := r.Header.Get("X-Wave-Signature")
	if tsHeader == "" || sigHeader == "" {
		return errors.New("missing X-Wave-Timestamp or X-Wave-Signature")
	}

	ts, err := strconv.ParseInt(tsHeader, 10, 64)
	if err != nil {
		return errors.New("malformed X-Wave-Timestamp")
	}
	if drift := Now().Unix() - ts; drift < -MaxClockDriftSeconds || drift > MaxClockDriftSeconds {
		return errors.New("timestamp out of allowed drift")
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		return errors.New("read body: " + err.Error())
	}
	_ = r.Body.Close()
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))

	mac := hmac.New(sha256.New, v.secret)
	mac.Write([]byte(tsHeader))
	mac.Write([]byte("."))
	mac.Write(body)
	expected := mac.Sum(nil)

	got, err := hex.DecodeString(sigHeader)
	if err != nil {
		return errors.New("malformed X-Wave-Signature")
	}
	if !hmac.Equal(expected, got) {
		return errors.New("signature mismatch")
	}
	return nil
}
