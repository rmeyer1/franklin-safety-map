import { getEnv } from "@/lib/config/env";
import { createEnrichmentJobRepository } from "@/lib/repositories/enrichment-jobs";
import { createIngestCursorRepository } from "@/lib/repositories/ingest-cursors";
import { createSourceCallRepository } from "@/lib/repositories/source-calls";
import { closeDbPool } from "@/lib/server/db";
import { createSourceAdapter } from "@/lib/sources";
import type { IngestCursor, SourceCall } from "@/lib/types/domain";

const DEFAULT_JOB_TYPE = "incident_enrichment";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function advanceCursorForCall(
  deps: WorkerDeps,
  call: SourceCall,
): Promise<void> {
  await deps.cursorRepository.set({
    source: deps.sourceAdapter.source,
    cursorKey: deps.sourceAdapter.cursorKey,
    lastOccurredAtMs: call.occurredAtMs,
    lastSourceEventId: call.sourceEventId,
  });
}

type WorkerDeps = {
  sourceAdapter: ReturnType<typeof createSourceAdapter>;
  cursorRepository: ReturnType<typeof createIngestCursorRepository>;
  sourceCallRepository: ReturnType<typeof createSourceCallRepository>;
  enrichmentJobRepository: ReturnType<typeof createEnrichmentJobRepository>;
};

function createWorkerDeps(): WorkerDeps {
  return {
    sourceAdapter: createSourceAdapter(),
    cursorRepository: createIngestCursorRepository(),
    sourceCallRepository: createSourceCallRepository(),
    enrichmentJobRepository: createEnrichmentJobRepository(),
  };
}

async function processCall(deps: WorkerDeps, call: SourceCall): Promise<void> {
  const storedCall = await deps.sourceCallRepository.put({
    call,
    rawPayload: call,
  });

  const job = await deps.enrichmentJobRepository.enqueue({
    sourceCallId: storedCall.id,
    jobType: DEFAULT_JOB_TYPE,
    payload: {
      source: call.source,
      sourceEventId: call.sourceEventId,
      cursorKey: call.cursorKey,
    },
  });

  await advanceCursorForCall(deps, call);

  console.log(
    JSON.stringify({
      source: call.source,
      sourceEventId: call.sourceEventId,
      occurredAtMs: call.occurredAtMs,
      sourceCallId: storedCall.id,
      jobId: job.id,
      jobType: job.jobType,
      status: "enqueued",
    }),
  );
}

async function processBatch(deps: WorkerDeps): Promise<number> {
  const { sourceAdapter, cursorRepository } = deps;
  const env = getEnv();
  const cursor = await cursorRepository.get(
    sourceAdapter.source,
    sourceAdapter.cursorKey,
  );
  const calls = await sourceAdapter.poll(cursor);
  const unprocessedCalls = calls.filter((call) =>
    isUnprocessedCall(call, cursor),
  );
  const batch = unprocessedCalls.slice(0, env.WORKER_MAX_CALLS_PER_RUN);

  if (unprocessedCalls.length > batch.length) {
    console.log(
      JSON.stringify({
        source: sourceAdapter.source,
        cursorKey: sourceAdapter.cursorKey,
        fetched: calls.length,
        unprocessed: unprocessedCalls.length,
        processed: batch.length,
        remaining: unprocessedCalls.length - batch.length,
        note: "batch_limited",
      }),
    );
  }

  for (const call of batch) {
    await processCall(deps, call);
  }

  return batch.length;
}

function isUnprocessedCall(
  call: SourceCall,
  cursor: IngestCursor | null,
): boolean {
  if (!cursor) {
    return true;
  }

  if (call.occurredAtMs > cursor.lastOccurredAtMs) {
    return true;
  }

  if (call.occurredAtMs < cursor.lastOccurredAtMs) {
    return false;
  }

  return call.sourceEventId !== cursor.lastSourceEventId;
}

async function runOnce(deps: WorkerDeps) {
  await processBatch(deps);
}

async function runLoop(deps: WorkerDeps) {
  const env = getEnv();
  let shuttingDown = false;
  const onSignal = () => {
    shuttingDown = true;
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    while (!shuttingDown) {
      const startedAt = Date.now();
      try {
        const processedCount = await processBatch(deps);
        console.log(
          JSON.stringify({
            mode: "loop",
            processedCount,
            elapsedMs: Date.now() - startedAt,
          }),
        );
      } catch (error) {
        console.error(error);
        if (shuttingDown) {
          break;
        }

        console.log(
          JSON.stringify({
            mode: "loop",
            status: "error_backoff",
            backoffMs: env.WORKER_ERROR_BACKOFF_MS,
          }),
        );
        await sleep(env.WORKER_ERROR_BACKOFF_MS);
        continue;
      }

      if (shuttingDown) {
        break;
      }

      await sleep(env.WORKER_POLL_INTERVAL_MS);
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

async function main() {
  const env = getEnv();
  const deps = createWorkerDeps();

  if (env.WORKER_MODE === "loop") {
    console.log(
      JSON.stringify({
        mode: "loop",
        pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
        errorBackoffMs: env.WORKER_ERROR_BACKOFF_MS,
        maxCallsPerRun: env.WORKER_MAX_CALLS_PER_RUN,
      }),
    );
    await runLoop(deps);
    return;
  }

  await runOnce(deps);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
