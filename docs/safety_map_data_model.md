# Data Model Specification: Franklin County Safety Map

## 1. Geospatial Foundation
The system relies on **PostGIS** (PostgreSQL extension) to handle all location-based data. All coordinates are stored as `GEOMETRY(Point, 4326)`.

## 2. Database Schema (Supabase)

### 2.1 Table: `incidents` (The Master Feed)
This table stores all real-time events from the AI-Listener, PulsePoint, and OHGO.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | PK (UUID) | Unique incident identifier |
| `layer` | Enum | "police", "fire", "ems", "traffic" |
| `category` | String | e.g., "Medical", "Structure Fire", "Traffic Accident" |
| `location` | Geometry(Point) | Exact lat/lng coordinate |
| `address` | String | Human-readable address or intersection |
| `description` | Text | Full details of the dispatch call |
| `severity` | Int | 1 (Low) to 5 (Critical) |
| `status` | Enum | "Active", "Resolved", "Archived" |
| `created_at` | Timestamp | When the incident was first detected |
| `updated_at` | Timestamp | Last update to the incident |

### 2.2 Table: `traffic_cameras`
Stores the metadata and current state of ODOT cameras.

| Field | Type | Description |
| :--- | :--- | :--- |
| `camera_id` | PK (String) | Official ODOT camera ID |
| `location` | Geometry(Point) | Camera coordinate |
| `image_url` | String | Link to the latest snapshot |
| `last_snapshot`| Timestamp | When the image was last refreshed |
| `is_active` | Boolean | Whether the camera is currently online |

### 2.3 Table: `bus_positions` (High-Churn Table)
This table is updated every few seconds.

| Field | Type | Description |
| :--- | :--- | :--- |
| `bus_id` | PK (String) | Unique vehicle ID from COTA |
| `route_id` | String | Route number |
| `position` | Geometry(Point) | Real-time coordinate |
| `heading` | Float | Direction the bus is facing (for icon rotation) |
| `last_seen` | Timestamp | Last heartbeat from GTFS-RT |

### 2.4 Table: `structural_zones`
Used to define "Danger Zones" or "High-Traffic Areas."

| Field | Type | Description |
| :--- | :--- | :--- |
| `zone_id` | PK (UUID) | Unique zone ID |
| `geometry` | Geometry(Polygon) | The shape of the area |
| `label` | String | e.g., "Short North District", "OSU Campus" |
| `risk_level` | String | "Low", "Medium", "High" |

## 3. Spatial Queries (The "Secret Sauce")
The API will use PostGIS for the following a la carte queries:
*   **Proximity Search:** `ST_DWithin(incidents.location, user_location, 1000)` $\rightarrow$ Find all incidents within 1km of the user.
*   **Zone Check:** `ST_Contains(structural_zones.geometry, incidents.location)` $\rightarrow$ Determine which neighborhood an incident occurred in.
*   **Route Buffer:** `ST_Buffer(bus_route.geometry, 50)` $\rightarrow$ Find all incidents occurring within 50 meters of a bus route.
