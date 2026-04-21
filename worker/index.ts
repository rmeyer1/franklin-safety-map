import { createIngestCursorRepository } from "@/lib/repositories/ingest-cursors";
import { createIncidentRepository } from "@/lib/repositories/incidents";
import { closeDbPool } from "@/lib/server/db";
import { createIncidentExtractionService } from "@/lib/services/extract-incident";
import { createSourceAdapter } from "@/lib/sources";
import { createTranscriptionService } from "@/lib/services/transcribe-audio";

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

async function runOnce() {
  const sourceAdapter = createSourceAdapter();
  const cursorRepository = createIngestCursorRepository();
  const incidentRepository = createIncidentRepository();
  const transcriptionService = createTranscriptionService();
  const extractionService = createIncidentExtractionService();
  const cursor = await cursorRepository.get(
    sourceAdapter.source,
    sourceAdapter.cursorKey,
  );
  const calls = await sourceAdapter.poll(cursor);

  for (const call of calls) {
    let transcriptText = call.transcriptText;
    let transcriptionProvider: "xai" | "openai" | "source" = "source";

    if (!transcriptText) {
      if (!call.audioUrl) {
        console.log(
          JSON.stringify({
            source: call.source,
            sourceEventId: call.sourceEventId,
            skipped: true,
            reason: "missing_audio_and_transcript",
          }),
        );
        continue;
      }

      const { audio, mimeType } = await downloadAudio(call.audioUrl);
      const transcription = await transcriptionService.transcribe({
        audio,
        fileName: call.fileName ?? `${call.sourceEventId}.audio`,
        mimeType,
      });

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

    await cursorRepository.set({
      source: sourceAdapter.source,
      cursorKey: sourceAdapter.cursorKey,
      lastOccurredAtMs: call.occurredAtMs,
      lastSourceEventId: call.sourceEventId,
    });

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
}

runOnce()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
