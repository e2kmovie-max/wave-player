# wave-player

Wave player service: video preview, room creation against streaming instances, YouTube cookie rotation, stream proxy primitives, and the Go streaming worker.

## Contents

- `packages/player` — TypeScript player facade (`createWatchRoom`, `previewVideo`, `withCookieRotation`, instance/cookie pool management).
- `packages/shared` — current shared persistence/util implementation required by player logic during the split transition.
- `apps/instance` — Go 1.23 streaming worker on `:8080`; wraps `yt-dlp` + `ffmpeg` and exposes HMAC-protected `/info` and `/stream` endpoints.

## Local development

```bash
bun install
bun run typecheck
bun run build
cd apps/instance && go vet ./... && go test ./...
```

The Go worker expects `yt-dlp` and `ffmpeg` at runtime. See `apps/instance/README.md`.

## Service boundary

This repository owns all video/source/streaming-instance concerns. Interface and Social repositories should call it through exported facades or service APIs, not by duplicating player logic.
