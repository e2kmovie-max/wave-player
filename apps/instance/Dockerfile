# syntax=docker/dockerfile:1.7

# ─── Build the Go binary ──────────────────────────────────────────────
FROM golang:1.23-alpine AS build
WORKDIR /src

# Cache module downloads.
COPY apps/instance/go.mod apps/instance/go.sum* ./
RUN go mod download

COPY apps/instance/ ./
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags "-s -w -X github.com/e2kmovie-max/wave-player/apps/instance/internal/version.Version=${VERSION}" \
    -o /out/wave-instance ./cmd/instance

# ─── Runtime: ffmpeg + yt-dlp + the binary ────────────────────────────
FROM alpine:3.20

# yt-dlp is distributed as a Python script; ffmpeg-static is in apk's main repo.
# pipx install isn't worth the layer churn — pip --break-system-packages is fine
# in a Docker layer that owns the OS Python.
RUN apk add --no-cache \
        ca-certificates \
        ffmpeg \
        python3 \
        py3-pip \
        tzdata \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && yt-dlp --version \
    && ffmpeg -version | head -n 1 \
    && adduser -D -H -u 10001 wave

COPY --from=build /out/wave-instance /usr/local/bin/wave-instance

USER wave
EXPOSE 8080
ENV PORT=8080
ENTRYPOINT ["/usr/local/bin/wave-instance"]
