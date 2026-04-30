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
| `OPENMHZ_API_BASE_URL` | ✅ | Set to `https://api.openmhz.com` for direct polling |
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

### 4. Install launchd Services

Two workers run continuously:
- **Ingest worker** (`com.franklin.worker`) — polls OpenMHz for new calls
- **Enrichment worker** (`com.franklin.enrich-worker`) — transcribes & extracts incidents

```bash
# Copy the plists
cp deployment/mac-mini/com.franklin.worker.plist ~/Library/LaunchAgents/
cp deployment/mac-mini/com.franklin.enrich-worker.plist ~/Library/LaunchAgents/

# Load both services
launchctl unload ~/Library/LaunchAgents/com.franklin.worker.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.franklin.worker.plist
launchctl unload ~/Library/LaunchAgents/com.franklin.enrich-worker.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.franklin.enrich-worker.plist

# Verify both are running
launchctl list | grep com.franklin
```

### 5. Monitor

```bash
# Ingest worker
tail -f ~/Library/Logs/franklin-worker.log
tail -f ~/Library/Logs/franklin-worker.err.log

# Enrichment worker
tail -f ~/Library/Logs/franklin-enrich-worker.log
tail -f ~/Library/Logs/franklin-enrich-worker.err.log
```

## Updating the Worker

```bash
# Stop both services
launchctl unload ~/Library/LaunchAgents/com.franklin.worker.plist
launchctl unload ~/Library/LaunchAgents/com.franklin.enrich-worker.plist

# Pull latest
cd franklin-safety-map
git pull --rebase origin main
npm ci
npm run build

# Restart both
launchctl load ~/Library/LaunchAgents/com.franklin.worker.plist
launchctl load ~/Library/LaunchAgents/com.franklin.enrich-worker.plist
```

## Ingest Source Configuration

The ingest worker can fetch calls from OpenMHz in two ways:

| Mode | Env vars | When to use |
|------|----------|-------------|
| **Direct** | `OPENMHZ_API_BASE_URL=https://api.openmhz.com` | Local worker (Mac mini). Worker polls OpenMHz directly and writes to Supabase. |
| **Adapter** | `OPENMHZ_ADAPTER_BASE_URL=<vercel-url>` | When routing through the Vercel API endpoint. Not recommended for local workers — Vercel serverless can't reach IPv6-only Supabase hosts. |

The launchd plist for the ingest worker sets `OPENMHZ_API_BASE_URL` and clears `OPENMHZ_ADAPTER_BASE_URL` so it polls OpenMHz directly. This bypasses Vercel entirely and writes calls directly to Supabase from the Mac mini.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Whisper command not found` | Set `WHISPER_COMMAND` to full path (e.g., `/opt/homebrew/bin/whisper`) |
| `ffmpeg missing` | `brew install ffmpeg` |
| Slow transcription | Lower model size: `WHISPER_MODEL=base` |
| Provider fallback test | Set `WHISPER_LOCAL_ENABLED=false` temporarily to verify xAI/OpenAI path |

## Service Management

```bash
# Check both services
launchctl list | grep com.franklin

# Stop both
launchctl unload ~/Library/LaunchAgents/com.franklin.worker.plist
launchctl unload ~/Library/LaunchAgents/com.franklin.enrich-worker.plist

# Start both
launchctl load ~/Library/LaunchAgents/com.franklin.worker.plist
launchctl load ~/Library/LaunchAgents/com.franklin.enrich-worker.plist

# View recent logs (ingest)
tail -50 ~/Library/Logs/franklin-worker.log
tail -50 ~/Library/Logs/franklin-worker.err.log

# View recent logs (enrichment)
tail -50 ~/Library/Logs/franklin-enrich-worker.log
tail -50 ~/Library/Logs/franklin-enrich-worker.err.log
```