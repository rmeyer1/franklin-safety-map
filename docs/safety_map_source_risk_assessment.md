# Source Risk Assessment: Dispatch Audio Ingest

## Current Decision
The ingest pipeline must be **source-agnostic**. The worker should consume a normalized `SourceCall` contract from a `SourceAdapter`, not poll a vendor-specific API directly.

## Candidate Sources

### OpenMHz
Pros:
- Existing Warren County-aligned system page and media hosting for the current pilot.
- Normal call payload structure appears compatible with incremental polling.
- Media URLs are directly downloadable from this environment.

Risks:
- Public metadata/API endpoints are returning Cloudflare `403` from this server environment.
- Long-term access pattern is not yet proven for unattended server-side polling.
- Upstream availability and allowed automation model are not under project control.

Status:
- Viable as an adapter candidate.
- Not yet proven as a production-safe primary source.

### Browser-Automated Capture
Pros:
- Can potentially recover live payloads when direct server-side JSON is blocked.
- Useful as a validation bridge while testing payload shapes.

Risks:
- Brittle and maintenance-heavy.
- More likely to break on frontend or anti-bot changes.
- Poor long-term foundation for a critical ingest system.

Status:
- Validation fallback only.
- Not recommended as the primary production source.

### Controlled Adapter Service
Pros:
- Lets the worker consume a stable contract the project owns.
- Centralizes retries, caching, deduplication, and observability.
- Reduces source-specific churn in the main worker.

Risks:
- Still depends on proving one upstream fetch path is reliable.
- Adds one small service boundary to deploy and observe.

Status:
- Recommended architecture direction.
- Needs a proven upstream fetch implementation behind it.

## Recommendation
1. Keep the worker source-agnostic.
2. Prove one fetch strategy behind an adapter boundary before deepening the AI-listener pipeline.
3. Treat OpenMHz as a candidate adapter implementation, not a locked platform dependency.
4. Do not expand downstream feature work that assumes OpenMHz remains the final source.
