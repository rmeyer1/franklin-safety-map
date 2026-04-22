import { getDbPool } from "@/lib/server/db";
import {
  sourceCallSchema,
  storedSourceCallSchema,
  type SourceCall,
  type StoredSourceCall,
} from "@/lib/types/domain";

type SourceCallRow = {
  id: string;
  source: string;
  cursor_key: string;
  source_event_id: string;
  occurred_at: string | Date;
  occurred_at_ms: number | string;
  audio_url: string | null;
  file_name: string | null;
  transcript_text: string | null;
  channel: string | null;
  label: string | null;
  duration_seconds: number | null;
  metadata: unknown;
  raw_payload: unknown;
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

function mapRow(row: SourceCallRow): StoredSourceCall {
  return storedSourceCallSchema.parse({
    id: row.id,
    source: row.source,
    cursorKey: row.cursor_key,
    sourceEventId: row.source_event_id,
    occurredAt: toIsoString(row.occurred_at),
    occurredAtMs:
      typeof row.occurred_at_ms === "string"
        ? Number.parseInt(row.occurred_at_ms, 10)
        : row.occurred_at_ms,
    audioUrl: row.audio_url,
    fileName: row.file_name,
    transcriptText: row.transcript_text,
    channel: row.channel,
    label: row.label,
    durationSeconds: row.duration_seconds,
    metadata: coerceRecord(row.metadata),
    rawPayload: row.raw_payload,
    createdAt: toIsoString(row.created_at),
  });
}

export interface SourceCallRepository {
  put(input: {
    call: SourceCall;
    rawPayload?: unknown;
  }): Promise<StoredSourceCall>;
  getBySourceEvent(
    source: string,
    sourceEventId: string,
  ): Promise<StoredSourceCall | null>;
}

export class PostgresSourceCallRepository implements SourceCallRepository {
  async put(input: {
    call: SourceCall;
    rawPayload?: unknown;
  }): Promise<StoredSourceCall> {
    const pool = getDbPool();
    const parsedCall = sourceCallSchema.parse(input.call);
    const rawPayload = input.rawPayload ?? parsedCall;

    const result = await pool.query<SourceCallRow>(
      `
        with inserted as (
          insert into source_calls (
            source,
            cursor_key,
            source_event_id,
            occurred_at,
            occurred_at_ms,
            audio_url,
            file_name,
            transcript_text,
            channel,
            label,
            duration_seconds,
            metadata,
            raw_payload
          )
          values (
            $1,
            $2,
            $3,
            $4::timestamptz,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12::jsonb,
            $13::jsonb
          )
          on conflict (source, source_event_id) do nothing
          returning
            id,
            source,
            cursor_key,
            source_event_id,
            occurred_at,
            occurred_at_ms,
            audio_url,
            file_name,
            transcript_text,
            channel,
            label,
            duration_seconds,
            metadata,
            raw_payload,
            created_at
        )
        select * from inserted
        union all
        select
          id,
          source,
          cursor_key,
          source_event_id,
          occurred_at,
          occurred_at_ms,
          audio_url,
          file_name,
          transcript_text,
          channel,
          label,
          duration_seconds,
          metadata,
          raw_payload,
          created_at
        from source_calls
        where source = $1 and source_event_id = $3
        limit 1
      `,
      [
        parsedCall.source,
        parsedCall.cursorKey,
        parsedCall.sourceEventId,
        parsedCall.occurredAt,
        parsedCall.occurredAtMs,
        parsedCall.audioUrl,
        parsedCall.fileName,
        parsedCall.transcriptText,
        parsedCall.channel,
        parsedCall.label,
        parsedCall.durationSeconds,
        JSON.stringify(parsedCall.metadata),
        JSON.stringify(rawPayload),
      ],
    );

    return mapRow(result.rows[0]);
  }

  async getBySourceEvent(
    source: string,
    sourceEventId: string,
  ): Promise<StoredSourceCall | null> {
    const pool = getDbPool();
    const result = await pool.query<SourceCallRow>(
      `
        select
          id,
          source,
          cursor_key,
          source_event_id,
          occurred_at,
          occurred_at_ms,
          audio_url,
          file_name,
          transcript_text,
          channel,
          label,
          duration_seconds,
          metadata,
          raw_payload,
          created_at
        from source_calls
        where source = $1 and source_event_id = $2
      `,
      [source, sourceEventId],
    );

    if (result.rowCount === 0) {
      return null;
    }

    return mapRow(result.rows[0]);
  }
}

export function createSourceCallRepository(): SourceCallRepository {
  return new PostgresSourceCallRepository();
}
