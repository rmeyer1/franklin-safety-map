# Product Requirement Document (PRD): Franklin County Real-Time Safety Map

## 1. Executive Summary
The goal is to build a real-time, geospatial dashboard for Franklin County, Ohio, that aggregates public safety dispatch data, traffic conditions, and transit movements. The platform transforms fragmented "dark data" (audio streams, non-API web pages) into a clean, map-based visual experience, allowing users to see a holistic picture of the county's current state.

## 2. Core Value Proposition
While many tools provide *one* piece of the puzzle (e.g., COTA tracker for buses or PulsePoint for fire), this platform provides the **"Single Pane of Glass"** for urban awareness. It blends official APIs with "AI-listeners" to provide a comprehensive safety and transit overlay.

## 3. Functional Requirements

### 3.1 The Real-Time Safety Map (Primary Feature)
A high-performance map (Mapbox) displaying four distinct data layers:

#### 3.1.1 Fire & EMS Layer (The "Direct" Feed)
*   **Source:** PulsePoint (Columbus Fire).
*   **Capability:** Real-time markers for active fire/medical dispatches.
*   **Details:** Marker colors based on incident type; click-to-expand for incident details (e.g., "Medical Emergency - Unit E3 responding").

#### 3.1.2 Police & Crime Layer (The "AI-Listener" Feed)
*   **Source:** OpenMHz (`frkoh`) hosted call audio and metadata.
*   **Capability:** Text-based incident markers parsed from radio dispatch.
*   **Logic:** Use a background Python worker to poll for new calls, download audio, transcribe it, run LLM extraction, and publish structured incidents to the map.
*   **Details:** Distinguish between "Confirmed Crime" and "Active Dispatch."

#### 3.1.3 Traffic & Infrastructure Layer (The "Official" Feed)
*   **Source:** ODOT OHGO API.
*   **Capability:** 
    *   **Live Cameras:** Interactive icons that open a 5-second snapshot popup of traffic.
    *   **Incidents:** Real-time markers for crashes, construction, and road closures.
*   **Details:** Integration of "Heavy Traffic" heatmaps where available.

#### 3.1.4 Transit Layer (The "Mobility" Feed)
*   **Source:** COTA GTFS-Realtime.
*   **Capability:** Live movement of buses across the county.
*   **Details:** Real-time bus positions, route identification, and delay alerts.

### 3.2 User Experience & Interface
*   **Layer Toggle:** A "Control Center" to turn layers on/off (e.g., "Show only Fire & EMS").
*   **Time-Slicing:** A "Recent History" sidebar showing a chronological feed of all incidents across all layers.
*   **Search & Zoom:** Ability to center the map on a specific address or intersection.
*   **Mobile-First Design:** A PWA (Progressive Web App) experience for users on the go.

## 4. Non-Functional Requirements
*   **Low Latency:** Data should reflect in the UI within < 30 seconds of the event occurring.
*   **Geospatial Accuracy:** Use PostGIS to ensure markers are snapped to the nearest road or address.
*   **Stability:** The background workers must be resilient to API timeouts and "noisy" radio audio.
*   **Scalability:** Support concurrent users viewing high-density map data.

## 5. Success Criteria
*   Successful integration of OHGO API for real-time camera snapshots.
*   Operational "AI-Listener" pipeline that converts a radio call into a map marker.
*   Seamless layering of COTA bus positions over public safety incidents.
*   Sub-second map pan/zoom performance on mobile devices.
