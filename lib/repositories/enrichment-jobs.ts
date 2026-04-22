import { getDbPool } from "@/lib/server/db";
import {
  enrichmentJobSchema,
  type EnrichmentJob,
} from "@/lib/types/domain";

type EnrichmentJobRow = {
  id: string;
  source_call_id: string;
  job_type: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  available_at: string | Date;
  locked_at: string | Date | null;
  locked_by: string | null;
  last_error: string | null;
  priority: number;
  payload: unknown;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
};

function toIsoString(value: string | Date | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function toRequiredIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapRow(row: EnrichmentJobRow): EnrichmentJob {
  return enrichmentJobSchema.parse({
    id: row.id,
    sourceCallId: row.source_call_id,
    jobType: row.job_type,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    availableAt: toRequiredIsoString(row.available_at),
    lockedAt: toIsoString(row.locked_at),
    lockedBy: row.locked_by,
    lastError: row.last_error,
    priority: row.priority,
    payload: row.payload,
    createdAt: toRequiredIsoString(row.created_at),
    updatedAt: toRequiredIsoString(row.updated_at),
    completedAt: toIsoString(row.completed_at),
  });
}

export interface EnrichmentJobRepository {
  enqueue(input: {
    sourceCallId: string;
    jobType: string;
    maxAttempts?: number;
    priority?: number;
    payload?: unknown;
  }): Promise<EnrichmentJob>;
  getById(id: string): Promise<EnrichmentJob | null>;
  claimNext(input: {
    workerId: string;
    jobType?: string | null;
  }): Promise<EnrichmentJob | null>;
  markCompleted(id: string): Promise<EnrichmentJob>;
  markFailed(input: {
    id: string;
    error: string;
    retryable: boolean;
    retryDelayMs?: number;
  }): Promise<EnrichmentJob>;
}

export class PostgresEnrichmentJobRepository implements EnrichmentJobRepository {
  async enqueue(input: {
    sourceCallId: string;
    jobType: string;
    maxAttempts?: number;
    priority?: number;
    payload?: unknown;
  }): Promise<EnrichmentJob> {
    const pool = getDbPool();
    const maxAttempts = input.maxAttempts ?? 5;
    const priority = input.priority ?? 100;
    const payload = input.payload ?? {};

    const result = await pool.query<EnrichmentJobRow>(
      `
        with inserted as (
          insert into enrichment_jobs (
            source_call_id,
            job_type,
            max_attempts,
            priority,
            payload
          )
          values (
            $1::uuid,
            $2,
            $3,
            $4,
            $5::jsonb
          )
          on conflict (source_call_id, job_type) do nothing
          returning
            id,
            source_call_id,
            job_type,
            status,
            attempt_count,
            max_attempts,
            available_at,
            locked_at,
            locked_by,
            last_error,
            priority,
            payload,
            created_at,
            updated_at,
            completed_at
        )
        select * from inserted
        union all
        select
          id,
          source_call_id,
          job_type,
          status,
          attempt_count,
          max_attempts,
          available_at,
          locked_at,
          locked_by,
          last_error,
          priority,
          payload,
          created_at,
          updated_at,
          completed_at
        from enrichment_jobs
        where source_call_id = $1::uuid and job_type = $2
        limit 1
      `,
      [
        input.sourceCallId,
        input.jobType,
        maxAttempts,
        priority,
        JSON.stringify(payload),
      ],
    );

    if (result.rowCount === 0) {
      throw new Error(
        `Failed to enqueue enrichment job for source call ${input.sourceCallId} and job type ${input.jobType}`,
      );
    }

    return mapRow(result.rows[0]);
  }

  async getById(id: string): Promise<EnrichmentJob | null> {
    const pool = getDbPool();
    const result = await pool.query<EnrichmentJobRow>(
      `
        select
          id,
          source_call_id,
          job_type,
          status,
          attempt_count,
          max_attempts,
          available_at,
          locked_at,
          locked_by,
          last_error,
          priority,
          payload,
          created_at,
          updated_at,
          completed_at
        from enrichment_jobs
        where id = $1::uuid
      `,
      [id],
    );

    if (result.rowCount === 0) {
      return null;
    }

    return mapRow(result.rows[0]);
  }

  async claimNext(input: {
    workerId: string;
    jobType?: string | null;
  }): Promise<EnrichmentJob | null> {
    const pool = getDbPool();
    const result = await pool.query<EnrichmentJobRow>(
      `
        with next_job as (
          select id
          from enrichment_jobs
          where status = 'pending'
            and available_at <= now()
            and attempt_count < max_attempts
            and ($2::text is null or job_type = $2)
          order by priority asc, available_at asc, created_at asc
          for update skip locked
          limit 1
        )
        update enrichment_jobs
        set
          status = 'processing',
          attempt_count = attempt_count + 1,
          locked_at = now(),
          locked_by = $1,
          updated_at = now(),
          last_error = null
        where id in (select id from next_job)
        returning
          id,
          source_call_id,
          job_type,
          status,
          attempt_count,
          max_attempts,
          available_at,
          locked_at,
          locked_by,
          last_error,
          priority,
          payload,
          created_at,
          updated_at,
          completed_at
      `,
      [input.workerId, input.jobType ?? null],
    );

    if (result.rowCount === 0) {
      return null;
    }

    return mapRow(result.rows[0]);
  }

  async markCompleted(id: string): Promise<EnrichmentJob> {
    const pool = getDbPool();
    const result = await pool.query<EnrichmentJobRow>(
      `
        update enrichment_jobs
        set
          status = 'completed',
          locked_at = null,
          locked_by = null,
          last_error = null,
          updated_at = now(),
          completed_at = now()
        where id = $1::uuid
        returning
          id,
          source_call_id,
          job_type,
          status,
          attempt_count,
          max_attempts,
          available_at,
          locked_at,
          locked_by,
          last_error,
          priority,
          payload,
          created_at,
          updated_at,
          completed_at
      `,
      [id],
    );

    return mapRow(result.rows[0]);
  }

  async markFailed(input: {
    id: string;
    error: string;
    retryable: boolean;
    retryDelayMs?: number;
  }): Promise<EnrichmentJob> {
    const pool = getDbPool();
    const retryDelayMs = input.retryDelayMs ?? 60_000;

    const result = await pool.query<EnrichmentJobRow>(
      `
        update enrichment_jobs
        set
          status = case
            when not $2::boolean then 'failed'
            when attempt_count >= max_attempts then 'dead_letter'
            else 'pending'
          end,
          available_at = case
            when $2::boolean and attempt_count < max_attempts
              then now() + ($4::text || ' milliseconds')::interval
            else available_at
          end,
          locked_at = null,
          locked_by = null,
          last_error = $3,
          updated_at = now(),
          completed_at = case
            when not $2::boolean or attempt_count >= max_attempts then now()
            else null
          end
        where id = $1::uuid
        returning
          id,
          source_call_id,
          job_type,
          status,
          attempt_count,
          max_attempts,
          available_at,
          locked_at,
          locked_by,
          last_error,
          priority,
          payload,
          created_at,
          updated_at,
          completed_at
      `,
      [input.id, input.retryable, input.error, retryDelayMs],
    );

    if (result.rowCount === 0) {
      throw new Error(`Enrichment job ${input.id} was not found while marking failed`);
    }

    return mapRow(result.rows[0]);
  }
}

export function createEnrichmentJobRepository(): EnrichmentJobRepository {
  return new PostgresEnrichmentJobRepository();
}
