import { getDbPool } from "@/lib/server/db";
import {
  enrichmentRunSchema,
  geocodingResultSchema,
  type EnrichmentRun,
  type GeocodingResult,
} from "@/lib/types/domain";

type EnrichmentRunRow = {
  id: string;
  source_call_id: string;
  enrichment_job_id: string | null;
  transcript_text: string | null;
  transcription_provider: string | null;
  extraction: unknown;
  geocoding: unknown;
  outcome: string;
  created_at: string | Date;
};

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function coerceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapRow(row: EnrichmentRunRow): EnrichmentRun {
  return enrichmentRunSchema.parse({
    id: row.id,
    sourceCallId: row.source_call_id,
    enrichmentJobId: row.enrichment_job_id,
    transcriptText: row.transcript_text,
    transcriptionProvider: row.transcription_provider,
    extraction: coerceRecord(row.extraction),
    geocoding: geocodingResultSchema.parse(row.geocoding),
    outcome: row.outcome,
    createdAt: toIsoString(row.created_at),
  });
}

export interface EnrichmentRunRepository {
  create(input: {
    sourceCallId: string;
    enrichmentJobId?: string | null;
    transcriptText?: string | null;
    transcriptionProvider?: string | null;
    extraction?: Record<string, unknown>;
    geocoding: GeocodingResult;
    outcome: "published" | "skipped" | "failed";
  }): Promise<EnrichmentRun>;
}

export class PostgresEnrichmentRunRepository implements EnrichmentRunRepository {
  async create(input: {
    sourceCallId: string;
    enrichmentJobId?: string | null;
    transcriptText?: string | null;
    transcriptionProvider?: string | null;
    extraction?: Record<string, unknown>;
    geocoding: GeocodingResult;
    outcome: "published" | "skipped" | "failed";
  }): Promise<EnrichmentRun> {
    const pool = getDbPool();
    const result = await pool.query<EnrichmentRunRow>(
      `
        insert into enrichment_runs (
          source_call_id,
          enrichment_job_id,
          transcript_text,
          transcription_provider,
          extraction,
          geocoding,
          outcome
        )
        values (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5::jsonb,
          $6::jsonb,
          $7
        )
        returning
          id,
          source_call_id,
          enrichment_job_id,
          transcript_text,
          transcription_provider,
          extraction,
          geocoding,
          outcome,
          created_at
      `,
      [
        input.sourceCallId,
        input.enrichmentJobId ?? null,
        input.transcriptText ?? null,
        input.transcriptionProvider ?? null,
        JSON.stringify(input.extraction ?? {}),
        JSON.stringify(input.geocoding),
        input.outcome,
      ],
    );

    return mapRow(result.rows[0]);
  }
}

export function createEnrichmentRunRepository(): EnrichmentRunRepository {
  return new PostgresEnrichmentRunRepository();
}
