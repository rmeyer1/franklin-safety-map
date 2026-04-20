# Technical Architecture Specification: Franklin County Safety Map

## 1. System Overview
The platform is a **Hybrid Geospatial Aggregator**. It uses a persistent Python "Brain" to refine unstructured data and a Node.js/Vercel "Face" to deliver that data to the user via a high-performance map.

## 2. Technology Stack

### 2.1 The Stack
*   **Frontend:** Next.js + Tailwind CSS + **Mapbox GL JS** $\rightarrow$ Hosted on **Vercel**.
*   **The API Layer:** Node.js (Next.js API Routes) $\rightarrow$ Hosted on **Vercel**.
*   **The Engine (The Brain):** FastAPI (Python) + Background Workers $\rightarrow$ Hosted on **Railway.app**.
*   **LLM Intelligence:** Accessed via **Ollama Cloud API** (Remote Inference). The engine sends requests to the cloud provider to avoid local hardware constraints.
*   **Data Core:** **Supabase (PostgreSQL + PostGIS)**. PostGIS is mandatory for spatial queries.

### 2.2 Hosting Blueprint
1.  **Vercel:** Serves the UI and lightweight API requests.
2.  **Railway:** Runs a persistent Python process that never sleeps. This worker handles the "Listen, Parse, and Store" loop.
3.  **Supabase:** The central state. All workers write here; the UI reads from here.

---

## 3. The Data Refinery Pipeline

Since we are aggregating from wildly different sources, we use a "Pipe" architecture.

### 3.1 The "AI-Listener" Pipeline (Police/Crime)
This pipeline transforms raw radio waves into structured map markers using a self-hosted SDR (Software Defined Radio) stack. The project must rely on infrastructure we control rather than polling undocumented or restricted third-party scanner APIs.

**The Hardware/Software Stack:**
`RTL-SDR V4 Dongle` $\rightarrow$ `SDRTrunk (Decoding)` $\rightarrow$ `Rdio Scanner (Ingest + Operator UI)` $\rightarrow$ `Project-Controlled Call Index / OpenMHz-Compatible Backend` $\rightarrow$ `Railway Worker` $\rightarrow$ `OpenAI STT + LLM Extraction` $\rightarrow$ `Supabase`

*   **Audio Capture (The Node):** A dedicated local node (e.g., Raspberry Pi or Mini-PC) runs **SDRTrunk** to decode the Franklin County P25 trunked system.
*   **Ingest + Monitoring:** **Rdio Scanner** is used to ingest decoded audio files and provide an operator-facing scanner UI. It should be treated as an ingest and monitoring component, not as the long-term polling contract for the cloud worker.
*   **Project-Controlled Read API:** A lightweight adapter service or a self-hosted **OpenMHz-compatible backend** exposes stable HTTP endpoints for archived/recent calls. This is the supported polling surface for the Railway worker.
*   **Polling Worker:** The Railway worker polls project-controlled endpoints such as `/:shortName/calls/latest`, `/:shortName/calls/newer?time=...`, and `/:shortName/call/:id`, stores a cursor (`time` + call ID), and deduplicates calls before processing.
*   **Audio Retrieval:** The worker downloads the audio from the media URL returned by the backend. The worker must not assume a fixed extension such as `.wav` or `.mp3`; the source may publish `.wav`, `.m4a`, or `.mp3`.
*   **Transcription:** Audio chunks are sent to the **OpenAI speech-to-text API** (Whisper-family model or current equivalent) for Speech-to-Text conversion.
*   **Entity Extraction:** The transcription is sent to **Ollama Cloud (Llama 3.1 8B)** to extract `Incident Type`, `Location`, and `Priority` in JSON format.
*   **Geocoding:** Extracted text locations are converted to coordinates and pushed to **Supabase (PostGIS)**.

**Architecture Guardrails:**
*   Do not depend on the public **OpenMHz** hosted API as a production ingestion dependency unless explicit permission is obtained from OpenMHz.
*   Do not depend on the restricted **Rdio Scanner WebSocket API** for backend ingestion.
*   Keep the polling contract under project control so the worker can be tested, versioned, and replayed without reverse-engineering external products.

### 3.2 The "Official" Pipeline (Traffic/Transit)
`OHGO API / COTA GTFS-RT` $\rightarrow$ `Python Worker` $\rightarrow$ `PostGIS` $\rightarrow$ `Vercel UI`

*   **Transit:** Protobuf parsing of COTA feeds $\rightarrow$ Update `bus_positions` table.
*   **Traffic:** Polling OHGO API $\rightarrow$ Update `traffic_incidents` and `camera_metadata` tables.

### 3.3 The "Web-Scrape" Pipeline (Fire/EMS)
`PulsePoint Web` $\rightarrow$ `Python Worker (BeautifulSoup/Playwright)` $\rightarrow$ `Supabase`

*   **Polling:** Worker checks the PulsePoint web interface for new incident IDs.
*   **Parsing:** Extracts location and dispatch status.

---

## 4. Internal API Design

### 4.1 The Map Feed (`GET /api/map/active`)
Provides a consolidated JSON of all current events.
*   **Response:** `[ { layer: "fire", type: "medical", coords: [lat, lng], desc: "..." }, { layer: "transit", type: "bus", ... } ]`

### 4.2 The Camera Proxy (`GET /api/camera/{id}`)
Proxies the request to the OHGO API to fetch the latest image without exposing the API key to the frontend.

---

## 5. Database Schema (PostGIS)
*   **`incidents` Table:** `id, type, layer (police/fire/ems), geometry (Point), description, timestamp, status`.
*   **`cameras` Table:** `id, location (Point), current_image_url, last_updated`.
*   **`bus_positions` Table:** `bus_id, route_id, geometry (Point), last_seen`.
*   **`structural_zones` Table:** `zone_id, geometry (Polygon), label`.
