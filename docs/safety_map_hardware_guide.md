# Hardware Setup Guide: Franklin County Safety Map

This guide provides the step-by-step instructions for configuring the "Listener Node"—the physical hardware that captures radio signals and provides them as an API to the cloud engine.

## 1. Hardware Requirements
To ensure stability and prevent system failure due to "write-wear," the following hardware is required:

*   **Compute:** Raspberry Pi 4 or 5 (Minimum 4GB RAM recommended).
*   **Radio:** RTL-SDR Blog V4 Dongle.
*   **Antenna:** High-gain antenna tuned for P25 frequencies (configured for Franklin County).
*   **Storage (Crucial):** 
    *   **OS:** High-Endurance microSD card (e.g., SanDisk Industrial/MaxEndurance).
    *   **Audio Data:** Small USB SSD (120GB+). **Do not save audio files to the SD card**, as the high frequency of small writes will burn out the flash memory.
*   **Power:** Official Raspberry Pi Power Supply (to prevent under-voltage during SDR spikes).

---

## 2. Software Installation & Configuration

### Step 1: SDRTrunk (The Decoder)
SDRTrunk decodes the P25 trunked radio system used by Franklin County.
1.  **Install:** Deploy the latest SDRTrunk release on the Pi.
2.  **Configuration:**
    *   Select the RTL-SDR V4 as the active tuner.
    *   Configure the **Franklin County P25 System** (Control Channels and Target Talkgroups).
    *   **Audio Export:** Enable the "Record Calls" feature. 
    *   **Pathing:** Set the audio save directory to the mounted USB SSD (e.g., `/mnt/sdr_audio/`).

### Step 2: Rdio Scanner (The Ingest + Operator Layer)
Rdio Scanner ingests the flat audio files and provides a local scanner UI for validation and operations.
1.  **Installation:** Deploy Rdio Scanner via Docker.
2.  **Linking:** Point the Rdio Scanner "Ingest" directory to the same USB SSD folder used by SDRTrunk.
3.  **Verification:** Access the local web UI (port 8080) to confirm that audio files are being detected and categorized by talkgroup.

### Step 3: Call Index / Adapter Service (The Worker Contract)
The cloud worker should poll a project-controlled HTTP surface rather than depending directly on undocumented or restricted scanner product APIs.
1.  **Preferred Option:** Deploy a self-hosted OpenMHz-compatible backend that indexes the calls and returns call metadata plus media URLs.
2.  **Alternative Option:** Deploy a lightweight adapter service that reads from local ingest state and exposes stable endpoints for `latest`, `newer`, and `call-by-id` queries.
3.  **Validation:** Confirm that the adapter/backend can return:
    *   A stable call ID
    *   A call timestamp
    *   Talkgroup/system metadata
    *   A downloadable media URL

### Step 4: Cloudflare Tunnel (The Secure Bridge)
To allow the Railway worker to access the project-controlled backend without opening router ports:
1.  **Install:** Deploy `cloudflared` on the Pi.
2.  **Tunneling:** Create a tunnel mapping a public domain (e.g., `radio.yourdomain.com`) to the adapter/backend HTTP service.
3.  **Security:** Use Cloudflare Zero Trust to restrict access only to the Railway worker's IP range.

---

## 3. Storage Management & Maintenance

Because this system records audio 24/7, storage will eventually fill up. We implement a "Circular Buffer" strategy.

### 3.1 SSD Mounting
Ensure the USB SSD is mounted via `/etc/fstab` to a consistent path (e.g., `/mnt/sdr_audio`).

### 3.2 Automated Cleanup (Cron Job)
To prevent the SSD from filling up, a cleanup script must run every hour to delete old audio files.
*   **The Command:** `find /mnt/sdr_audio -name "*.wav" -mtime +2 -delete`
*   **The Schedule:** Add to crontab (`crontab -e`):
    `0 * * * * find /mnt/sdr_audio -name "*.wav" -mtime +2 -delete`
*   **Result:** Only the last 48 hours of audio are kept. This is more than enough for the Railway worker to process and transcribe the calls.

---

## 4. Consumption Workflow for Developers
Once this node is online, the cloud worker interacts with it as follows:
1.  **Poll:** `GET https://radio.yourdomain.com/frkoh/calls/latest`
2.  **Incremental Sync:** `GET https://radio.yourdomain.com/frkoh/calls/newer?time=<last_seen_time_ms>`
3.  **Reconcile:** `GET https://radio.yourdomain.com/frkoh/call/<call_id>`
4.  **Download:** Fetch the audio file via the media URL returned by the backend. Do not assume a fixed file type such as `.wav` or `.mp3`.
5.  **Process:** Send the file to OpenAI STT $\rightarrow$ Ollama Cloud $\rightarrow$ Supabase.

## 5. Integration Constraints
*   Do not build the worker around the public OpenMHz hosted API unless explicit permission is granted.
*   Do not build the worker around the restricted Rdio Scanner WebSocket API.
*   The polling surface used by the worker must be owned by this project so it can be replayed, tested, and changed safely.
