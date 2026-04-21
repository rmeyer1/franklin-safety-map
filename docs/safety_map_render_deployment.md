# Render Deployment Guide

## Scope
This project deploys two backend services on Render:

1. `franklin-safety-adapter` (Web Service): serves the Next.js app and adapter routes.
2. `franklin-safety-worker` (Background Worker): runs continuous ingest/transcribe/persist.

The canonical Render blueprint is in [render.yaml](/Users/robmeyer/Projects/franklin-safety-map/render.yaml).

## Deploy Steps

1. Connect this repository in Render.
2. Create services from `render.yaml` blueprint.
3. Set required secret env vars for `franklin-safety-worker`:
   - `OPENMHZ_ADAPTER_BASE_URL`
   - `XAI_API_KEY`
   - `SUPABASE_DB_URL`
4. Optional fallback secret:
   - `OPENAI_API_KEY`

## Recommended Worker Env

- `WORKER_POLL_INTERVAL_MS=10000`
- `WORKER_ERROR_BACKOFF_MS=30000`
- `WORKER_MAX_CALLS_PER_RUN=10`

## Validation Checklist

1. Adapter route is reachable:
   - `GET /api/ingest/openmhz/calls?system=frkoh`
2. Worker logs show processed events with incident IDs.
3. Supabase `incidents` table receives new rows with `source=openmhz`.
