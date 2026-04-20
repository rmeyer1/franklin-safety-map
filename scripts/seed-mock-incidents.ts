import { createIncidentRepository } from "@/lib/repositories/incidents";
import { mockIncidents } from "@/lib/repositories/mock-incidents";

async function main() {
  const repository = createIncidentRepository();

  for (const incident of mockIncidents) {
    await repository.upsert({
      source: "seed",
      sourceEventId: incident.id,
      layer: incident.layer,
      category: incident.category,
      address: incident.address,
      description: incident.description,
      severity: incident.severity,
      status: incident.status,
      occurredAt: incident.createdAt,
      point: incident.point,
      metadata: {
        seed: true,
      },
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
