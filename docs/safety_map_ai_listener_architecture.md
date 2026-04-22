# AI-Listener Architecture Decision Record

This document defines the supported ingest architecture for the current pilot safety map. It exists to prevent drift in future implementation work and to give reviewers a single source of truth for the scanner pipeline.

## 1. Canonical Architecture

The supported police/crime ingest path is:

`OpenMHz (frkoh)` -> `TypeScript Polling/Fetch Worker` -> `xAI STT (primary)` / `OpenAI STT (fallback)` -> `Ollama Cloud Extraction` -> `Supabase` -> `Vercel UI`

## 2. Product Shape

This product is now explicitly **software-only**.

It does **not** include:

*   Raspberry Pi hardware
*   RTL-SDR dongles
*   antennas
*   SDRTrunk
*   Rdio Scanner
*   any local radio capture node

## 3. Roles of Each Component

### 3.1 OpenMHz
*   Acts as the upstream source of call metadata and hosted audio for the current Warren County pilot via the `frkoh` system.
*   Provides the audio artifacts that the worker downloads and processes.

### 3.2 Polling/Fetch Worker
*   Polls for newly published calls.
*   Persists a polling cursor using both `time` and the last processed call ID.
*   Deduplicates calls before transcription.
*   Downloads the audio file for each newly discovered call.
*   Normalizes upstream call metadata into the internal processing schema.
*   Runs in Node.js with TypeScript rather than Python.

### 3.3 xAI STT (Primary)
*   Acts as the default speech-to-text provider for downloaded call audio.
*   Is the initial cost-optimized provider for the MVP transcription path.

### 3.4 OpenAI STT (Fallback)
*   Acts as the fallback speech-to-text provider when xAI is unavailable or unsuitable for a given call.
*   Provides a second provider path for resilience and quality benchmarking.

### 3.5 Ollama Cloud Extraction
*   Converts the transcription into structured incident JSON.
*   Extracts incident type, raw location text, normalized address when available, and priority/confidence signals.

### 3.6 Supabase/PostGIS
*   Stores normalized incidents.
*   Supports map queries, recent-history feeds, and geospatial filtering.

### 3.7 Vercel UI
*   Renders the incident feed and map overlays for the end user.

## 4. Worker Contract Requirements

The ingest worker must support:

*   polling for newly available calls
*   stable resume behavior after restarts
*   deduplication using both timestamp and call ID
*   downloading audio without assuming a fixed file extension
*   provider-based STT routing so xAI can be primary and OpenAI can be fallback
*   a clear boundary between upstream fetch logic and downstream transcription/extraction logic

The ingest worker must not assume:

*   that timestamps alone are unique
*   that every call has identical metadata
*   that every audio file uses the same container or codec

## 5. Operational Constraints

*   OpenMHz is the upstream dependency for the police/crime AI-listener.
*   The pipeline should encapsulate OpenMHz-specific fetch logic behind a narrow internal interface so the rest of the system stays provider-agnostic.
*   The pipeline should encapsulate speech-to-text behind a provider interface so xAI and OpenAI can be benchmarked or swapped without changing downstream extraction code.
*   Before production launch, validate the intended access pattern for OpenMHz-hosted metadata and audio.

## 6. Why This Decision Was Made

The product previously assumed a self-hosted radio capture stack. That is no longer the plan.

The new decision is to prioritize a software-only MVP that:

*   ingests existing hosted scanner audio
*   uses Node.js + TypeScript across the backend and worker stack
*   uses xAI STT first and OpenAI STT as fallback
*   minimizes infrastructure complexity
*   lets the team focus on transcription, extraction, and UI value
*   avoids spending time on hardware setup that is no longer required

## 7. Pilot Scope

The active pilot county is Warren County because the currently validated `frkoh` OpenMHz source aligns with Warren County dispatch traffic. Franklin County remains a separate source-discovery track and is not the current pilot claim.
