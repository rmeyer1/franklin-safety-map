# Development Roadmap & Milestone Checklist: Warren County Pilot Safety Map

This document provides a structured execution path for the development team. The project is broken into five phases, moving from infrastructure to "Intelligence."

## 🟢 Phase 0: Source Validation & Ingestion Setup
*Goal: Establish the software-only ingest path.*

- [x] **Pilot County Decision:** Use Warren County as the active OpenMHz pilot and keep Franklin County as a separate source-discovery track.
- [ ] **OpenMHz Source Validation:** Confirm the Warren County-aligned `frkoh` source provides the call metadata and downloadable audio needed by the worker.
- [x] **Source Adapter Abstraction:** Refactor ingest around a normalized `SourceAdapter` / `SourceCall` contract so the worker is not coupled to one upstream provider.
- [ ] **Source Risk Gate:** Decide whether OpenMHz is production-viable, validation-only, or needs to be replaced by another controlled source path before expanding downstream AI work.
- [ ] **TypeScript Worker Skeleton:** Stand up the Node.js + TypeScript worker runtime and shared config.
- [ ] **Polling Prototype:** Implement a worker loop that can detect new calls and persist polling state.
- [ ] **Audio Download Test:** Verify the worker can fetch a recent call audio file end-to-end.
- [ ] **Deduplication State:** Persist `time` plus call ID so the worker can resume without reprocessing the same call.

## 🟡 Phase 1: Infrastructure & Foundation (The Plumbing)
... (keep existing)

## 🟡 Phase 2: The Official Data Pipeline (Easy Wins)
*Goal: Get the reliable, API-driven data onto the map.*

- [ ] **Transit Layer (COTA):**
    - [ ] Implement GTFS-Realtime parser in the Render TypeScript worker.
    - [ ] Sync live bus positions to Supabase.
    - [ ] Render moving bus markers on the Mapbox UI.
- [ ] **Traffic Layer (ODOT OHGO):**
    - [ ] Implement OHGO API client to fetch cameras and incidents.
    - [ ] Store camera metadata and coordinates in Supabase.
    - [ ] Create the "Camera Snapshot" popup in the UI.
- [ ] **Fire/EMS Layer (PulsePoint):**
    - [ ] Implement the PulsePoint web-polling worker in TypeScript.
    - [ ] Extract incident type and location.
    - [ ] Render fire/medical markers with distinct colors on the map.

## 🟠 Phase 3: The AI-Listener (The "Alpha" Edge)
*Goal: Transform raw audio into structured geospatial intelligence.*

- [ ] **Source Freeze Decision:**
    - [ ] Confirm the production source strategy before expanding source-specific ingest logic.
    - [ ] Keep the worker consuming only the normalized source adapter contract.
- [ ] **Audio Stream Integration:**
    - [ ] Complete one proven source adapter -> polling worker ingest chain.
    - [ ] Keep polling state management generic across adapters using `time` plus source event ID deduplication.
- [ ] **Transcription Pipeline:**
    - [ ] Integrate xAI Speech-to-Text as the default provider.
    - [ ] Integrate OpenAI STT as the fallback provider.
    - [ ] Add provider routing, retries, and failure handling.
    - [ ] Implement a "Noise Filter" to ignore non-dispatch chatter.
- [ ] **NER Extraction (The Brain):**
    - [ ] Connect to **Ollama Cloud** (Llama 3.1 8B).
    - [ ] Implement the "Few-Shot" prompt for JSON extraction (Type, Location, Priority).
    - [ ] Implement the "Auditor" logic (routing critical calls to a larger model).
- [ ] **Geocoding:**
    - [ ] Convert extracted text addresses (e.g., "High and Broad") into Lat/Lng coordinates.
    - [ ] Push finalized "Crime" incidents to the Supabase map feed.

## Notes
- The product is software-only and does not include a local radio capture node.
- The backend and worker stack are Node.js + TypeScript, not Python.
- OpenMHz access assumptions should be validated before production hardening.
- The worker should not depend directly on one upstream provider; source-specific fetch logic must stay inside adapter implementations.

## 🔴 Phase 4: Advanced Geospatial UX (The Terminal)
*Goal: Transform a map into a professional decision-support tool.*

- [ ] **Layer Management:**
    - [ ] Build the "Control Center" toggle for Fire, Police, Traffic, and Transit.
    - [ ] Implement "Sieve" filtering (e.g., "Only show Critical incidents").
- [ ] **Spatio-Temporal Analysis:**
    - [ ] Implement PostGIS proximity queries (e.g., "Incidents within 1km").
    - [ ] Build the "Recent History" chronological feed sidebar.
- [ ] **PWA Optimization:**
    - [ ] Configure Manifest and Service Workers for offline-first/mobile performance.
    - [ ] Optimize Mapbox rendering for mobile GPUs.

## 🔵 Phase 5: Hardening & Launch
*Goal: Stability, accuracy, and production readiness.*

- [ ] **Stress Testing:** Verify the background worker can handle peak-hour radio traffic without lagging.
- [ ] **Accuracy Audit:** Compare AI-extracted locations against actual official reports to tune prompts.
- [ ] **UI Polish:** Finalize the "Dark Mode" professional aesthetic.
- [ ] **Deployment:** Final production push to Vercel/Render.
