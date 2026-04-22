# Franklin Safety Map — Replay & Re-enqueue Runbook

> This document covers how to replay and re-enrich historical source calls after codebook, prompt, or geocoder changes. It also documents dead-letter handling procedures.
>
> **Issue:** [#17 — Add replay/requeue tooling and operational tests for the enrichment pipeline](https://github.com/rmeyer1/franklin-safety-map/issues/17)

---

## Overview

The enrichment pipeline is structured so that:

1. **Source adapters** ingest raw calls into the `source_calls` table (once per call event)
2. **Enrichment jobs** are queued in `enrichment_jobs` and processed by the worker
3. **Enrichment runs** are written to `enrichment_runs` (immutable — never updated)
4. **Incidents** are upserted to `incidents` (updated on re-enrichment)

This means replaying a call **does not touch upstream sources** and never modifies a raw `source_calls` row. Each replay creates a new `enrichment_run` row.

---

## Re-enqueueing Calls

### Prerequisites

- Database credentials configured via `SUPABASE_DB_URL` or `DATABASE_URL`
- `node --import tsx` available (included in project dependencies)

### Tools

```bash
npm run db:reenqueue -- [options]
```

### Finding What to Re-enqueue

#### Replay all calls (e.g., after a codebook update)

```bash
npm run db:reenqueue -- --all --dry-run
# then, when satisfied:
npm run db:reenqueue -- --all
```

#### Replay calls since a specific date (e.g., after a prompt/model change)

```bash
# Preview
npm run db:reenqueue -- --since 2026-04-01T00:00:00Z --dry-run

# Execute (limit to first 200 to avoid overwhelming the queue)
npm run db:reenqueue -- --since 2026-04-01T00:00:00Z --limit 200
```

#### Replay specific calls by ID (e.g., known incidents to fix)

```bash
npm run db:reenqueue -- --ids 550e8400-e29b-41d4-a716-446655440000,660e8400-e29b-41d4-a716-446655440001
```

### Options

| Flag | Description | Default |
|---|---|---|
| `--all` | Re-enqueue every source call | — |
| `--since <ISO>` | Re-enqueue calls at or after this timestamp | — |
| `--ids <uuids>` | Comma-separated source call UUIDs | — |
| `--job-type <type>` | Job type to enqueue | `incident_enrichment` |
| `--limit <N>` | Maximum number of calls to re-enqueue | unlimited |
| `--force` | Re-enqueue even if a pending/processing job already exists | `false` |
| `--dry-run` | Print what would be enqueued without executing | `false` |

**Only one of `--all`, `--since`, or `--ids` may be specified at a time.**

---

## Running the Enrichment Worker

The worker processes jobs from the `enrichment_jobs` queue.

```bash
# Process once (useful in CI or cron jobs)
npm run worker:enrich

# Run continuously (for persistent deployments)
npm run worker:enrich:loop
```

### Worker logs

Each processed job emits a JSON log line:

```json
{
  "jobId": "...",
  "sourceCallId": "...",
  "incidentId": "...",
  "provider": "openai",
  "severity": 3,
  "status": "completed"
}
```

Failed jobs:

```json
{
  "jobId": "...",
  "sourceCallId": "...",
  "status": "pending",
  "lastError": "Connection timeout",
  "attemptCount": 2
}
```

---

## Dead-Letter Handling

When a job exhausts all retry attempts, its status becomes `dead_letter`. These jobs are **not automatically retried**.

### Finding Dead-Letter Jobs

```sql
select
  j.id,
  j.source_call_id,
  j.job_type,
  j.attempt_count,
  j.last_error,
  j.created_at,
  c.source_event_id
from enrichment_jobs j
join source_calls c on c.id = j.source_call_id
where j.status = 'dead_letter'
order by j.created_at desc
limit 50;
```

### Investigating a Dead-Letter

```sql
-- Check the associated enrichment run for context
select * from enrichment_runs
where source_call_id = '<source_call_id>'
order by created_at desc
limit 5;

-- Check the incident that was published (if any)
select id, category, severity, status, metadata
from incidents
where source_call_id = '<source_call_id>'
order by created_at desc
limit 5;
```

### Re-enqueuing a Dead-Letter

```bash
# Get the source_call_id from the dead_letter job
npm run db:reenqueue -- --ids <source_call_id> --force
```

Use `--force` because the job row still exists with `status=dead_letter`.

### Bulk Re-enqueue Dead-Letters

```sql
-- Find all dead-letter job source call IDs and re-enqueue them
select j.source_call_id
from enrichment_jobs j
where j.status = 'dead_letter'
  and j.created_at > '2026-04-01'  -- optional date filter
limit 100;
```

Then pass those IDs to `--ids`.

---

## Retry Behavior

| Situation | Behavior |
|---|---|
| Transient error (network timeout, API rate limit) | Retried up to `maxAttempts` (default 5), with exponential-style backoff configured via `WORKER_ERROR_BACKOFF_MS` |
| Skippable error (`no_speech_detected`, `low_confidence_non_incident`) | Job marked `completed`, run written with `outcome=skipped` |
| Fatal error (`retryable=false`) | Job immediately set to `failed`, no retry |
| All attempts exhausted | Job set to `dead_letter` |

### Configuring Retry Parameters

In `.env.local`:

```env
WORKER_MAX_CALLS_PER_RUN=10     # jobs processed per worker invocation
WORKER_ERROR_BACKOFF_MS=30000   # ms to wait after an unexpected error in loop mode
```

On the CLI when enqueuing:

```bash
npm run db:reenqueue -- --all --limit 50
```

---

## Immutability Invariants

These invariants are enforced by the code and verified by tests:

1. **`source_calls` rows are never updated after insert.** Only `transcript_text` may be set once, and only via `setTranscript()` which is called by the enrichment service, not the replay tool.
2. **Each enrichment produces a new `enrichment_runs` row.** Replaying the same call creates a new run, not an update to an existing one.
3. **`incidents` is upserted** — the existing row is updated on replay, preserving the audit trail via `source_call_id` + `enrichment_run_id` lineage.

---

## When to Replay

| Change | Replay needed? | Scope |
|---|---|---|
| Radio codebook updated (`frkoh.json`) | Yes | All calls since codebook effective date |
| Transcription prompt or model changed | Yes | Calls where you want improved transcription |
| Geocoder logic or credentials updated | Yes | Unresolved incidents (`geocoding.resolved = false`) |
| Incident classification prompt updated | Yes | All calls or specific categories |
| Worker bug fix | Yes | Calls that failed or were misclassified |
| No changes | No | — |
