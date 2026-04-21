import { z } from "zod";

import { getEnv } from "@/lib/config/env";
import {
  type ExtractedIncident,
  extractedIncidentSchema,
} from "@/lib/types/domain";
import {
  loadRadioCodebook,
  type MatchedRadioCode,
  type RadioCodebook,
} from "@/lib/services/radio-codebook";

type IncidentExtractionInput = {
  transcript: string;
  channel?: string | null;
  label?: string | null;
};

export interface IncidentExtractionService {
  extractFromTranscript(
    input: string | IncidentExtractionInput,
  ): Promise<ExtractedIncident>;
}

const ollamaExtractionSchema = z.object({
  incidentType: z.string().nullable(),
  category: z.string().nullable(),
  locationText: z.string().nullable(),
  address: z.string().nullable(),
  summary: z.string(),
  severity: z.number().int().min(1).max(5),
  statusHint: z.enum(["new", "update", "clear", "unknown"]),
  confidence: z.number().min(0).max(1),
});

type NormalizedInput = {
  transcript: string;
  channel: string | null;
  label: string | null;
};

function normalizeInput(
  input: string | IncidentExtractionInput,
): NormalizedInput {
  if (typeof input === "string") {
    return {
      transcript: input.trim(),
      channel: null,
      label: null,
    };
  }

  return {
    transcript: input.transcript.trim(),
    channel: input.channel ?? null,
    label: input.label ?? null,
  };
}

function inferSeverityFromKeywords(text: string): number {
  const lower = text.toLowerCase();

  if (
    lower.includes("shots fired") ||
    lower.includes("gun") ||
    lower.includes("officer down")
  ) {
    return 5;
  }
  if (
    lower.includes("robbery") ||
    lower.includes("assault") ||
    lower.includes("stabbing") ||
    lower.includes("crash")
  ) {
    return 4;
  }
  if (
    lower.includes("fire") ||
    lower.includes("medical") ||
    lower.includes("unconscious")
  ) {
    return 3;
  }
  if (lower.includes("suspicious") || lower.includes("disturbance")) {
    return 2;
  }

  return 1;
}

function inferStatusHint(text: string): ExtractedIncident["statusHint"] {
  const lower = text.toLowerCase();
  if (
    lower.includes("clear") ||
    lower.includes("available") ||
    lower.includes("return")
  ) {
    return "clear";
  }

  if (
    lower.includes("en route") ||
    lower.includes("out with") ||
    lower.includes("on scene") ||
    lower.includes("arrived")
  ) {
    return "update";
  }

  return "new";
}

function getIncidentMatches(matchedCodes: MatchedRadioCode[]): MatchedRadioCode[] {
  return matchedCodes.filter((code) => code.role === "incident");
}

function getStatusMatches(matchedCodes: MatchedRadioCode[]): MatchedRadioCode[] {
  return matchedCodes.filter(
    (code) => code.role === "status" && code.statusHint !== null,
  );
}

function inferLocationText(input: NormalizedInput): string | null {
  const fromLabel = input.label?.trim();
  if (fromLabel && fromLabel.length > 0) {
    return fromLabel;
  }

  const addressPattern =
    /\b\d{1,5}\s+[a-z0-9.'\- ]{2,40}\b(?:road|rd|street|st|avenue|ave|drive|dr|pike|boulevard|blvd|lane|ln|way|court|ct|circle|cir|highway|hwy)\b/i;
  const match = input.transcript.match(addressPattern);
  return match?.[0] ?? null;
}

function inferIncidentType(
  transcript: string,
  matchedCodes: MatchedRadioCode[],
): string | null {
  const incidentMatches = getIncidentMatches(matchedCodes);
  if (incidentMatches.length > 0 && incidentMatches[0].category) {
    return incidentMatches[0].category;
  }

  const lower = transcript.toLowerCase();
  if (lower.includes("shots fired")) return "Shots Fired";
  if (lower.includes("robbery")) return "Robbery";
  if (lower.includes("domestic")) return "Domestic Disturbance";
  if (lower.includes("crash")) return "Crash";
  if (lower.includes("medical")) return "Medical Emergency";
  if (lower.includes("fire")) return "Fire";
  return null;
}

function inferCategory(
  transcript: string,
  matchedCodes: MatchedRadioCode[],
): string | null {
  const incidentMatches = getIncidentMatches(matchedCodes);
  if (incidentMatches.length > 0) {
    return incidentMatches[0].category ?? incidentMatches[0].meaning;
  }

  const incidentType = inferIncidentType(transcript, matchedCodes);
  if (incidentType) {
    return incidentType;
  }

  const fallback = transcript.split(" ").slice(0, 4).join(" ").trim();
  return fallback.length > 0 ? fallback : "Unclassified Call";
}

function inferConfidence(input: NormalizedInput, matchedCodes: MatchedRadioCode[]): number {
  let score = 0.25;

  if (getIncidentMatches(matchedCodes).length > 0) {
    score += 0.35;
  }
  if (inferLocationText(input)) {
    score += 0.15;
  }
  if (input.transcript.split(" ").length >= 6) {
    score += 0.15;
  }
  if (inferStatusHint(input.transcript) !== "unknown") {
    score += 0.1;
  }

  return Math.min(0.95, Number(score.toFixed(2)));
}

function buildPrompt(
  input: NormalizedInput,
  matchedCodes: MatchedRadioCode[],
  promptVersion: string,
): string {
  return [
    "You are an emergency dispatch extraction model.",
    "Return only compact JSON. Do not include markdown.",
    `Prompt version: ${promptVersion}`,
    "Schema:",
    '{"incidentType":string|null,"category":string|null,"locationText":string|null,"address":string|null,"summary":string,"severity":1|2|3|4|5,"statusHint":"new"|"update"|"clear"|"unknown","confidence":number}',
    "",
    "Rules:",
    "- Use provided code mappings as authoritative when relevant.",
    "- If transcript indicates incident closure/availability, use statusHint=clear.",
    "- Keep summary factual and concise.",
    "- If location is uncertain, set locationText/address to null.",
    "- Confidence should be between 0 and 1.",
    "",
    `Channel: ${input.channel ?? "unknown"}`,
    `Label: ${input.label ?? "unknown"}`,
    `Matched Codes: ${JSON.stringify(matchedCodes)}`,
    `Transcript: ${JSON.stringify(input.transcript)}`,
  ].join("\n");
}

function normalizeExtractedIncident(
  result: z.infer<typeof ollamaExtractionSchema>,
  matchedCodes: MatchedRadioCode[],
): ExtractedIncident {
  return extractedIncidentSchema.parse({
    incidentType: result.incidentType,
    category: result.category,
    locationText: result.locationText,
    address: result.address,
    summary: result.summary.trim(),
    severity: result.severity,
    statusHint: result.statusHint,
    confidence: result.confidence,
    matchedCodes,
  });
}

class HeuristicIncidentExtractionService implements IncidentExtractionService {
  constructor(private readonly codebook: RadioCodebook | null) {}

  async extractFromTranscript(
    input: string | IncidentExtractionInput,
  ): Promise<ExtractedIncident> {
    const normalized = normalizeInput(input);
    const matchedCodes = this.codebook?.matchTranscript(normalized.transcript) ?? [];
    const fallbackSeverity = inferSeverityFromKeywords(normalized.transcript);
    const incidentMatches = getIncidentMatches(matchedCodes);
    const statusMatches = getStatusMatches(matchedCodes);

    const severityFromCode = incidentMatches.find(
      (code) => code.severity !== null,
    )?.severity;
    const severity = severityFromCode ?? fallbackSeverity;
    const statusHint =
      statusMatches[0]?.statusHint ?? inferStatusHint(normalized.transcript);

    return extractedIncidentSchema.parse({
      incidentType: inferIncidentType(normalized.transcript, matchedCodes),
      category: inferCategory(normalized.transcript, matchedCodes),
      locationText: inferLocationText(normalized),
      address: inferLocationText(normalized),
      summary: normalized.transcript,
      severity,
      statusHint,
      confidence: inferConfidence(normalized, matchedCodes),
      matchedCodes,
    });
  }
}

class OllamaIncidentExtractionService implements IncidentExtractionService {
  constructor(private readonly codebook: RadioCodebook | null) {}

  async extractFromTranscript(
    input: string | IncidentExtractionInput,
  ): Promise<ExtractedIncident> {
    const env = getEnv();
    if (!env.OLLAMA_API_URL) {
      throw new Error("OLLAMA_API_URL is not configured");
    }

    const normalized = normalizeInput(input);
    const matchedCodes = this.codebook?.matchTranscript(normalized.transcript) ?? [];

    const response = await fetch(
      `${env.OLLAMA_API_URL.replace(/\/$/, "")}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env.OLLAMA_MODEL,
          prompt: buildPrompt(normalized, matchedCodes, env.EXTRACTION_PROMPT_VERSION),
          format: "json",
          stream: false,
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Ollama extraction request failed with status ${response.status}: ${body.slice(0, 240)}`,
      );
    }

    const payload = (await response.json()) as { response?: unknown };
    const modelResponseRaw = typeof payload.response === "string"
      ? payload.response
      : "";
    const parsedJson = JSON.parse(modelResponseRaw);
    const parsed = ollamaExtractionSchema.parse(parsedJson);
    return normalizeExtractedIncident(parsed, matchedCodes);
  }
}

class FallbackIncidentExtractionService implements IncidentExtractionService {
  constructor(private readonly chain: IncidentExtractionService[]) {}

  async extractFromTranscript(
    input: string | IncidentExtractionInput,
  ): Promise<ExtractedIncident> {
    const errors: string[] = [];
    for (const service of this.chain) {
      try {
        return await service.extractFromTranscript(input);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "unknown error");
      }
    }

    throw new Error(`All extraction providers failed: ${errors.join("; ")}`);
  }
}

export function createIncidentExtractionService(): IncidentExtractionService {
  const env = getEnv();
  const codebook = loadRadioCodebook(env.RADIO_CODEBOOK_PATH);
  const heuristic = new HeuristicIncidentExtractionService(codebook);
  const ollama = new OllamaIncidentExtractionService(codebook);

  if (env.INCIDENT_EXTRACTION_PROVIDER === "heuristic") {
    return heuristic;
  }

  if (env.INCIDENT_EXTRACTION_PROVIDER === "ollama") {
    return new FallbackIncidentExtractionService([ollama, heuristic]);
  }

  return new FallbackIncidentExtractionService([ollama, heuristic]);
}
