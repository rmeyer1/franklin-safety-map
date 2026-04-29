/**
 * scripts/evaluate-extraction.ts
 *
 * Runs extraction, geocoding, and audit decisions against a labeled evaluation
 * set or historical source_calls rows. The script is read-only: it does not
 * enqueue jobs, write enrichment_runs, or upsert incidents.
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { getEnv, resetEnvCache } from "../lib/config/env";
import { closeDbPool, getDbPool } from "../lib/server/db";
import { createIncidentAuditService } from "../lib/services/audit-incident";
import { createIncidentExtractionService } from "../lib/services/extract-incident";
import {
  evaluateExtractionDataset,
  evaluationDatasetSchema,
  type EvaluationDataset,
  type EvaluationExpected,
  type EvaluationItem,
} from "../lib/services/evaluate-extraction";
import { createGeocodingService } from "../lib/services/geocode";

const DEFAULT_LABELS_PATH = "data/evaluation/warren-county-extraction.sample.json";

type CliOptions = {
  labels?: string;
  source?: string;
  since?: string;
  until?: string;
  limit?: string;
  output?: string;
  provider?: string;
  "prompt-version"?: string;
  model?: string;
  pretty: boolean;
  help: boolean;
};

type SourceCallEvalRow = {
  id: string;
  source: string;
  source_event_id: string;
  occurred_at: string | Date;
  transcript_text: string;
  channel: string | null;
  label: string | null;
};

function usage(): string {
  return [
    "Usage:",
    "  npm run eval:extraction -- [options]",
    "",
    "Modes:",
    "  Fixture mode (default): read labeled transcripts from --labels",
    "  DB mode: add --source, --since, or --until to read historical source_calls",
    "",
    "Options:",
    `  --labels <path>           Labeled dataset JSON (${DEFAULT_LABELS_PATH})`,
    "  --source <source>         Filter source_calls by source, e.g. openmhz",
    "  --since <ISO>             Include calls at or after this timestamp",
    "  --until <ISO>             Include calls before this timestamp",
    "  --limit <N>               Maximum DB calls to evaluate",
    "  --provider <value>        Override extraction provider: auto, heuristic, or ollama",
    "  --prompt-version <value>  Override EXTRACTION_PROMPT_VERSION for this run",
    "  --model <value>           Override OLLAMA_MODEL for this run",
    "  --output <path>           Write report JSON to a file instead of stdout",
    "  --pretty                  Pretty-print JSON output",
    "  --help                    Show this help",
  ].join("\n");
}

function parseCliOptions(): CliOptions {
  const { values } = parseArgs({
    options: {
      labels: { type: "string", default: DEFAULT_LABELS_PATH },
      source: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
      limit: { type: "string" },
      output: { type: "string" },
      provider: { type: "string" },
      "prompt-version": { type: "string" },
      model: { type: "string" },
      pretty: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  return values as CliOptions;
}

function parseLimit(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--limit must be a positive integer");
  }

  return parsed;
}

function isDbMode(opts: CliOptions): boolean {
  return Boolean(opts.source || opts.since || opts.until);
}

function applyProviderOverride(provider: string | undefined): void {
  if (!provider) {
    return;
  }

  if (!["auto", "heuristic", "ollama"].includes(provider)) {
    throw new Error("--provider must be one of: auto, heuristic, ollama");
  }

  process.env.INCIDENT_EXTRACTION_PROVIDER = provider;
}

async function readEvaluationDataset(path: string): Promise<EvaluationDataset> {
  const raw = await readFile(path, "utf8");
  return evaluationDatasetSchema.parse(JSON.parse(raw));
}

function labelKey(item: EvaluationItem): string[] {
  return [
    item.sourceCallId ? `id:${item.sourceCallId}` : "",
    item.sourceEventId ? `event:${item.sourceEventId}` : "",
  ].filter(Boolean);
}

function buildExpectedIndex(
  dataset: EvaluationDataset,
): Map<string, EvaluationExpected> {
  const index = new Map<string, EvaluationExpected>();
  for (const item of dataset.items) {
    for (const key of labelKey(item)) {
      index.set(key, item.expected);
    }
  }

  return index;
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

async function loadDbDataset(input: {
  labelDataset: EvaluationDataset;
  source?: string;
  since?: string;
  until?: string;
  limit: number | null;
}): Promise<EvaluationDataset> {
  const pool = getDbPool();
  const conditions = ["transcript_text is not null", "btrim(transcript_text) <> ''"];
  const params: unknown[] = [];

  if (input.source) {
    params.push(input.source);
    conditions.push(`source = $${params.length}`);
  }

  if (input.since) {
    params.push(input.since);
    conditions.push(`occurred_at >= $${params.length}::timestamptz`);
  }

  if (input.until) {
    params.push(input.until);
    conditions.push(`occurred_at < $${params.length}::timestamptz`);
  }

  params.push(input.limit);
  const limitParam = params.length;
  const query = `
    select
      id,
      source,
      source_event_id,
      occurred_at,
      transcript_text,
      channel,
      label
    from source_calls
    where ${conditions.join(" and ")}
    order by occurred_at asc, id asc
    limit coalesce($${limitParam}::integer, 2147483647)
  `;
  const result = await pool.query<SourceCallEvalRow>(query, params);
  const expectedByKey = buildExpectedIndex(input.labelDataset);

  return evaluationDatasetSchema.parse({
    name: `${input.labelDataset.name}:source_calls`,
    description: "Historical source_calls evaluation slice",
    items: result.rows.map((row) => {
      const expected =
        expectedByKey.get(`id:${row.id}`) ??
        expectedByKey.get(`event:${row.source_event_id}`) ??
        { publish: true };

      return {
        id: row.id,
        source: row.source,
        sourceCallId: row.id,
        sourceEventId: row.source_event_id,
        occurredAt: toIsoString(row.occurred_at),
        transcript: row.transcript_text,
        channel: row.channel,
        label: row.label,
        expected,
      };
    }),
  });
}

async function main() {
  const opts = parseCliOptions();

  if (opts.help) {
    console.log(usage());
    return;
  }

  applyProviderOverride(opts.provider);

  if (opts["prompt-version"]) {
    process.env.EXTRACTION_PROMPT_VERSION = opts["prompt-version"];
  }

  if (opts.model) {
    process.env.OLLAMA_MODEL = opts.model;
  }

  resetEnvCache();
  const env = getEnv();

  const labelDataset = await readEvaluationDataset(opts.labels ?? DEFAULT_LABELS_PATH);
  const limit = parseLimit(opts.limit);
  const dataset = isDbMode(opts)
    ? await loadDbDataset({
        labelDataset,
        source: opts.source,
        since: opts.since,
        until: opts.until,
        limit,
      })
    : labelDataset;

  const report = await evaluateExtractionDataset({
    dataset,
    deps: {
      extractionService: createIncidentExtractionService(),
      geocodingService: createGeocodingService(),
      auditService: createIncidentAuditService(),
    },
    run: {
      source: opts.source ?? null,
      since: opts.since ?? null,
      until: opts.until ?? null,
      promptVersion: env.EXTRACTION_PROMPT_VERSION,
      model: env.OLLAMA_MODEL,
    },
  });
  const json = JSON.stringify(report, null, opts.pretty ? 2 : 0);

  if (opts.output) {
    await writeFile(opts.output, `${json}\n`, "utf8");
  } else {
    console.log(json);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
