import {
  ingestCursorSchema,
  type IngestCursor,
} from "@/lib/types/domain";
import { getDbPool } from "@/lib/server/db";

type IngestCursorRow = {
  source: string;
  cursor_key: string;
  last_occurred_at_ms: number;
  last_source_event_id: string | null;
  updated_at: string | Date;
};

function mapRow(row: IngestCursorRow): IngestCursor {
  return ingestCursorSchema.parse({
    source: row.source,
    cursorKey: row.cursor_key,
    lastOccurredAtMs: row.last_occurred_at_ms,
    lastSourceEventId: row.last_source_event_id,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
  });
}

export interface IngestCursorRepository {
  get(source: string, cursorKey: string): Promise<IngestCursor | null>;
  set(input: {
    source: string;
    cursorKey: string;
    lastOccurredAtMs: number;
    lastSourceEventId: string | null;
  }): Promise<IngestCursor>;
}

export class PostgresIngestCursorRepository implements IngestCursorRepository {
  async get(source: string, cursorKey: string): Promise<IngestCursor | null> {
    const pool = getDbPool();
    const result = await pool.query<IngestCursorRow>(
      `
        select
          source,
          cursor_key,
          last_occurred_at_ms,
          last_source_event_id,
          updated_at
        from ingest_cursors
        where source = $1 and cursor_key = $2
      `,
      [source, cursorKey],
    );

    if (result.rowCount === 0) {
      return null;
    }

    return mapRow(result.rows[0]);
  }

  async set(input: {
    source: string;
    cursorKey: string;
    lastOccurredAtMs: number;
    lastSourceEventId: string | null;
  }): Promise<IngestCursor> {
    const pool = getDbPool();
    const result = await pool.query<IngestCursorRow>(
      `
        insert into ingest_cursors (
          source,
          cursor_key,
          last_occurred_at_ms,
          last_source_event_id,
          updated_at
        )
        values ($1, $2, $3, $4, now())
        on conflict (source, cursor_key)
        do update set
          last_occurred_at_ms = excluded.last_occurred_at_ms,
          last_source_event_id = excluded.last_source_event_id,
          updated_at = now()
        returning
          source,
          cursor_key,
          last_occurred_at_ms,
          last_source_event_id,
          updated_at
      `,
      [
        input.source,
        input.cursorKey,
        input.lastOccurredAtMs,
        input.lastSourceEventId,
      ],
    );

    return mapRow(result.rows[0]);
  }
}

export function createIngestCursorRepository(): IngestCursorRepository {
  return new PostgresIngestCursorRepository();
}

