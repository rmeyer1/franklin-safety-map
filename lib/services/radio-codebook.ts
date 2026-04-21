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
  constructor(private readonly entries: RadioCodebookEntry[]) {}

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
          for (let index = 0; index < rawTokens.length; index += 1) {
            if (rawTokens[index] !== token) {
              continue;
            }

            const previous = rawTokens[index - 1] ?? "";
            const next = rawTokens[index + 1] ?? "";
            if (tokenHasLetters(previous) || tokenHasLetters(next)) {
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
