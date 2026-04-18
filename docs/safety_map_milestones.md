# Development Roadmap & Milestone Checklist: Franklin County Safety Map

This document provides a structured execution path for the development team. The project is broken into five phases, moving from infrastructure to "Intelligence."

## 🟢 Phase 0: Hardware & Local Setup
*Goal: Establish the physical audio capture layer.*

- [ ] **Hardware Acquisition:** Purchase and configure RTL-SDR V4 Dongle and antenna.
- [ ] **SDRTrunk Configuration:** Install SDRTrunk on a persistent local node; configure for Franklin County P25 system.
- [ ] **Rdio Scanner Setup:** Deploy Rdio Scanner to expose the local audio API.
- [ ] **Connectivity Test:** Verify that a local API call can retrieve a recent audio file from a police dispatch.

## 🟡 Phase 1: Infrastructure & Foundation (The Plumbing)
... (keep existing)

## 🟡 Phase 2: The Official Data Pipeline (Easy Wins)
*Goal: Get the reliable, API-driven data onto the map.*

- [ ] **Transit Layer (COTA):**
    - [ ] Implement GTFS-Realtime parser in the Railway worker.
    - [ ] Sync live bus positions to Supabase.
    - [ ] Render moving bus markers on the Mapbox UI.
- [ ] **Traffic Layer (ODOT OHGO):**
    - [ ] Implement OHGO API client to fetch cameras and incidents.
    - [ ] Store camera metadata and coordinates in Supabase.
    - [ ] Create the "Camera Snapshot" popup in the UI.
- [ ] **Fire/EMS Layer (PulsePoint):**
    - [ ] Implement the PulsePoint web-polling worker.
    - [ ] Extract incident type and location.
    - [ ] Render fire/medical markers with distinct colors on the map.

## 🟠 Phase 3: The AI-Listener (The "Alpha" Edge)
*Goal: Transform raw audio into structured geospatial intelligence.*

- [ ] **Audio Stream Integration:**
    - [ ] Connect to Broadcastify streams for Columbus Police/Fire.
    - [ ] Implement audio chunking and buffering in Python.
- [ ] **Transcription Pipeline:**
    - [ ] Integrate OpenAI Whisper for Speech-to-Text (STT).
    - [ ] Implement a "Noise Filter" to ignore non-dispatch chatter.
- [ ] **NER Extraction (The Brain):**
    - [ ] Connect to **Ollama Cloud** (Llama 3.1 8B).
    - [ ] Implement the "Few-Shot" prompt for JSON extraction (Type, Location, Priority).
    - [ ] Implement the "Auditor" logic (routing critical calls to a larger model).
- [ ] **Geocoding:**
    - [ ] Convert extracted text addresses (e.g., "High and Broad") into Lat/Lng coordinates.
    - [ ] Push finalized "Crime" incidents to the Supabase map feed.

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
- [ ] **Deployment:** Final production push to Vercel/Railway.
