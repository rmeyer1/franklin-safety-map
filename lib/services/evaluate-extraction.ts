import { z } from "zod";

import type { IncidentAuditService } from "@/lib/services/audit-incident";
import { shouldPublishIncident } from "@/lib/services/enrich-source-call";
import type { IncidentExtractionService } from "@/lib/services/extract-incident";
import type { GeocodingService } from "@/lib/services/geocode";
import type {
  AuditRoute,
  ExtractedIncident,
  ExtractionMetadata,
  GeocodingResult,
  PublishDecision,
} from "@/lib/types/domain";

export const evaluationExpectedSchema = z.object({
  publish: z.boolean(),
  category: z.string().nullable().optional(),
  incidentType: z.string().nullable().optional(),
  severity: z.number().int().min(1).max(5).nullable().optional(),
  locationText: z.string().nullable().optional(),
  needsReview: z.boolean().nullable().optional(),
});

export const evaluationItemSchema = z.object({
  id: z.string(),
  source: z.string().default("openmhz"),
  sourceCallId: z.string().nullable().optional(),
  sourceEventId: z.string().nullable().optional(),
  occurredAt: z.string().nullable().optional(),
  transcript: z.string().min(1),
  channel: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  expected: evaluationExpectedSchema,
});

export const evaluationDatasetSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  items: z.array(evaluationItemSchema).min(1),
});

export type EvaluationExpected = z.infer<typeof evaluationExpectedSchema>;
export type EvaluationItem = z.infer<typeof evaluationItemSchema>;
export type EvaluationDataset = z.infer<typeof evaluationDatasetSchema>;

export type EvaluationItemResult = {
  id: string;
  source: string;
  sourceCallId: string | null;
  sourceEventId: string | null;
  expectedPublish: boolean;
  predictedPublish: boolean;
  outcome: "published" | "skipped" | "suppressed";
  route: AuditRoute | "skipped_no_incident_signal";
  correctPublishDecision: boolean;
  categoryMatch: boolean | null;
  severityMatch: boolean | null;
  locationMatch: boolean | null;
  reviewMatch: boolean | null;
  predicted: {
    category: string | null;
    incidentType: string | null;
    severity: number;
    confidence: number;
    needsReview: boolean;
    locationText: string | null;
    address: string | null;
    geocoding: GeocodingResult | null;
    publishDecision: PublishDecision | null;
    extractionMetadata: ExtractionMetadata;
  };
};

export type EvaluationMetrics = {
  total: number;
  expectedPublishCount: number;
  expectedSkipCount: number;
  predictedPublishCount: number;
  predictedSkipCount: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  publishPrecision: number | null;
  falsePositiveRate: number | null;
  skipRate: number;
  locationExtractionAccuracy: number | null;
  categoryAccuracy: number | null;
  severityAccuracy: number | null;
  reviewRate: number;
  reviewAccuracy: number | null;
  escalationRate: number;
  suppressedRate: number;
};

export type EvaluationRunInfo = {
  datasetName: string;
  generatedAt: string;
  source: string | null;
  since: string | null;
  until: string | null;
  promptVersion: string | null;
  model: string | null;
};

export type EvaluationReport = {
  run: EvaluationRunInfo;
  metrics: EvaluationMetrics;
  results: EvaluationItemResult[];
};

export type EvaluateExtractionDeps = {
  extractionService: IncidentExtractionService;
  geocodingService: GeocodingService;
  auditService: IncidentAuditService;
};

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized && normalized.length > 0 ? normalized : null;
}

function nullableRate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

function requiredRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function textMatches(
  actual: string | null | undefined,
  expected: string | null | undefined,
): boolean | null {
  const normalizedActual = normalizeText(actual);
  const normalizedExpected = normalizeText(expected);

  if (!normalizedExpected) {
    return null;
  }

  if (!normalizedActual) {
    return false;
  }

  return (
    normalizedActual.includes(normalizedExpected) ||
    normalizedExpected.includes(normalizedActual)
  );
}

function categoryMatches(
  actualCategory: string | null,
  actualIncidentType: string | null,
  expected: EvaluationExpected,
): boolean | null {
  const expectedCategory = normalizeText(expected.category ?? expected.incidentType);
  if (!expectedCategory) {
    return null;
  }

  return (
    normalizeText(actualCategory) === expectedCategory ||
    normalizeText(actualIncidentType) === expectedCategory
  );
}

function routeToOutcome(input: {
  hasIncidentSignal: boolean;
  publishDecision: PublishDecision | null;
}): EvaluationItemResult["outcome"] {
  if (!input.hasIncidentSignal) {
    return "skipped";
  }

  if (input.publishDecision?.publishable) {
    return "published";
  }

  return "suppressed";
}

function buildSkippedDecision(input: {
  item: EvaluationItem;
  incident: ExtractedIncident;
  metadata: ExtractionMetadata;
}): EvaluationItemResult {
  const categoryMatch = categoryMatches(
    input.incident.category,
    input.incident.incidentType,
    input.item.expected,
  );
  const severityMatch =
    input.item.expected.severity == null
      ? null
      : input.incident.severity === input.item.expected.severity;
  const locationMatch = textMatches(
    input.incident.locationText ?? input.incident.address,
    input.item.expected.locationText,
  );
  const predictedPublish = false;

  return {
    id: input.item.id,
    source: input.item.source,
    sourceCallId: input.item.sourceCallId ?? null,
    sourceEventId: input.item.sourceEventId ?? null,
    expectedPublish: input.item.expected.publish,
    predictedPublish,
    outcome: "skipped",
    route: "skipped_no_incident_signal",
    correctPublishDecision: predictedPublish === input.item.expected.publish,
    categoryMatch,
    severityMatch,
    locationMatch,
    reviewMatch:
      input.item.expected.needsReview == null
        ? null
        : input.incident.needsReview === input.item.expected.needsReview,
    predicted: {
      category: input.incident.category,
      incidentType: input.incident.incidentType,
      severity: input.incident.severity,
      confidence: input.incident.confidence,
      needsReview: input.incident.needsReview,
      locationText: input.incident.locationText,
      address: input.incident.address,
      geocoding: null,
      publishDecision: null,
      extractionMetadata: input.metadata,
    },
  };
}

function buildAuditedResult(input: {
  item: EvaluationItem;
  incident: ExtractedIncident;
  metadata: ExtractionMetadata;
  geocoding: GeocodingResult;
  publishDecision: PublishDecision;
}): EvaluationItemResult {
  const finalIncident = {
    ...input.incident,
    confidence: input.publishDecision.finalConfidence,
    needsReview: input.publishDecision.needsReview,
  };
  const predictedPublish = input.publishDecision.publishable;
  const predictedNeedsReview =
    input.publishDecision.needsReview ||
    input.publishDecision.route === "audited_publish";

  return {
    id: input.item.id,
    source: input.item.source,
    sourceCallId: input.item.sourceCallId ?? null,
    sourceEventId: input.item.sourceEventId ?? null,
    expectedPublish: input.item.expected.publish,
    predictedPublish,
    outcome: routeToOutcome({
      hasIncidentSignal: true,
      publishDecision: input.publishDecision,
    }),
    route: input.publishDecision.route,
    correctPublishDecision: predictedPublish === input.item.expected.publish,
    categoryMatch: categoryMatches(
      finalIncident.category,
      finalIncident.incidentType,
      input.item.expected,
    ),
    severityMatch:
      input.item.expected.severity == null
        ? null
        : finalIncident.severity === input.item.expected.severity,
    locationMatch: textMatches(
      finalIncident.locationText ?? finalIncident.address,
      input.item.expected.locationText,
    ),
    reviewMatch:
      input.item.expected.needsReview == null
        ? null
        : predictedNeedsReview === input.item.expected.needsReview,
    predicted: {
      category: finalIncident.category,
      incidentType: finalIncident.incidentType,
      severity: finalIncident.severity,
      confidence: finalIncident.confidence,
      needsReview: finalIncident.needsReview,
      locationText: finalIncident.locationText,
      address: finalIncident.address,
      geocoding: input.geocoding,
      publishDecision: input.publishDecision,
      extractionMetadata: input.metadata,
    },
  };
}

function countMatches(
  results: EvaluationItemResult[],
  key: "categoryMatch" | "severityMatch" | "locationMatch" | "reviewMatch",
): { matches: number; total: number } {
  const scoped = results
    .map((result) => result[key])
    .filter((value): value is boolean => value !== null);

  return {
    matches: scoped.filter(Boolean).length,
    total: scoped.length,
  };
}

export function computeEvaluationMetrics(
  results: EvaluationItemResult[],
): EvaluationMetrics {
  const total = results.length;
  const expectedPublishCount = results.filter((result) => result.expectedPublish).length;
  const expectedSkipCount = total - expectedPublishCount;
  const predictedPublishCount = results.filter((result) => result.predictedPublish).length;
  const predictedSkipCount = total - predictedPublishCount;
  const truePositive = results.filter(
    (result) => result.expectedPublish && result.predictedPublish,
  ).length;
  const falsePositive = results.filter(
    (result) => !result.expectedPublish && result.predictedPublish,
  ).length;
  const trueNegative = results.filter(
    (result) => !result.expectedPublish && !result.predictedPublish,
  ).length;
  const falseNegative = results.filter(
    (result) => result.expectedPublish && !result.predictedPublish,
  ).length;
  const category = countMatches(results, "categoryMatch");
  const severity = countMatches(results, "severityMatch");
  const location = countMatches(results, "locationMatch");
  const review = countMatches(results, "reviewMatch");

  return {
    total,
    expectedPublishCount,
    expectedSkipCount,
    predictedPublishCount,
    predictedSkipCount,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    publishPrecision: nullableRate(truePositive, truePositive + falsePositive),
    falsePositiveRate: nullableRate(falsePositive, falsePositive + trueNegative),
    skipRate: requiredRate(predictedSkipCount, total),
    locationExtractionAccuracy: nullableRate(location.matches, location.total),
    categoryAccuracy: nullableRate(category.matches, category.total),
    severityAccuracy: nullableRate(severity.matches, severity.total),
    reviewRate: requiredRate(
      results.filter((result) => result.predicted.needsReview).length,
      total,
    ),
    reviewAccuracy: nullableRate(review.matches, review.total),
    escalationRate: requiredRate(
      results.filter(
        (result) =>
          result.route === "audited_publish" || result.route === "suppressed",
      ).length,
      total,
    ),
    suppressedRate: requiredRate(
      results.filter((result) => result.route === "suppressed").length,
      total,
    ),
  };
}

export async function evaluateExtractionDataset(input: {
  dataset: EvaluationDataset;
  deps: EvaluateExtractionDeps;
  run: Omit<EvaluationRunInfo, "datasetName" | "generatedAt"> & {
    generatedAt?: string;
  };
}): Promise<EvaluationReport> {
  const dataset = evaluationDatasetSchema.parse(input.dataset);
  const results: EvaluationItemResult[] = [];

  for (const item of dataset.items) {
    const extraction = await input.deps.extractionService.extractFromTranscript({
      transcript: item.transcript,
      channel: item.channel ?? null,
      label: item.label ?? null,
    });
    const incident = extraction.incident;
    const hasIncidentSignal = shouldPublishIncident({
      incidentType: incident.incidentType,
      matchedCodes: incident.matchedCodes,
    });

    if (!hasIncidentSignal) {
      results.push(
        buildSkippedDecision({
          item,
          incident,
          metadata: extraction.metadata,
        }),
      );
      continue;
    }

    const geocoding = await input.deps.geocodingService.geocode({
      address: incident.address,
      locationText: incident.locationText,
      label: item.label ?? null,
    });
    const publishDecision = input.deps.auditService.review({
      incident,
      geocoding,
      extractionMetadata: extraction.metadata,
    });

    results.push(
      buildAuditedResult({
        item,
        incident,
        metadata: extraction.metadata,
        geocoding,
        publishDecision,
      }),
    );
  }

  return {
    run: {
      datasetName: dataset.name,
      generatedAt: input.run.generatedAt ?? new Date().toISOString(),
      source: input.run.source,
      since: input.run.since,
      until: input.run.until,
      promptVersion: input.run.promptVersion,
      model: input.run.model,
    },
    metrics: computeEvaluationMetrics(results),
    results,
  };
}
