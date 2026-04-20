import { getEnv } from "@/lib/config/env";
import { mockIncidents } from "@/lib/repositories/mock-incidents";
import {
  incidentSchema,
  incidentUpsertSchema,
  mapFeedResponseSchema,
  type Incident,
  type IncidentUpsert,
} from "@/lib/types/domain";
import { getDbPool } from "@/lib/server/db";

export interface IncidentRepository {
  listActive(): Promise<Incident[]>;
  upsert(incident: IncidentUpsert): Promise<Incident>;
}

export class InMemoryIncidentRepository implements IncidentRepository {
  async listActive(): Promise<Incident[]> {
    return mapFeedResponseSchema.parse(mockIncidents);
  }

  async upsert(incident: IncidentUpsert): Promise<Incident> {
    const parsed = incidentUpsertSchema.parse(incident);

    return incidentSchema.parse({
      id: `${parsed.source}-${parsed.sourceEventId ?? crypto.randomUUID()}`,
      layer: parsed.layer,
      category: parsed.category,
      address: parsed.address,
      description: parsed.description,
      severity: parsed.severity,
      severityLabel: severityToLabel(parsed.severity),
      status: parsed.status,
      createdAt: parsed.occurredAt,
      updatedAt: parsed.occurredAt,
      point: parsed.point,
    });
  }
}

type IncidentRow = {
  id: string;
  layer: string;
  category: string;
  address: string;
  description: string;
  severity: number;
  status: string;
  created_at: string | Date;
  updated_at: string | Date;
  lat: number;
  lng: number;
};

function severityToLabel(severity: number): Incident["severityLabel"] {
  if (severity >= 5) return "critical";
  if (severity >= 4) return "high";
  if (severity >= 3) return "medium";
  return "low";
}

function mapRowToIncident(row: IncidentRow): Incident {
  const createdAt =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : row.created_at;
  const updatedAt =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : row.updated_at;

  return incidentSchema.parse({
    id: row.id,
    layer: row.layer,
    category: row.category,
    address: row.address,
    description: row.description,
    severity: row.severity,
    severityLabel: severityToLabel(row.severity),
    status: row.status,
    createdAt,
    updatedAt,
    point: {
      lat: row.lat,
      lng: row.lng,
    },
  });
}

export class PostgresIncidentRepository implements IncidentRepository {
  async listActive(): Promise<Incident[]> {
    const pool = getDbPool();
    const result = await pool.query<IncidentRow>(`
      select
        id,
        layer,
        category,
        address,
        description,
        severity,
        status,
        created_at,
        updated_at,
        ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng
      from incidents
      where status = 'Active'
      order by occurred_at desc
      limit 200
    `);

    return mapFeedResponseSchema.parse(result.rows.map(mapRowToIncident));
  }

  async upsert(incident: IncidentUpsert): Promise<Incident> {
    const pool = getDbPool();
    const parsed = incidentUpsertSchema.parse(incident);
    const result = await pool.query<IncidentRow>(
      `
        insert into incidents (
          source,
          source_event_id,
          layer,
          category,
          address,
          description,
          severity,
          status,
          occurred_at,
          created_at,
          updated_at,
          location,
          metadata
        )
        values (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9::timestamptz,
          now(),
          now(),
          ST_SetSRID(ST_MakePoint($10, $11), 4326)::geography,
          $12::jsonb
        )
        on conflict (source, source_event_id)
        do update set
          layer = excluded.layer,
          category = excluded.category,
          address = excluded.address,
          description = excluded.description,
          severity = excluded.severity,
          status = excluded.status,
          occurred_at = excluded.occurred_at,
          updated_at = now(),
          location = excluded.location,
          metadata = excluded.metadata
        returning
          id,
          layer,
          category,
          address,
          description,
          severity,
          status,
          created_at,
          updated_at,
          ST_Y(location::geometry) as lat,
          ST_X(location::geometry) as lng
      `,
      [
        parsed.source,
        parsed.sourceEventId ?? null,
        parsed.layer,
        parsed.category,
        parsed.address,
        parsed.description,
        parsed.severity,
        parsed.status,
        parsed.occurredAt,
        parsed.point.lng,
        parsed.point.lat,
        JSON.stringify(parsed.metadata),
      ],
    );

    return mapRowToIncident(result.rows[0]);
  }
}

export function createIncidentRepository(): IncidentRepository {
  if (getEnv().SUPABASE_DB_URL) {
    return new PostgresIncidentRepository();
  }

  return new InMemoryIncidentRepository();
}
