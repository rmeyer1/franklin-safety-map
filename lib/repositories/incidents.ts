import { mapFeedResponseSchema, type Incident } from "@/lib/types/domain";
import { mockIncidents } from "@/lib/repositories/mock-incidents";

export interface IncidentRepository {
  listActive(): Promise<Incident[]>;
}

export class InMemoryIncidentRepository implements IncidentRepository {
  async listActive(): Promise<Incident[]> {
    return mapFeedResponseSchema.parse(mockIncidents);
  }
}

export function createIncidentRepository(): IncidentRepository {
  return new InMemoryIncidentRepository();
}

