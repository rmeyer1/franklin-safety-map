import { readFileSync } from "node:fs";

import { z } from "zod";

const radioCodebookEntrySchema = z.object({
  code: z.string(),
  meaning: z.string(),
  category: z.string().nullable().default(null),
  severity: z.number().int().min(1).max(5).nullable().default(null),
  aliases: z.array(z.string()).default([]),
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

export type RadioCodebookEntry = z.infer<typeof radioCodebookEntrySchema>;
export type MatchedRadioCode = {
  code: string;
  meaning: string;
  category: string | null;
  severity: number | null;
};

export class RadioCodebook {
  constructor(private readonly entries: RadioCodebookEntry[]) {}

  matchTranscript(transcript: string): MatchedRadioCode[] {
    const matches: MatchedRadioCode[] = [];
    const lowerTranscript = transcript.toLowerCase();
    const seen = new Set<string>();

    for (const entry of this.entries) {
      const tokens = [entry.code, ...entry.aliases].map((token) =>
        token.toLowerCase(),
      );
      const didMatch = tokens.some((token) => {
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
        category: entry.category,
        severity: entry.severity,
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
