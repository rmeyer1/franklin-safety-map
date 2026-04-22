# Audio Ingestion Guide: Software-Only OpenMHz Pipeline

This guide describes the software-only ingest path for the current Warren County pilot.

## 1. Objective

The goal is to ingest call audio from OpenMHz, transcribe it, extract structured incident data, and store the results in Supabase for the UI.

## 1.1 Runtime

The ingest pipeline is implemented in **Node.js + TypeScript**.

## 2. Source

*   **Upstream system:** OpenMHz `frkoh` for the current Warren County pilot
*   **Output needed by the worker:**
    *   call identifier
    *   call timestamp
    *   source metadata such as talkgroup when available
    *   downloadable audio

## 3. Worker Flow

1.  **Poll for new calls:** Query the upstream source for newly available calls.
2.  **Persist cursor state:** Store the most recent processed timestamp plus call ID.
3.  **Download audio:** Fetch the audio file for each newly discovered call.
4.  **Transcribe (local-first optional):** If `WHISPER_LOCAL_ENABLED=true`, run **local Whisper CLI** first on the worker host.
5.  **Fallback chain:** If local Whisper is disabled or returns unusable output, retry with **xAI Speech-to-Text**, then **OpenAI STT**.
6.  **Classify and extract structure:** Resolve known radio/call-sign codes from the codebook, then run structured extraction (Ollama when enabled, heuristic fallback always available).
7.  **Geocode:** Normalize any usable location text into coordinates.
8.  **Store:** Upsert the normalized incident into Supabase/PostGIS.
9.  **Publish:** Return incidents through the map feed used by the frontend.

## 4. Implementation Requirements

*   The pipeline must be software-only.
*   No Raspberry Pi, SDR, or local scanner software is required.
*   The pipeline must be implemented in Node.js + TypeScript.
*   The worker must tolerate duplicate polling results.
*   The worker must not assume a fixed audio file extension.
*   The OpenMHz-specific fetch logic should live behind a small internal adapter boundary.
*   The speech-to-text logic should live behind a provider interface that supports local Whisper plus hosted provider fallback.
*   Radio code/call-sign mappings should be maintained in a versioned codebook (`data/radio-codes/*.json`) and applied before/alongside LLM extraction.
*   Extraction output must conform to a strict schema (incident type, category, status hint, confidence, matched codes).

## 5. Minimal Validation Checklist

*   Confirm a recent call can be discovered.
*   Confirm its audio can be downloaded.
*   If local Whisper is enabled, confirm local transcription returns usable text for a representative sample.
*   Confirm xAI STT returns usable text when local Whisper is disabled or unavailable.
*   Confirm OpenAI fallback STT works when upstream providers are disabled or fail.
*   Confirm codebook matches are present in incident metadata when known codes are spoken.
*   Confirm extraction returns schema-valid output and falls back to heuristic parsing if LLM extraction fails.
*   Confirm a resulting incident row can be written to Supabase.

## 6. Production Note

Before production launch, validate that the intended OpenMHz access pattern is acceptable for the product's usage.

Franklin County remains a source-discovery track and should not be described as the active pilot until a verified source path is available.
