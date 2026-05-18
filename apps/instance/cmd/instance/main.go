// Command instance is the Wave streaming worker.
//
// It listens on $PORT (default 8080) and exposes /health, /info, /stream as
// described in [internal/api]. The HMAC secret is read from $INSTANCE_SECRET
// and must match the secret stored alongside the instance record in the
// master database.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/e2kmovie-max/wave-player/apps/instance/internal/api"
	"github.com/e2kmovie-max/wave-player/apps/instance/internal/auth"
	"github.com/e2kmovie-max/wave-player/apps/instance/internal/streamer"
	"github.com/e2kmovie-max/wave-player/apps/instance/internal/version"
)

func main() {
	logger := log.New(os.Stderr, "wave-instance ", log.LstdFlags|log.Lmicroseconds)
	logger.Printf("starting (version=%s)", version.Version)

	port := envOrDefault("PORT", "8080")
	secret := os.Getenv("INSTANCE_SECRET")
	maxStreams, _ := strconv.Atoi(envOrDefault("INSTANCE_MAX_STREAMS", "0"))
	throttledRate, _ := strconv.Atoi(envOrDefault("INSTANCE_THROTTLED_RATE_BYTES", "0"))

	// Loopback / RFC1918 targets stay forbidden unless an operator opts in
	// (useful for self-hosted setups testing against http://localhost demo
	// videos). Production should never set this.
	if v := os.Getenv("INSTANCE_ALLOW_PRIVATE_TARGETS"); v == "1" || strings.EqualFold(v, "true") {
		streamer.AllowPrivateTargets = true
		logger.Printf("WARNING: INSTANCE_ALLOW_PRIVATE_TARGETS is on; SSRF guard is disabled")
	}

	verifier, err := auth.NewVerifier(secret)
	if err != nil {
		// Without a secret, /info and /stream will reject everything; we still
		// boot so /health works (useful for ops to validate connectivity), but
		// we log a loud warning.
		logger.Printf("WARNING: INSTANCE_SECRET is empty; /info and /stream will return 503")
		verifier = nil
	}

	srv := api.New(api.Config{
		Verifier:                    verifier,
		YTDLPBinary:                 envOrDefault("YTDLP_BINARY", "yt-dlp"),
		FFmpegBinary:                envOrDefault("FFMPEG_BINARY", "ffmpeg"),
		StreamlinkBinary:            os.Getenv("STREAMLINK_BINARY"),
		StartedAt:                   time.Now().UTC(),
		MaxStreams:                  int32(maxStreams),
		ThrottledRateBytesPerSecond: throttledRate,
		EnableTwitchAdSkip:          envBool("INSTANCE_TWITCH_DISABLE_ADS", true),
	})

	httpSrv := &http.Server{
		Addr:              ":" + port,
		Handler:           srv,
		ReadHeaderTimeout: 10 * time.Second,
		// No WriteTimeout: streams may run for hours.
		IdleTimeout: 60 * time.Second,
	}

	idleClosed := make(chan struct{})
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		logger.Printf("shutdown signal received")
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpSrv.Shutdown(ctx); err != nil {
			logger.Printf("graceful shutdown failed: %v", err)
		}
		close(idleClosed)
	}()

	logger.Printf("listening on :%s", port)
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Fatalf("listen: %v", err)
	}
	<-idleClosed
	logger.Printf("bye")
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	switch strings.ToLower(v) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return def
}
