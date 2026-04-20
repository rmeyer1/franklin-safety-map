import { createOpenMhzClient } from "@/lib/openmhz/client";
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

    console.log(
      JSON.stringify({
        callId: call.id,
        provider: transcription.provider,
        severity: incident.severity,
        category: incident.category,
      }),
    );
  }
}

runOnce().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
