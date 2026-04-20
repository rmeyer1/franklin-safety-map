# AI-Listener Architecture Decision Record

This document defines the supported ingestion architecture for the Franklin County Safety Map. It exists to prevent drift in future implementation work and to give reviewers a single source of truth for the scanner pipeline.

## 1. Canonical Architecture

The supported police/crime ingest path is:

`RTL-SDR V4 Dongle` -> `SDRTrunk` -> `Rdio Scanner` -> `Project-Controlled Call Index / OpenMHz-Compatible Backend` -> `Railway Worker` -> `OpenAI STT` -> `Ollama Cloud Extraction` -> `Supabase`

## 2. Roles of Each Component

### 2.1 SDRTrunk
*   Decodes the Franklin County P25 system.
*   Produces per-call audio artifacts and metadata on a persistent local node.

### 2.2 Rdio Scanner
*   Ingests the decoded call files.
*   Provides an operator-facing scanner experience for local validation.
*   Serves as an ingest/UI layer, not the durable backend integration contract for the cloud worker.

### 2.3 Project-Controlled Call Index / OpenMHz-Compatible Backend
*   Exposes stable HTTP endpoints for the worker to poll.
*   Owns the canonical read contract for:
    *   latest call lookup
    *   incremental polling for newer calls
    *   per-call detail fetch
    *   media URL handoff
*   Can be implemented in either of two ways:
    *   A lightweight adapter that reads from local ingest state and emits a small, stable JSON schema.
    *   A self-hosted OpenMHz-compatible backend that exposes call listing routes such as `/:shortName/calls/latest`, `/:shortName/calls/newer`, and `/:shortName/call/:id`.

### 2.4 Railway Worker
*   Polls only project-controlled endpoints.
*   Persists a polling cursor using both `time` and the last processed call ID.
*   Deduplicates calls before transcription.
*   Downloads the audio file using the backend-provided media URL.
*   Sends audio to OpenAI speech-to-text and then to the extraction model.
*   Writes normalized incidents into Supabase/PostGIS.

## 3. Supported and Unsupported Data Sources

### 3.1 Supported
*   Self-hosted SDRTrunk ingest
*   Self-hosted Rdio Scanner for ingest/UI
*   Project-controlled adapter service
*   Self-hosted OpenMHz-compatible backend

### 3.2 Unsupported as Primary Production Dependencies
*   Polling the public OpenMHz hosted API without explicit permission
*   Depending on the public OpenMHz site for direct media URLs
*   Depending on the restricted Rdio Scanner WebSocket API for backend ingestion
*   Depending on Broadcastify as the primary machine-to-machine ingest path

## 4. Polling Contract Requirements

The worker integration contract must support:

*   `latest` lookup for cold start
*   `newer since time` lookup for incremental sync
*   `call by id` fetch for reconciliation
*   A stable call identifier
*   A call timestamp
*   A backend-provided media URL
*   Talkgroup/system metadata needed for filtering and incident enrichment

The worker must not assume:

*   That every audio file is `.wav`
*   That every call can be uniquely identified by timestamp alone
*   That third-party hosted APIs will remain available, documented, or unblocked

## 5. Why This Decision Was Made

The earlier draft docs implied that Rdio Scanner itself would provide a supported REST polling API for recent calls. That is not a reliable assumption for this project.

This architecture was chosen because it:

*   Keeps the backend contract under project control
*   Avoids unsupported or restricted third-party integrations
*   Allows replay, testing, and auditing of ingest behavior
*   Makes it easier for multiple agents or developers to implement the worker consistently
