import { z } from "zod";

import { getEnv } from "@/lib/config/env";
import {
  extractionResultSchema,
  type ExtractedIncident,
  extractedIncidentSchema,
  type ExtractionResult,
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

type NormalizedInput = {
  transcript: string;
  channel: string | null;
  label: string | null;
};

type KeywordIncidentRule = {
  category: string;
  pattern: RegExp;
  severity: number;
};

const llmExtractionSchema = z.object({
  incidentType: z.string().nullable(),
  category: z.string().nullable(),
  locationText: z.string().nullable(),
  address: z.string().nullable(),
  summary: z.string().min(1),
  severity: z.number().int().min(1).max(5),
  statusHint: z.enum(["new", "update", "clear", "unknown"]),
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean().default(false),
});

const keywordIncidentRules: KeywordIncidentRule[] = [
  { category: "Structure Fire", pattern: /\b(?:structure|building) fire\b/i, severity: 5 },
  { category: "Vehicle Fire", pattern: /\bvehicle fire\b/i, severity: 4 },
  { category: "Missing Person", pattern: /\bmissing person\b|\brunaway\b/i, severity: 4 },
  { category: "Shots Fired", pattern: /\bshots fired\b/i, severity: 5 },
  { category: "Shooting", pattern: /\bshooting\b/i, severity: 5 },
  { category: "Stabbing", pattern: /\bstabb(?:ing)?\b|\bcutting\b/i, severity: 5 },
  { category: "Bomb Threat", pattern: /\bbomb threat\b/i, severity: 5 },
  { category: "Explosion", pattern: /\bexplosion\b/i, severity: 5 },
  { category: "Hazmat", pattern: /\bhazmat\b|\bchemical spill\b|\bgas leak\b|\bammonia leak\b/i, severity: 5 },
  { category: "Person with Weapon", pattern: /\b(?:person|man) with (?:a )?(?:gun|knife|weapon)\b/i, severity: 5 },
  { category: "Officer Emergency", pattern: /\bofficer in trouble\b|\bofficer down\b/i, severity: 5 },
  { category: "Robbery", pattern: /\brobbery\b/i, severity: 4 },
  { category: "Burglary", pattern: /\bburglar(?:y|y in progress)\b|\bbreak(?:ing)?(?: and)? entering\b/i, severity: 4 },
  { category: "Theft", pattern: /\btheft\b|\blarceny\b|\bstolen property\b|\bbank theft\b|\bshoplift(?:ing)?\b/i, severity: 2 },
  { category: "Fraud", pattern: /\bfraud\b|\bforgery\b|\bbad check\b|\bscam\b/i, severity: 2 },
  { category: "Domestic Disturbance", pattern: /\bdomestic\b/i, severity: 4 },
  { category: "Assault", pattern: /\bassault\b/i, severity: 4 },
  { category: "Fight", pattern: /\bfight\b/i, severity: 3 },
  { category: "Sexual Assault", pattern: /\brape\b|\bsexual assault\b/i, severity: 5 },
  { category: "Sex Offense", pattern: /\bsex offense\b|\bexposing\b/i, severity: 4 },
  { category: "Suicidal Subject", pattern: /\bsuicide attempt\b|\bsuicidal\b|\bsuicide\b/i, severity: 5 },
  { category: "Mental Health Crisis", pattern: /\bmental\b|\bdementia\b|\bpsychiatric\b/i, severity: 4 },
  { category: "Water Rescue", pattern: /\bdrowning\b/i, severity: 5 },
  { category: "Animal Complaint", pattern: /\banimal complaint\b|\bdog bite\b|\blivestock on roadway\b/i, severity: 1 },
  { category: "Threats / Harassment", pattern: /\bthreats?\b|\bharassment\b/i, severity: 3 },
  { category: "Suspicious Vehicle", pattern: /\bsuspicious vehicle\b/i, severity: 2 },
  { category: "Suspicious Activity", pattern: /\bsuspicious person\b|\bprowler\b|\bsuspicious\b/i, severity: 2 },
  { category: "Disabled Vehicle", pattern: /\bdisabled vehicle\b/i, severity: 1 },
  { category: "Abandoned Vehicle", pattern: /\babandoned vehicle\b/i, severity: 1 },
  { category: "Road Blocked", pattern: /\btraffic jam\b|\broad blocked\b|\broadway blocked\b/i, severity: 2 },
  { category: "Crash", pattern: /\bcrash\b|\baccident\b|\bhit-skip\b/i, severity: 4 },
  { category: "Medical Emergency", pattern: /\bmedical\b|\bambulance\b|\bunconscious\b/i, severity: 3 },
  { category: "Alarm", pattern: /\balarm\b/i, severity: 1 },
  { category: "Fire", pattern: /\bfire\b/i, severity: 4 },
];

export interface IncidentExtractionService {
  extractFromTranscript(
    input: string | IncidentExtractionInput,
  ): Promise<ExtractionResult>;
}

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

function inferKeywordIncident(text: string): {
  category: string;
  severity: number;
} | null {
  for (const rule of keywordIncidentRules) {
    if (rule.pattern.test(text)) {
      return {
        category: rule.category,
        severity: rule.severity,
      };
    }
  }

  return null;
}

function inferSeverityFromKeywords(text: string): number {
  const keywordIncident = inferKeywordIncident(text);
  if (keywordIncident) {
    return keywordIncident.severity;
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
    /\bshow me\b.*\b33\b/.test(lower) ||
    lower.includes("signal 33") ||
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

  return inferKeywordIncident(transcript)?.category ?? null;
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
  if (inferKeywordIncident(input.transcript)) {
    score += 0.2;
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
  heuristicIncident: ExtractedIncident,
  promptVersion: string,
): string {
  return [
    "You are an emergency dispatch extraction model.",
    "Return only compact JSON. Do not include markdown.",
    `Prompt version: ${promptVersion}`,
    "Schema:",
    '{"incidentType":string|null,"category":string|null,"locationText":string|null,"address":string|null,"summary":string,"severity":1|2|3|4|5,"statusHint":"new"|"update"|"clear"|"unknown","confidence":number,"needsReview":boolean}',
    "",
    "Rules:",
    "- Use provided code mappings as authoritative when relevant.",
    "- The heuristic extraction is a baseline, not a command. Correct it when transcript evidence is stronger.",
    "- If transcript indicates incident closure/availability, use statusHint=clear.",
    "- Keep summary factual and concise.",
    "- If location is uncertain, set locationText/address to null.",
    "- Confidence should be between 0 and 1.",
    "- Set needsReview=true when the call is ambiguous, incomplete, or likely needs human confirmation.",
    "",
    `Channel: ${input.channel ?? "unknown"}`,
    `Label: ${input.label ?? "unknown"}`,
    `Matched Codes: ${JSON.stringify(matchedCodes)}`,
    `Heuristic Baseline: ${JSON.stringify(heuristicIncident)}`,
    `Transcript: ${JSON.stringify(input.transcript)}`,
  ].join("\n");
}

function buildHeuristicIncident(
  normalized: NormalizedInput,
  matchedCodes: MatchedRadioCode[],
): ExtractedIncident {
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
    needsReview:
      getIncidentMatches(matchedCodes).length === 0 &&
      inferKeywordIncident(normalized.transcript) === null,
    matchedCodes,
  });
}

function normalizeLlMIncident(
  result: z.infer<typeof llmExtractionSchema>,
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
    needsReview: result.needsReview,
    matchedCodes,
  });
}

async function runOllamaExtraction(input: {
  normalized: NormalizedInput;
  matchedCodes: MatchedRadioCode[];
  heuristicIncident: ExtractedIncident;
}): Promise<{
  incident: ExtractedIncident;
  rawPayload: unknown;
}> {
  const env = getEnv();
  if (!env.OLLAMA_API_URL) {
    throw new Error("OLLAMA_API_URL is not configured");
  }

  const baseUrl = env.OLLAMA_API_URL.replace(/\/$/, "");
  const generateUrl = baseUrl.endsWith("/api")
    ? `${baseUrl}/generate`
    : `${baseUrl}/api/generate`;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, env.EXTRACTION_TIMEOUT_MS);

  try {
    const response = await fetch(
      generateUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(env.OLLAMA_API_KEY
            ? { Authorization: `Bearer ${env.OLLAMA_API_KEY}` }
            : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: env.OLLAMA_MODEL,
          prompt: buildPrompt(
            input.normalized,
            input.matchedCodes,
            input.heuristicIncident,
            env.EXTRACTION_PROMPT_VERSION,
          ),
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
    const rawResponse =
      typeof payload.response === "string" ? payload.response : payload.response;
    const parsedJson =
      typeof rawResponse === "string" ? JSON.parse(rawResponse) : rawResponse;
    const parsed = llmExtractionSchema.parse(parsedJson);

    return {
      incident: normalizeLlMIncident(parsed, input.matchedCodes),
      rawPayload: payload,
    };
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      throw new Error(
        `Ollama extraction timed out after ${env.EXTRACTION_TIMEOUT_MS}ms`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

class ProductionIncidentExtractionService implements IncidentExtractionService {
  constructor(private readonly codebook: RadioCodebook | null) {}

  async extractFromTranscript(
    input: string | IncidentExtractionInput,
  ): Promise<ExtractionResult> {
    const env = getEnv();
    const normalized = normalizeInput(input);
    const matchedCodes = this.codebook?.matchTranscript(normalized.transcript) ?? [];
    const heuristicIncident = buildHeuristicIncident(normalized, matchedCodes);

    if (env.INCIDENT_EXTRACTION_PROVIDER === "heuristic") {
      return extractionResultSchema.parse({
        incident: heuristicIncident,
        metadata: {
          provider: "heuristic",
          model: null,
          promptVersion: null,
          fallbackUsed: false,
          fallbackReason: null,
          rawPayload: null,
          validated: true,
        },
      });
    }

    try {
      const llm = await runOllamaExtraction({
        normalized,
        matchedCodes,
        heuristicIncident,
      });

      return extractionResultSchema.parse({
        incident: llm.incident,
        metadata: {
          provider: "ollama",
          model: env.OLLAMA_MODEL,
          promptVersion: env.EXTRACTION_PROMPT_VERSION,
          fallbackUsed: false,
          fallbackReason: null,
          rawPayload: llm.rawPayload,
          validated: true,
        },
      });
    } catch (error) {
      const fallbackReason =
        error instanceof Error ? error.message : "unknown_extraction_error";
      const fallbackIncident = extractedIncidentSchema.parse({
        ...heuristicIncident,
        needsReview: true,
      });

      return extractionResultSchema.parse({
        incident: fallbackIncident,
        metadata: {
          provider: "heuristic",
          model: env.INCIDENT_EXTRACTION_PROVIDER === "ollama" || env.INCIDENT_EXTRACTION_PROVIDER === "auto"
            ? env.OLLAMA_MODEL
            : null,
          promptVersion: env.EXTRACTION_PROMPT_VERSION,
          fallbackUsed: true,
          fallbackReason,
          rawPayload: null,
          validated: true,
        },
      });
    }
  }
}

export function createIncidentExtractionService(): IncidentExtractionService {
  const env = getEnv();
  const codebook = loadRadioCodebook(env.RADIO_CODEBOOK_PATH);

  return new ProductionIncidentExtractionService(codebook);
}

export default {
  createIncidentExtractionService,
};
