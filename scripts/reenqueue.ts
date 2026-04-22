/**
 * scripts/reenqueue.ts
 *
 * Requeues source calls for re-enrichment without touching the upstream source adapter.
 *
 * Supports three modes (pick one):
 *   --all                    Re-enqueue every source call (for full replay after codebook/prompt changes)
 *   --since <ISO timestamp>  Re-enqueue calls that occurred at or after the given timestamp
 *   --ids <uuid[,uuid]*>     Re-enqueue specific source call UUIDs
 *
 * Options:
 *   --job-type <string>      Job type to enqueue (default: incident_enrichment)
 *   --dry-run                Print what would be enqueued without enqueueing
 *   --limit <number>         Maximum number of calls to re-enqueue (default: unlimited)
 *   --force                  Re-enqueue even if a pending/processing job already exists
 *
 * Examples:
 *   npx tsx scripts/reenqueue.ts --all --dry-run
 *   npx tsx scripts/reenqueue.ts --since 2026-04-01T00:00:00Z
 *   npx tsx scripts/reenqueue.ts --ids 550e8400-...,660e8400-...
 *   npx tsx scripts/reenqueue.ts --all --limit 100
 */

import { parseArgs } from "node:util";
import { createEnrichmentJobRepository } from "../lib/repositories/enrichment-jobs";
import { closeDbPool } from "../lib/server/db";

const DEFAULT_JOB_TYPE = "incident_enrichment";

interface CliOptions {
  all: boolean;
  since: string | undefined;
  ids: string | undefined;
  "job-type": string;
  limit: number | undefined;
  force: boolean;
  "dry-run": boolean;
}

function getOpts(): CliOptions & { modeError: string } {
  const { values } = parseArgs({
    options: {
      all: { type: "boolean", default: false },
      since: { type: "string" },
      ids: { type: "string" },
      "job-type": { type: "string", default: DEFAULT_JOB_TYPE },
      limit: { type: "string" },
      force: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: false,
  });

  const opts = values as CliOptions;
  const modeCount = [opts.all, opts.since, opts.ids].filter(Boolean).length;

  if (modeCount === 0) {
    return { ...opts, modeError: "Error: specify --all, --since, or --ids" };
  }
  if (modeCount > 1) {
    return { ...opts, modeError: "Error: specify only one of --all, --since, or --ids" };
  }

  if (opts.limit !== undefined) {
    const parsed = Number.parseInt(opts.limit as unknown as string, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return { ...opts, modeError: "Error: --limit must be a positive integer" };
    }
    opts.limit = parsed;
  }

  return { ...opts, modeError: "" };
}

async function getSourceCallIds(opts: {
  all: boolean;
  since?: string;
  ids?: string;
  limit?: number;
}): Promise<string[]> {
  const { getDbPool } = await import("../lib/server/db");
  const pool = getDbPool();

  let query: string;
  const params: unknown[] = [];

  if (opts.ids) {
    const uuids = opts.ids.split(",").map((s) => s.trim()).filter(Boolean);
    if (uuids.length === 0) return [];
    query = `
      select id, occurred_at_ms
      from source_calls
      where id = any($1::uuid[])
      order by occurred_at_ms asc
    `;
    params.push(uuids);
  } else if (opts.all) {
    query = `
      select id, occurred_at_ms
      from source_calls
      order by occurred_at_ms asc
      limit $1
    `;
    params.push(opts.limit ?? null);
  } else if (opts.since) {
    query = `
      select id, occurred_at_ms
      from source_calls
      where occurred_at >= $1::timestamptz
      order by occurred_at_ms asc
      limit $2
    `;
    params.push(opts.since, opts.limit ?? null);
  } else {
    return [];
  }

  const result = await pool.query<{ id: string }>(query, params);
  return result.rows.map((r) => r.id);
}

async function getExistingPendingJob(
  sourceCallId: string,
  jobType: string,
): Promise<string | null> {
  const { getDbPool } = await import("../lib/server/db");
  const pool = getDbPool();
  const result = await pool.query<{ status: string }>(
    `
      select status
      from enrichment_jobs
      where source_call_id = $1::uuid
        and job_type = $2
        and status in ('pending', 'processing')
      limit 1
    `,
    [sourceCallId, jobType],
  );
  return result.rows[0]?.status ?? null;
}

async function main() {
  const opts = getOpts();

  if (opts.modeError) {
    console.error(opts.modeError);
    console.error("\nUsage:");
    console.error("  npx tsx scripts/reenqueue.ts --all [--dry-run] [--limit N] [--force]");
    console.error("  npx tsx scripts/reenqueue.ts --since <ISO timestamp> [--dry-run] [--limit N] [--force]");
    console.error("  npx tsx scripts/reenqueue.ts --ids <uuid[,uuid]*> [--dry-run] [--force]");
    await closeDbPool();
    process.exit(1);
  }

  const dryRun = opts["dry-run"];
  const jobType = opts["job-type"] ?? DEFAULT_JOB_TYPE;

  console.log(
    `[${dryRun ? "DRY RUN" : "LIVE"}] Mode: ${opts.all ? "--all" : opts.since ? `--since ${opts.since}` : `--ids`}`,
  );

  const sourceCallIds = await getSourceCallIds({
    all: opts.all,
    since: opts.since,
    ids: opts.ids,
    limit: opts.limit,
  });

  if (sourceCallIds.length === 0) {
    console.log("No source calls matched the given criteria.");
    await closeDbPool();
    return;
  }

  console.log(`Found ${sourceCallIds.length} source call(s) to re-enqueue as "${jobType}"\n`);

  const jobRepo = createEnrichmentJobRepository();

  let enqueued = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const sourceCallId of sourceCallIds) {
    if (!opts.force) {
      const existingStatus = await getExistingPendingJob(sourceCallId, jobType);
      if (existingStatus) {
        skipped++;
        console.log(`SKIP  ${sourceCallId} — already has ${existingStatus} job`);
        continue;
      }
    }

    if (dryRun) {
      console.log(`WOULD ${sourceCallId}`);
      enqueued++;
      continue;
    }

    try {
      await jobRepo.enqueue({
        sourceCallId,
        jobType,
        maxAttempts: 5,
        priority: 50, // slightly higher than default (100) for replayed calls
      });
      console.log(`ENQ    ${sourceCallId}`);
      enqueued++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // job may have been claimed between our check and the insert
      if (msg.includes("Failed to enqueue")) {
        skipped++;
      } else {
        failed++;
        errors.push({ id: sourceCallId, error: msg });
        console.error(`ERROR  ${sourceCallId}: ${msg}`);
      }
    }
  }

  console.log(`\n─────────────────────────────`);
  console.log(`  enqueued : ${enqueued}`);
  console.log(`  skipped  : ${skipped}`);
  console.log(`  failed   : ${failed}`);

  if (errors.length > 0) {
    console.error("\nErrors:");
    for (const e of errors) {
      console.error(`  ${e.id}: ${e.error}`);
    }
  }

  await closeDbPool();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await closeDbPool();
  process.exit(1);
});
