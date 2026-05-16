# Wave physical split — Player

This repository is the Player boundary of Wave.

## Owns

- Go streaming instance (`apps/instance`) on port `8080`.
- `yt-dlp` / `ffmpeg` execution, `/info`, `/stream`, and HMAC auth.
- Player TypeScript facade in `packages/player`.
- Instance pool, cookie pool, cookie rotation, source preview, and room video attachment logic currently implemented in `packages/shared`.

## Depends on

- MongoDB persistence models during the transition.
- Social room contract for attaching selected video metadata to rooms.

## Must not own

- Google/Telegram login UI.
- Telegram bot conversations.
- User chat/presence UX.
