#!/usr/bin/env bash
set -euo pipefail

export OPENMHZ_API_BASE_URL="${OPENMHZ_API_BASE_URL:-https://api.openmhz.com}"

npx tsx scripts/diagnose-openmhz.ts
