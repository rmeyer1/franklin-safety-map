# Mac Mini Worker Runtime Setup

## Overview

Run the Franklin Safety Map enrichment worker continuously on macOS via `launchd`, using local OpenAI Whisper for transcription with xAI/OpenAI as fallback providers.

## Prerequisites

- macOS (Mac mini or other)
- Homebrew: `https://brew.sh`
- `brew install git node ffmpeg python@3.11`
- `python3 -m pip install --upgrade openai-whisper`
- Verify: `whisper --help` and `ffmpeg -version`

## One-Time Setup

### 1. Clone & Install

```bash
git clone https://github.com/rmeyer1/franklin-safety-map.git
cd franklin-safety-map
git checkout main
npm ci
```

### 2. Configure Environment

Copy `.env.example` to `.env.local` and fill in secrets:

```bash
cp .env.example .env.local
```

Required settings for worker mode:

| Variable | Required | Notes |
|----------|----------|-------|
| `WHISPER_LOCAL_ENABLED` | ✅ | Set to `true` |
| `WHISPER_COMMAND` | | Path to whisper binary (default: `whisper`) |
| `WHISPER_MODEL` | | `turbo` recommended, `base` for slower machines |
| `XAI_API_KEY` | ✅ | Primary STT fallback |
| `OPENAI_API_KEY` | Recommended | Secondary STT fallback |
| `SUPABASE_DB_URL` | ✅ | Database connection string |
| `WORKER_MODE` | ✅ | Set to `loop` |
| `WORKER_POLL_INTERVAL_MS` | | Default: `10000` |
| `WORKER_ERROR_BACKOFF_MS` | | Default: `30000` |

### 3. Build & Smoke Test

```bash
npm run build
npm run worker
```

Confirm logs show either:
- `provider:"whisper_local"` (preferred)
- Fallback `provider:"xai"` / `provider:"openai"` if Whisper unavailable

### 4. Install launchd Service

```bash
# Copy the plist
cp deployment/mac-mini/com.franklin.worker.plist ~/Library/LaunchAgents/

# Load the service
launchctl unload ~/Library/LaunchAgents/com.franklin.worker.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.franklin.worker.plist

# Verify it's running
launchctl list | grep com.franklin.worker
```

### 5. Monitor

```bash
tail -f ~/Library/Logs/franklin-worker.log
tail -f ~/Library/Logs/franklin-worker.err.log
```

## Updating the Worker

```bash
# Stop the service
launchctl unload ~/Library/LaunchAgents/com.franklin.worker.plist

# Pull latest
cd franklin-safety-map
git pull --rebase origin main
npm ci
npm run build

# Restart
launchctl load ~/Library/LaunchAgents/com.franklin.worker.plist
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Whisper command not found` | Set `WHISPER_COMMAND` to full path (e.g., `/opt/homebrew/bin/whisper`) |
| `ffmpeg missing` | `brew install ffmpeg` |
| Slow transcription | Lower model size: `WHISPER_MODEL=base` |
| Provider fallback test | Set `WHISPER_LOCAL_ENABLED=false` temporarily to verify xAI/OpenAI path |

## Service Management

```bash
# Check status
launchctl list | grep com.franklin.worker

# Stop
launchctl unload ~/Library/LaunchAgents/com.franklin.worker.plist

# Start
launchctl load ~/Library/LaunchAgents/com.franklin.worker.plist

# View recent logs
tail -50 ~/Library/Logs/franklin-worker.log
tail -50 ~/Library/Logs/franklin-worker.err.log
```