import { createIngestCursorRepository } from "@/lib/repositories/ingest-cursors";
import { createIncidentRepository } from "@/lib/repositories/incidents";
import { closeDbPool } from "@/lib/server/db";
import { createIncidentExtractionService } from "@/lib/services/extract-incident";
import { createSourceAdapter } from "@/lib/sources";
import {
  createTranscriptionService,
  TranscriptionFailedError,
} from "@/lib/services/transcribe-audio";
import { getEnv } from "@/lib/config/env";
import type { IngestCursor, SourceCall, Transcription } from "@/lib/types/domain";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function inferMimeType(url: string, contentType: string | null): string {
  if (contentType && contentType.length > 0) {
    return contentType.split(";")[0];
  }

  if (url.endsWith(".wav")) return "audio/wav";
  if (url.endsWith(".m4a")) return "audio/mp4";
  if (url.endsWith(".ogg")) return "audio/ogg";
  if (url.endsWith(".webm")) return "audio/webm";
  return "audio/mpeg";
}

async function downloadAudio(
  url: string,
): Promise<{ audio: Buffer; mimeType: string }> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Audio download failed with status ${response.status}`);
  }

  return {
    audio: Buffer.from(await response.arrayBuffer()),
    mimeType: inferMimeType(url, response.headers.get("content-type")),
  };
}

function inferFileExtension(url: string, mimeType: string): string {
  const pathname = new URL(url).pathname.toLowerCase();
  const dotIndex = pathname.lastIndexOf(".");
  if (dotIndex > pathname.lastIndexOf("/")) {
    const fromUrl = pathname.slice(dotIndex + 1);
    if (fromUrl.length > 0 && fromUrl.length <= 8) {
      return fromUrl;
    }
  }

  switch (mimeType) {
    case "audio/wav":
      return "wav";
    case "audio/mp4":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    case "audio/webm":
      return "webm";
    default:
      return "mp3";
  }
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
  incidentRepository: ReturnType<typeof createIncidentRepository>;
  transcriptionService: ReturnType<typeof createTranscriptionService>;
  extractionService: ReturnType<typeof createIncidentExtractionService>;
};

function createWorkerDeps(): WorkerDeps {
  return {
    sourceAdapter: createSourceAdapter(),
    cursorRepository: createIngestCursorRepository(),
    incidentRepository: createIncidentRepository(),
    transcriptionService: createTranscriptionService(),
    extractionService: createIncidentExtractionService(),
  };
}

async function processCall(deps: WorkerDeps, call: SourceCall): Promise<void> {
  const {
    sourceAdapter,
    cursorRepository,
    incidentRepository,
    transcriptionService,
    extractionService,
  } = deps;

  let transcriptText = call.transcriptText;
  let transcriptionProvider: Transcription["provider"] | "source" = "source";

  if (!transcriptText) {
    if (!call.audioUrl) {
      await advanceCursorForCall(deps, call);
      console.log(
        JSON.stringify({
          source: call.source,
          sourceEventId: call.sourceEventId,
          skipped: true,
          reason: "missing_audio_and_transcript",
        }),
      );
      return;
    }

    const { audio, mimeType } = await downloadAudio(call.audioUrl);
    const fallbackFileName = `${call.sourceEventId}.${inferFileExtension(call.audioUrl, mimeType)}`;
    let transcription;

    try {
      transcription = await transcriptionService.transcribe({
        audio,
        fileName: call.fileName ?? fallbackFileName,
        mimeType,
      });
    } catch (error) {
      if (
        error instanceof TranscriptionFailedError &&
        error.kind === "no_speech"
      ) {
        await advanceCursorForCall(deps, call);
        console.log(
          JSON.stringify({
            source: call.source,
            sourceEventId: call.sourceEventId,
            skipped: true,
            reason: "no_speech_detected",
          }),
        );
        return;
      }

      throw error;
    }

    transcriptText = transcription.text;
    transcriptionProvider = transcription.provider;
  }

  const incident = await extractionService.extractFromTranscript(transcriptText);

  const savedIncident = await incidentRepository.upsert({
    source: call.source,
    sourceEventId: call.sourceEventId,
    layer: "police",
    category: incident.category ?? "Radio Dispatch",
    address: incident.address ?? call.label ?? "Unknown location",
    description: incident.summary,
    severity: incident.severity,
    status: "Active",
    occurredAt: call.occurredAt,
    point: {
      lat: 39.9612,
      lng: -82.9988,
    },
    metadata: {
      channel: call.channel,
      label: call.label,
      audioUrl: call.audioUrl,
      durationSeconds: call.durationSeconds,
      transcript: transcriptText,
      transcriptionProvider,
      geocoded: false,
      sourceMetadata: call.metadata,
    },
  });

  await advanceCursorForCall(deps, call);

  console.log(
    JSON.stringify({
      source: call.source,
      sourceEventId: call.sourceEventId,
      occurredAtMs: call.occurredAtMs,
      provider: transcriptionProvider,
      severity: incident.severity,
      category: incident.category,
      incidentId: savedIncident.id,
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
