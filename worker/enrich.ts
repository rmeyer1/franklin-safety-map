import { getEnv } from "@/lib/config/env";
import { createEnrichmentJobRepository } from "@/lib/repositories/enrichment-jobs";
import { createEnrichmentRunRepository } from "@/lib/repositories/enrichment-runs";
import { createSourceCallRepository } from "@/lib/repositories/source-calls";
import { closeDbPool } from "@/lib/server/db";
import {
  createSourceCallEnrichmentService,
  SkippableEnrichmentError,
} from "@/lib/services/enrich-source-call";
import { geocodingResultSchema } from "@/lib/types/domain";

const DEFAULT_JOB_TYPE = "incident_enrichment";
const DEFAULT_WORKER_ID = `enrich-${process.pid}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type WorkerDeps = {
  enrichmentJobRepository: ReturnType<typeof createEnrichmentJobRepository>;
  enrichmentRunRepository: ReturnType<typeof createEnrichmentRunRepository>;
  sourceCallRepository: ReturnType<typeof createSourceCallRepository>;
  sourceCallEnrichmentService: ReturnType<typeof createSourceCallEnrichmentService>;
};

function createWorkerDeps(): WorkerDeps {
  return {
    enrichmentJobRepository: createEnrichmentJobRepository(),
    enrichmentRunRepository: createEnrichmentRunRepository(),
    sourceCallRepository: createSourceCallRepository(),
    sourceCallEnrichmentService: createSourceCallEnrichmentService(),
  };
}

async function processNextJob(deps: WorkerDeps, workerId: string): Promise<boolean> {
  const job = await deps.enrichmentJobRepository.claimNext({
    workerId,
    jobType: DEFAULT_JOB_TYPE,
  });

  if (!job) {
    return false;
  }

  try {
    const result = await deps.sourceCallEnrichmentService.enrich({
      sourceCallId: job.sourceCallId,
      enrichmentJobId: job.id,
    });
    await deps.enrichmentJobRepository.markCompleted(job.id);

    console.log(
      JSON.stringify({
        jobId: job.id,
        sourceCallId: job.sourceCallId,
        sourceEventId: result.sourceCall.sourceEventId,
        provider: result.transcriptionProvider,
        severity: result.severity,
        category: result.category,
        incidentType: result.incidentType,
        statusHint: result.statusHint,
        extractionConfidence: result.extractionConfidence,
        incidentId: result.incidentId,
        status: "completed",
      }),
    );
  } catch (error) {
    if (error instanceof SkippableEnrichmentError) {
      const sourceCall = await deps.sourceCallRepository.getById(job.sourceCallId);
      if (sourceCall) {
        await deps.enrichmentRunRepository.create({
          sourceCallId: sourceCall.id,
          enrichmentJobId: job.id,
          transcriptText: sourceCall.transcriptText,
          transcriptionProvider: null,
          extraction: {
            skippedReason: error.reason,
          },
          geocoding: geocodingResultSchema.parse({
            provider: "none",
            resolved: false,
            confidence: 0,
            query: null,
            reason: error.reason,
            point: null,
          }),
          outcome: "skipped",
        });
      }

      await deps.enrichmentJobRepository.markCompleted(job.id);
      console.log(
        JSON.stringify({
          jobId: job.id,
          sourceCallId: job.sourceCallId,
          skipped: true,
          reason: error.reason,
          status: "completed",
        }),
      );
      return true;
    }

    const message = error instanceof Error ? error.message : "Unknown enrichment error";
    const failedJob = await deps.enrichmentJobRepository.markFailed({
      id: job.id,
      error: message,
      retryable: true,
    });

    console.log(
      JSON.stringify({
        jobId: job.id,
        sourceCallId: job.sourceCallId,
        status: failedJob.status,
        lastError: failedJob.lastError,
        attemptCount: failedJob.attemptCount,
      }),
    );
  }

  return true;
}

async function runOnce(deps: WorkerDeps, workerId: string) {
  let processedCount = 0;
  const maxJobsPerRun = getEnv().WORKER_MAX_CALLS_PER_RUN;

  while (processedCount < maxJobsPerRun) {
    const processed = await processNextJob(deps, workerId);
    if (!processed) {
      break;
    }

    processedCount += 1;
  }

  console.log(
    JSON.stringify({
      mode: "once",
      workerId,
      processedCount,
      jobType: DEFAULT_JOB_TYPE,
    }),
  );
}

async function runLoop(deps: WorkerDeps, workerId: string) {
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
        const processed = await processNextJob(deps, workerId);
        console.log(
          JSON.stringify({
            mode: "loop",
            workerId,
            processed,
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
  const workerId = DEFAULT_WORKER_ID;

  if (env.WORKER_MODE === "loop") {
    console.log(
      JSON.stringify({
        mode: "loop",
        workerId,
        pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
        errorBackoffMs: env.WORKER_ERROR_BACKOFF_MS,
        maxJobsPerRun: env.WORKER_MAX_CALLS_PER_RUN,
        jobType: DEFAULT_JOB_TYPE,
      }),
    );
    await runLoop(deps, workerId);
    return;
  }

  await runOnce(deps, workerId);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
