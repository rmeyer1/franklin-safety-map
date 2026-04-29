#!/bin/bash
# setup-worker.sh — One-time setup for Franklin Safety Map worker on Mac mini
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PLIST_SRC="$REPO_DIR/deployment/mac-mini/com.franklin.worker.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.franklin.worker.plist"
LOG_DIR="$HOME/Library/Logs"

echo "=== Franklin Safety Map Worker Setup ==="
echo "Repo: $REPO_DIR"
echo ""

# 1. Check prerequisites
echo "Checking prerequisites..."

for cmd in git node npm whisper ffmpeg; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd not found. Install it first."
    exit 1
  fi
  echo "  ✓ $cmd"
done
echo ""

# 2. Check .env.local exists
if [ ! -f "$REPO_DIR/.env.local" ]; then
  echo "ERROR: .env.local not found at $REPO_DIR/.env.local"
  echo "  Copy from .env.example and fill in secrets:"
  echo "  cp $REPO_DIR/.env.example $REPO_DIR/.env.local"
  exit 1
fi

# Verify WHISPER_LOCAL_ENABLED is true
if ! grep -q "WHISPER_LOCAL_ENABLED=true" "$REPO_DIR/.env.local"; then
  echo "WARNING: WHISPER_LOCAL_ENABLED is not set to true in .env.local"
  echo "  Local Whisper transcription will not be used."
fi
echo "  ✓ .env.local found"
echo ""

# 3. Install deps
echo "Installing dependencies..."
cd "$REPO_DIR"
npm ci
echo "  ✓ npm ci"
echo ""

# 4. Build
echo "Building project..."
npm run build
echo "  ✓ build"
echo ""

# 5. Smoke test (one run)
echo "Running smoke test (single worker run)..."
npm run worker
SMOKE_EXIT=$?
if [ $SMOKE_EXIT -ne 0 ]; then
  echo "WARNING: Smoke test exited with code $SMOKE_EXIT"
  echo "  Check logs above. The worker may need valid API keys or DB connection."
  echo "  Continuing with launchd setup anyway..."
else
  echo "  ✓ smoke test passed"
fi
echo ""

# 6. Install launchd plist
echo "Installing launchd service..."
mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$LOG_DIR"

# Update plist with actual home directory
sed "s|/Users/server|$HOME|g" "$PLIST_SRC" > "$PLIST_DST"
echo "  ✓ plist installed to $PLIST_DST"
echo ""

# 7. Load service
echo "Loading launchd service..."
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"
echo "  ✓ service loaded"
echo ""

# 8. Verify
echo "Verifying service..."
if launchctl list | grep -q com.franklin.worker; then
  echo "  ✓ Service is registered with launchd"
else
  echo "  WARNING: Service not found in launchctl list"
fi
echo ""

echo "=== Setup Complete ==="
echo ""
echo "Monitor with:"
echo "  tail -f ~/Library/Logs/franklin-worker.log"
echo "  tail -f ~/Library/Logs/franklin-worker.err.log"
echo ""
echo "Manage with:"
echo "  launchctl unload ~/Library/LaunchAgents/com.franklin.worker.plist  # stop"
echo "  launchctl load ~/Library/LaunchAgents/com.franklin.worker.plist    # start"