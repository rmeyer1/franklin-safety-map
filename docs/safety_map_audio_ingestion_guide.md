# Audio Ingestion Guide: Software-Only OpenMHz Pipeline

This guide describes the software-only ingest path for the Franklin County Safety Map.

## 1. Objective

The goal is to ingest call audio from OpenMHz, transcribe it, extract structured incident data, and store the results in Supabase for the UI.

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
4.  **Transcribe:** Send the audio to OpenAI speech-to-text.
5.  **Extract structure:** Send the transcript to Ollama Cloud for incident extraction.
6.  **Geocode:** Normalize any usable location text into coordinates.
7.  **Store:** Upsert the normalized incident into Supabase/PostGIS.
8.  **Publish:** Return incidents through the map feed used by the frontend.

## 4. Implementation Requirements

*   The pipeline must be software-only.
*   No Raspberry Pi, SDR, or local scanner software is required.
*   The worker must tolerate duplicate polling results.
*   The worker must not assume a fixed audio file extension.
*   The OpenMHz-specific fetch logic should live behind a small internal adapter boundary.

## 5. Minimal Validation Checklist

*   Confirm a recent call can be discovered.
*   Confirm its audio can be downloaded.
*   Confirm OpenAI STT returns usable text.
*   Confirm the extraction model returns valid JSON.
*   Confirm a resulting incident row can be written to Supabase.

## 6. Production Note

Before production launch, validate that the intended OpenMHz access pattern is acceptable for the product's usage.
