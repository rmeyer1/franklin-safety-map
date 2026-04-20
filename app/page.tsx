import { createIncidentRepository } from "@/lib/repositories/incidents";

function severityCount(counts: number[], index: number) {
  return counts[index] ?? 0;
}

export default async function HomePage() {
  const repository = createIncidentRepository();
  const incidents = await repository.listActive();

  const counts = incidents.reduce(
    (acc, incident) => {
      acc.total += 1;
      if (incident.layer === "police") acc.police += 1;
      if (incident.severity >= 4) acc.urgent += 1;
      return acc;
    },
    { total: 0, police: 0, urgent: 0 },
  );

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <div className="eyebrow">Franklin County / Alpha Build</div>
          <h1>Safety map for real dispatch traffic.</h1>
        </div>
        <p>
          The first build wires the agreed architecture into a real project
          shape: Next.js for the dashboard, a TypeScript worker for ingest,
          xAI STT as primary transcription, OpenAI as fallback, and a typed
          incident model the UI can already consume.
        </p>
      </section>

      <section className="stats">
        <article className="stat">
          <label>Active Incidents</label>
          <strong>{counts.total}</strong>
        </article>
        <article className="stat">
          <label>Police Layer</label>
          <strong>{counts.police}</strong>
        </article>
        <article className="stat">
          <label>High / Critical</label>
          <strong>{counts.urgent}</strong>
        </article>
      </section>

      <section className="grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>Map Surface</h2>
              <div className="muted">
                Placeholder surface until Mapbox wiring is added.
              </div>
            </div>
            <span className="badge">API ready</span>
          </div>
          <div className="map-placeholder" aria-hidden="true">
            {incidents.map((incident) => (
              <span
                key={incident.id}
                className="marker"
                data-severity={incident.severityLabel}
                style={{
                  left: `${44 + (incident.point.lng + 83.1) * 60}%`,
                  top: `${56 - (incident.point.lat - 39.9) * 90}%`,
                }}
                title={`${incident.category} at ${incident.address}`}
              />
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>Recent History</h2>
              <div className="muted">Backed by the internal incident schema.</div>
            </div>
            <span className="badge">{severityCount([0, 0], 0) || incidents.length} items</span>
          </div>
          <div className="incident-list">
            {incidents.map((incident) => (
              <article key={incident.id} className="incident-card">
                <div className="incident-meta">
                  <span>{incident.layer}</span>
                  <span>{incident.status}</span>
                </div>
                <h3>{incident.category}</h3>
                <p>{incident.address}</p>
                <p>{incident.description}</p>
              </article>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}

