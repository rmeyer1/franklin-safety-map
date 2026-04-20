import { createOpenMhzClient } from "@/lib/openmhz/client";
import { createIncidentRepository } from "@/lib/repositories/incidents";
import { createIncidentExtractionService } from "@/lib/services/extract-incident";
import { createTranscriptionService } from "@/lib/services/transcribe-audio";

async function downloadAudio(url: string): Promise<Buffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Audio download failed with status ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function runOnce() {
  const openMhz = createOpenMhzClient();
  const incidentRepository = createIncidentRepository();
  const transcriptionService = createTranscriptionService();
  const extractionService = createIncidentExtractionService();

  const calls = await openMhz.listRecentCalls();

  for (const call of calls) {
    const audio = await downloadAudio(call.audioUrl);
    const transcription = await transcriptionService.transcribe({
      audio,
      fileName: `${call.id}.audio`,
      mimeType: "audio/mpeg",
    });

    const incident = await extractionService.extractFromTranscript(
      transcription.text,
    );

    const savedIncident = await incidentRepository.upsert({
      source: "openmhz",
      sourceEventId: call.id,
      layer: "police",
      category: incident.category ?? "Radio Dispatch",
      address: incident.address ?? call.talkgroupLabel ?? "Unknown location",
      description: incident.summary,
      severity: incident.severity,
      status: "Active",
      occurredAt: call.occurredAt,
      point: {
        lat: 39.9612,
        lng: -82.9988,
      },
      metadata: {
        talkgroup: call.talkgroup,
        talkgroupLabel: call.talkgroupLabel,
        transcriptionProvider: transcription.provider,
      },
    });

    console.log(
      JSON.stringify({
        callId: call.id,
        provider: transcription.provider,
        severity: incident.severity,
        category: incident.category,
        incidentId: savedIncident.id,
      }),
    );
  }
}

runOnce().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
