# `wave-instance` — streaming worker (Go)

Stateless Go binary that hosts the streaming endpoints used by the master node.
Each request is HMAC-signed; the binary never persists cookies — they are sent
in the request body and live only in a 0600 temp file for the duration of the
request.

## Endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/health` | none | Liveness, version, uptime, active stream count, reported `yt-dlp` and `ffmpeg` versions. |
| `POST` | `/info` | HMAC | Runs `yt-dlp --dump-single-json` for the body's `url` (with `cookies` if provided) and returns the trimmed metadata + format list. |
| `POST` | `/stream` | HMAC | Pipes `yt-dlp -o -` → `ffmpeg -c copy -f mp4 -movflags frag_keyframe+empty_moov+default_base_moof pipe:1` directly to the response body. Always remuxes to fragmented MP4 so the same code path serves every input format. |

## Request shape

`/info` and `/stream` accept JSON bodies of the form:

```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "formatId": "137+140",      // /stream only; optional
  "userAgent": "Mozilla/5.0", // optional
  "cookies": [
    {
      "name": "SID",
      "value": "abcdef",
      "domain": ".youtube.com",
      "path": "/",
      "expires": 1893456000,
      "secure": true,
      "httpOnly": true
    }
  ]
}
```

Cookies follow the [Chrome DevTools Protocol cookie shape][cdp]. The instance
serialises them to a temporary Netscape `cookies.txt` file (mode `0600`),
hands the path to `yt-dlp --cookies`, and `defer`-deletes the file when the
handler returns.

[cdp]: https://chromedevtools.github.io/devtools-protocol/tot/Network/#type-Cookie

## Authentication

Signed routes require both headers:

```
X-Wave-Timestamp: <unix seconds>
X-Wave-Signature: <hex(hmac_sha256(timestamp + "." + body, INSTANCE_SECRET))>
```

The instance enforces a ±30s clock-drift window so a leaked signature cannot
be replayed forever. The same algorithm runs on the master in
`packages/shared/src/instance-client.ts`, and the parity between the two is
locked in by tests in `packages/shared/test/instance-client.test.ts`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port. |
| `INSTANCE_SECRET` | *(none)* | Shared HMAC secret. Without it `/info` and `/stream` return `503 instance secret not configured`. |
| `INSTANCE_MAX_STREAMS` | `0` | Cap on simultaneous `/stream` connections; `0` = unlimited. Excess requests get `503`. |
| `YTDLP_BINARY` | `yt-dlp` | Override the binary path (handy for self-contained builds). |
| `FFMPEG_BINARY` | `ffmpeg` | Override the binary path. |

## Running

### From source (requires Go 1.23, ffmpeg, yt-dlp on `PATH`)

```bash
cd apps/instance
INSTANCE_SECRET=dev-secret go run ./cmd/instance
```

### Via docker-compose (preferred for local dev)

The compose file ships an `instance` profile that builds the Dockerfile in
this directory and exposes `:8080`:

```bash
docker compose --profile instance up -d --build
curl -s http://localhost:8080/health | jq
```

### Standalone Docker image

```bash
docker build -f apps/instance/Dockerfile -t wave-instance:dev .
docker run --rm -p 8080:8080 -e INSTANCE_SECRET=dev-secret wave-instance:dev
```

## Tests

```bash
cd apps/instance
go vet ./...
go test ./...
```

The auth, cookies, and api packages have unit coverage including:

- valid HMAC accepted; tampered body / tampered signature / expired
  timestamp / future-skewed timestamp / missing headers all rejected with `401`
- Netscape cookie writer enforces 0600 perms, removes on `Remove()`, and
  rejects tab/newline injection in cookie fields
- `/info` and `/stream` reject unsigned requests with `401`; with no
  verifier configured they return `503` instead of crashing
