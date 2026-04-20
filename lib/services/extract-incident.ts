import type { ExtractedIncident } from "@/lib/types/domain";

export interface IncidentExtractionService {
  extractFromTranscript(transcript: string): Promise<ExtractedIncident>;
}

function inferSeverity(text: string): number {
  const lower = text.toLowerCase();

  if (lower.includes("shots fired") || lower.includes("gun")) {
    return 5;
  }
  if (lower.includes("crash") || lower.includes("assault")) {
    return 4;
  }
  if (lower.includes("medical") || lower.includes("unconscious")) {
    return 3;
  }
  if (lower.includes("suspicious")) {
    return 2;
  }

  return 1;
}

export class HeuristicIncidentExtractionService
  implements IncidentExtractionService
{
  async extractFromTranscript(transcript: string): Promise<ExtractedIncident> {
    return {
      category: transcript.split(" ").slice(0, 3).join(" ") || "Unclassified Call",
      address: null,
      summary: transcript.trim(),
      severity: inferSeverity(transcript),
    };
  }
}

export function createIncidentExtractionService(): IncidentExtractionService {
  return new HeuristicIncidentExtractionService();
}

