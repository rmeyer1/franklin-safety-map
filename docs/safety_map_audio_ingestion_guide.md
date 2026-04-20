# Audio Ingestion Guide: Software-Only OpenMHz Pipeline

This guide describes the software-only ingest path for the Franklin County Safety Map.

## 1. Objective

The goal is to ingest call audio from OpenMHz, transcribe it, extract structured incident data, and store the results in Supabase for the UI.

## 1.1 Runtime

The ingest pipeline is implemented in **Node.js + TypeScript**.

## 2. Source

*   **Upstream system:** OpenMHz Franklin County (`frkoh`)
*   **Output needed by the worker:**
    *   call identifier
    *   call timestamp
    *   source metadata such as talkgroup when available
    *   downloadable audio

## 3. Worker Flow

1.  **Poll for new calls:** Query the upstream source for newly available calls.
2.  **Persist cursor state:** Store the most recent processed timestamp plus call ID.
3.  **Download audio:** Fetch the audio file for each newly discovered call.
4.  **Transcribe:** Send the audio to **xAI Speech-to-Text** first.
5.  **Fallback:** If xAI is unavailable, rate-limited, or returns unusable output, retry transcription with **OpenAI STT**.
6.  **Extract structure:** Send the transcript to Ollama Cloud for incident extraction.
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
*   The speech-to-text logic should live behind a provider interface with xAI as primary and OpenAI as fallback.

## 5. Minimal Validation Checklist

*   Confirm a recent call can be discovered.
*   Confirm its audio can be downloaded.
*   Confirm xAI STT returns usable text for a representative sample of calls.
*   Confirm OpenAI fallback STT works when the primary provider is disabled or fails.
*   Confirm the extraction model returns valid JSON.
*   Confirm a resulting incident row can be written to Supabase.

## 6. Production Note

Before production launch, validate that the intended OpenMHz access pattern is acceptable for the product's usage.
