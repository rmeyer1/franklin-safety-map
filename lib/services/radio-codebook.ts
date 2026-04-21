import { readFileSync } from "node:fs";

import { z } from "zod";

const radioCodebookEntrySchema = z.object({
  code: z.string(),
  meaning: z.string(),
  role: z
    .enum(["incident", "status", "resource", "unit", "reference"])
    .default("reference"),
  category: z.string().nullable().default(null),
  severity: z.number().int().min(1).max(5).nullable().default(null),
  statusHint: z.enum(["new", "update", "clear", "unknown"]).nullable().default(null),
  aliases: z.array(z.string()).default([]),
  source: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});

const radioCodebookSchema = z.object({
  system: z.string(),
  version: z.string().optional(),
  entries: z.array(radioCodebookEntrySchema),
});

const escapedPatternCache = new Map<string, string>();
const incidentCueStopwords = new Set([
  "and",
  "bad",
  "check",
  "code",
  "complaint",
  "in",
  "incident",
  "of",
  "or",
  "other",
  "person",
  "progress",
  "signal",
  "the",
  "unit",
  "vehicle",
]);
const unitContextTokens = new Set([
  "car",
  "engine",
  "ladder",
  "medic",
  "station",
  "tower",
  "truck",
  "unit",
]);
const statusContextTokens = new Set([
  "arrived",
  "available",
  "clear",
  "enroute",
  "onscene",
  "out",
  "responding",
  "return",
  "same",
  "scene",
]);

function escapeRegex(value: string): string {
  const cached = escapedPatternCache.get(value);
  if (cached) {
    return cached;
  }

  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  escapedPatternCache.set(value, escaped);
  return escaped;
}

function normalizeToken(value: string): string {
  return value.replace(/^[^a-z0-9-]+|[^a-z0-9-]+$/gi, "").toLowerCase();
}

function tokenHasLetters(value: string): boolean {
  return /[a-z]/i.test(value);
}

function isShortNumericLikeCode(value: string): boolean {
  return /^[0-9]{1,2}[a-z]?$/i.test(value);
}

function isNumericLikeToken(value: string): boolean {
  return /^[0-9]{1,5}[a-z]?$/i.test(value);
}

function buildIncidentCueWords(entry: RadioCodebookEntry): string[] {
  const cueWords = [entry.meaning, entry.category, ...entry.aliases]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/))
    .map(normalizeToken)
    .filter(Boolean)
    .filter((token) => !isShortNumericLikeCode(token))
    .filter((token) => !incidentCueStopwords.has(token))
    .filter((token) => token.length >= 4 || ["doa", "dui", "ovi"].includes(token));

  return [...new Set(cueWords)];
}

function hasExplicitCodePrefix(transcript: string, token: string): boolean {
  const match = token.toLowerCase().match(/^(\d+)([a-z]?)$/);
  if (!match) {
    return false;
  }

  const [, digits, suffix] = match;
  if (suffix) {
    return new RegExp(
      `\\b(?:code|signal)\\s+${escapeRegex(digits)}\\s*${escapeRegex(suffix)}\\b`,
      "i",
    ).test(transcript);
  }

  return new RegExp(`\\b(?:code|signal)\\s+${escapeRegex(digits)}\\b`, "i").test(
    transcript,
  );
}

function isLikelyUnitOrStatusContext(
  rawTokens: string[],
  index: number,
  unitTokens: Set<string>,
): boolean {
  const surroundingTokens = [
    rawTokens[index - 2] ?? "",
    rawTokens[index - 1] ?? "",
    rawTokens[index + 1] ?? "",
    rawTokens[index + 2] ?? "",
  ];

  if (surroundingTokens.some((token) => unitTokens.has(token))) {
    return true;
  }

  if (surroundingTokens.some((token) => unitContextTokens.has(token))) {
    return true;
  }

  if (
    [rawTokens[index - 1] ?? "", rawTokens[index + 1] ?? ""].some((token) =>
      isNumericLikeToken(token),
    )
  ) {
    return true;
  }

  const trailingContext = rawTokens.slice(index + 1, index + 4);
  return trailingContext.some((token) => statusContextTokens.has(token));
}

function hasIncidentCueNearby(
  rawTokens: string[],
  index: number,
  cueWords: string[],
): boolean {
  if (cueWords.length === 0) {
    return false;
  }

  const contextWindow = rawTokens.slice(Math.max(0, index - 2), index + 5);
  return cueWords.some((cueWord) => contextWindow.includes(cueWord));
}

export type RadioCodebookEntry = z.infer<typeof radioCodebookEntrySchema>;
export type MatchedRadioCode = {
  code: string;
  meaning: string;
  role: RadioCodebookEntry["role"];
  category: string | null;
  severity: number | null;
  statusHint: RadioCodebookEntry["statusHint"];
  source: string | null;
  notes: string | null;
};

export class RadioCodebook {
  private readonly unitTokens: Set<string>;

  constructor(private readonly entries: RadioCodebookEntry[]) {
    this.unitTokens = new Set(
      entries
        .filter((entry) => entry.role === "unit")
        .flatMap((entry) => [entry.code, ...entry.aliases])
        .map(normalizeToken)
        .filter(Boolean),
    );
  }

  matchTranscript(transcript: string): MatchedRadioCode[] {
    const matches: MatchedRadioCode[] = [];
    const lowerTranscript = transcript.toLowerCase();
    const rawTokens = transcript.split(/\s+/).map(normalizeToken).filter(Boolean);
    const seen = new Set<string>();

    for (const entry of this.entries) {
      const tokens = [entry.code, ...entry.aliases].map((token) =>
        token.toLowerCase(),
      );
      const didMatch = tokens.some((token) => {
        if (isShortNumericLikeCode(token)) {
          const cueWords = buildIncidentCueWords(entry);

          for (let index = 0; index < rawTokens.length; index += 1) {
            if (rawTokens[index] !== token) {
              continue;
            }

            if (hasExplicitCodePrefix(lowerTranscript, token)) {
              return true;
            }

            if (isLikelyUnitOrStatusContext(rawTokens, index, this.unitTokens)) {
              continue;
            }

            if (hasIncidentCueNearby(rawTokens, index, cueWords)) {
              return true;
            }
          }

          return false;
        }

        const pattern = new RegExp(`(^|\\b)${escapeRegex(token)}(\\b|$)`, "i");
        return pattern.test(lowerTranscript);
      });

      if (!didMatch || seen.has(entry.code)) {
        continue;
      }

      seen.add(entry.code);
      matches.push({
        code: entry.code,
        meaning: entry.meaning,
        role: entry.role,
        category: entry.category,
        severity: entry.severity,
        statusHint: entry.statusHint,
        source: entry.source,
        notes: entry.notes,
      });
    }

    return matches;
  }
}

export function loadRadioCodebook(path: string): RadioCodebook | null {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = radioCodebookSchema.parse(JSON.parse(raw));
    return new RadioCodebook(parsed.entries);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      const code = error.code;
      if (code === "ENOENT") {
        return null;
      }
    }

    throw error;
  }
}
