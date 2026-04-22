import { createEnrichmentRunRepository } from "@/lib/repositories/enrichment-runs";
import { createIncidentRepository } from "@/lib/repositories/incidents";
import { createSourceCallRepository } from "@/lib/repositories/source-calls";
import { createIncidentExtractionService } from "@/lib/services/extract-incident";
import { createGeocodingService } from "@/lib/services/geocode";
import {
  createTranscriptionService,
  TranscriptionFailedError,
} from "@/lib/services/transcribe-audio";
import type { StoredSourceCall, Transcription } from "@/lib/types/domain";

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

export class SkippableEnrichmentError extends Error {
  constructor(
    readonly reason: "missing_audio_and_transcript" | "no_speech_detected" | "low_confidence_non_incident",
    message: string,
  ) {
    super(message);
    this.name = "SkippableEnrichmentError";
  }
}

type EnrichSourceCallDeps = {
  sourceCallRepository: ReturnType<typeof createSourceCallRepository>;
  enrichmentRunRepository: ReturnType<typeof createEnrichmentRunRepository>;
  incidentRepository: ReturnType<typeof createIncidentRepository>;
  geocodingService: ReturnType<typeof createGeocodingService>;
  transcriptionService: ReturnType<typeof createTranscriptionService>;
  extractionService: ReturnType<typeof createIncidentExtractionService>;
};

export type EnrichSourceCallResult = {
  outcome: "incident";
  sourceCall: StoredSourceCall;
  incidentId: string;
  transcriptionProvider: Transcription["provider"] | "source";
  category: string | null;
  incidentType: string | null;
  severity: number;
  statusHint: "new" | "update" | "clear" | "unknown";
  extractionConfidence: number;
};

export function shouldPublishIncident(input: {
  incidentType: string | null;
  matchedCodes: Array<{ role: string }>;
}): boolean {
  if (input.incidentType) {
    return true;
  }

  return input.matchedCodes.some((match) => match.role === "incident");
}

export class SourceCallEnrichmentService {
  constructor(private readonly deps: EnrichSourceCallDeps) {}

  async enrich(input: {
    sourceCallId: string;
    enrichmentJobId?: string | null;
  }): Promise<EnrichSourceCallResult> {
    const {
      sourceCallRepository,
      enrichmentRunRepository,
      incidentRepository,
      geocodingService,
      transcriptionService,
      extractionService,
    } = this.deps;

    let sourceCall = await sourceCallRepository.getById(input.sourceCallId);
    if (!sourceCall) {
      throw new Error(`Source call ${input.sourceCallId} was not found`);
    }

    let transcriptText = sourceCall.transcriptText;
    let transcriptionProvider: Transcription["provider"] | "source" = "source";

    if (!transcriptText) {
      if (!sourceCall.audioUrl) {
        throw new SkippableEnrichmentError(
          "missing_audio_and_transcript",
          `Source call ${input.sourceCallId} has neither transcript text nor audio URL`,
        );
      }

      const { audio, mimeType } = await downloadAudio(sourceCall.audioUrl);
      const fallbackFileName = `${sourceCall.sourceEventId}.${inferFileExtension(sourceCall.audioUrl, mimeType)}`;
      let transcription;

      try {
        transcription = await transcriptionService.transcribe({
          audio,
          fileName: sourceCall.fileName ?? fallbackFileName,
          mimeType,
        });
      } catch (error) {
        if (
          error instanceof TranscriptionFailedError &&
          error.kind === "no_speech"
        ) {
          throw new SkippableEnrichmentError(
            "no_speech_detected",
            error.message,
          );
        }

        throw error;
      }

      transcriptText = transcription.text;
      transcriptionProvider = transcription.provider;
      sourceCall = await sourceCallRepository.setTranscript({
        id: sourceCall.id,
        transcriptText,
      });
    }

    const incident = await extractionService.extractFromTranscript({
      transcript: transcriptText,
      channel: sourceCall.channel,
      label: sourceCall.label,
    });

    const hasIncidentSignal = shouldPublishIncident({
      incidentType: incident.incidentType,
      matchedCodes: incident.matchedCodes,
    });

    if (!hasIncidentSignal) {
      throw new SkippableEnrichmentError(
        "low_confidence_non_incident",
        `Source call ${input.sourceCallId} did not contain a strong incident signal`,
      );
    }

    const geocoding = await geocodingService.geocode({
      address: incident.address,
      locationText: incident.locationText,
      label: sourceCall.label,
    });

    const enrichmentRun = await enrichmentRunRepository.create({
      sourceCallId: sourceCall.id,
      enrichmentJobId: input.enrichmentJobId ?? null,
      transcriptText,
      transcriptionProvider,
      extraction: {
        incidentType: incident.incidentType,
        category: incident.category,
        locationText: incident.locationText,
        address: incident.address,
        summary: incident.summary,
        severity: incident.severity,
        statusHint: incident.statusHint,
        confidence: incident.confidence,
        matchedCodes: incident.matchedCodes,
      },
      geocoding,
      outcome: "published",
    });

    const savedIncident = await incidentRepository.upsert({
      source: sourceCall.source,
      sourceEventId: sourceCall.sourceEventId,
      sourceCallId: sourceCall.id,
      enrichmentRunId: enrichmentRun.id,
      layer: "police",
      category: incident.category ?? "Radio Dispatch",
      address: incident.address ?? sourceCall.label ?? "Unknown location",
      description: incident.summary,
      severity: incident.severity,
      status: "Active",
      occurredAt: sourceCall.occurredAt,
      point: geocoding.point ?? {
        // Unresolved geocodes still carry the county center for map display,
        // but the geocoding metadata (resolved=false, reason) makes this explicit.
        lat: 39.43,
        lng: -84.21,
      },
      metadata: {
        channel: sourceCall.channel,
        label: sourceCall.label,
        audioUrl: sourceCall.audioUrl,
        durationSeconds: sourceCall.durationSeconds,
        transcript: transcriptText,
        transcriptionProvider,
        extraction: {
          incidentType: incident.incidentType,
          statusHint: incident.statusHint,
          confidence: incident.confidence,
          matchedCodes: incident.matchedCodes,
        },
        geocoding,
        sourceMetadata: sourceCall.metadata,
      },
    });

    return {
      outcome: "incident",
      sourceCall,
      incidentId: savedIncident.id,
      transcriptionProvider,
      category: incident.category,
      incidentType: incident.incidentType,
      severity: incident.severity,
      statusHint: incident.statusHint,
      extractionConfidence: incident.confidence,
    };
  }
}

export function createSourceCallEnrichmentService(): SourceCallEnrichmentService {
  return new SourceCallEnrichmentService({
    sourceCallRepository: createSourceCallRepository(),
    enrichmentRunRepository: createEnrichmentRunRepository(),
    incidentRepository: createIncidentRepository(),
    geocodingService: createGeocodingService(),
    transcriptionService: createTranscriptionService(),
    extractionService: createIncidentExtractionService(),
  });
}
