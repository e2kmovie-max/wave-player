// Package auth verifies the master→instance HMAC signature.
//
// Each request from the master node carries:
//
//	X-Wave-Timestamp: <unix seconds>
//	X-Wave-Signature: <hex(hmac_sha256(timestamp + "." + body, instanceSecret))>
//
// The body is read once into memory (instance bodies are small JSON payloads)
// and the verified bytes are placed back on the request via [http.Request.Body]
// so the next handler can re-decode them. To keep an unauthenticated peer from
// streaming gigabytes through us, we cap the auth-protected body at
// [MaxSignedBodyBytes] before reading.
//
// In addition to the timestamp drift window, we keep a short-lived cache of
// signatures we have already accepted; replaying the same (timestamp, sig)
// pair returns 401 even inside the drift window. That makes a captured TLS
// payload useless within seconds rather than minutes.
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
	"sync"
	"time"
)

// MaxClockDriftSeconds caps how far the master and instance clocks may drift
// before requests are rejected. Generous enough to survive NTP hiccups but
// tight enough that captured signatures cannot be replayed days later.
const MaxClockDriftSeconds = 30

// MaxSignedBodyBytes bounds the size of a signed request body. Info and
// stream payloads are small JSON objects (cookies + URL + UA); the cap is
// generous enough for hundreds of cookies but stops an attacker from forcing
// the instance to buffer megabytes of input before signature verification.
const MaxSignedBodyBytes = 1 << 20 // 1 MiB

// Now is overridable for tests.
var Now = func() time.Time { return time.Now().UTC() }

// ErrSecretEmpty is returned by Verifier when constructed with an empty secret.
var ErrSecretEmpty = errors.New("auth: instance secret is empty")

// Verifier holds the shared HMAC secret and the replay-protection cache.
type Verifier struct {
	secret []byte

	seenMu sync.Mutex
	// seen maps "<timestamp>.<signature-hex>" → expiry time. We evict
	// opportunistically on each verify() so the map cannot grow without
	// bound; the inserted entries also self-expire after the clock-drift
	// window so a long-running instance never accumulates more than ~one
	// drift-window of state at a time.
	seen map[string]time.Time
}

// NewVerifier builds a Verifier; it is safe to share across goroutines.
func NewVerifier(secret string) (*Verifier, error) {
	if secret == "" {
		return nil, ErrSecretEmpty
	}
	return &Verifier{
		secret: []byte(secret),
		seen:   make(map[string]time.Time),
	}, nil
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

	// Read at most MaxSignedBodyBytes — anything past that is dropped and the
	// signature check will fail naturally because the body the master signed
	// does not match the truncated bytes we hashed. This guarantees an
	// unauthenticated peer cannot make us buffer arbitrary amounts of data.
	body, err := io.ReadAll(io.LimitReader(r.Body, MaxSignedBodyBytes+1))
	if err != nil {
		return errors.New("read body: " + err.Error())
	}
	_ = r.Body.Close()
	if int64(len(body)) > MaxSignedBodyBytes {
		return errors.New("body exceeds " + strconv.FormatInt(MaxSignedBodyBytes, 10) + " bytes")
	}
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

	// Signature is valid — now make sure we have not seen this exact
	// (timestamp, signature) pair recently. This adds replay protection on
	// top of the drift window so a captured request cannot be re-used while
	// it is still inside ±30s.
	if err := v.markFresh(tsHeader, sigHeader); err != nil {
		return err
	}
	return nil
}

func (v *Verifier) markFresh(ts, sig string) error {
	key := ts + "." + sig
	now := Now()
	expiry := now.Add((MaxClockDriftSeconds + 5) * time.Second)

	v.seenMu.Lock()
	defer v.seenMu.Unlock()
	// Opportunistic GC so the map stays bounded by the drift window.
	for k, exp := range v.seen {
		if exp.Before(now) {
			delete(v.seen, k)
		}
	}
	if _, exists := v.seen[key]; exists {
		return errors.New("signature replay")
	}
	v.seen[key] = expiry
	return nil
}
