import { z } from "zod";

export const layerSchema = z.enum(["police", "fire", "ems", "traffic", "transit"]);
export type Layer = z.infer<typeof layerSchema>;

export const incidentStatusSchema = z.enum(["Active", "Resolved", "Archived"]);
export const severityLabelSchema = z.enum(["low", "medium", "high", "critical"]);

export const pointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

export const incidentSchema = z.object({
  id: z.string(),
  layer: layerSchema,
  category: z.string(),
  address: z.string(),
  description: z.string(),
  severity: z.number().int().min(1).max(5),
  severityLabel: severityLabelSchema,
  status: incidentStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  point: pointSchema,
});

export type Incident = z.infer<typeof incidentSchema>;

export const mapFeedResponseSchema = z.array(incidentSchema);
export type MapFeedResponse = z.infer<typeof mapFeedResponseSchema>;

export const openMhzCallSchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  occurredAtMs: z.number().int().nonnegative(),
  talkgroupNumber: z.number().int().nullable(),
  talkgroup: z.string().nullable(),
  talkgroupLabel: z.string().nullable(),
  audioUrl: z.string().url(),
  fileName: z.string().nullable(),
  durationSeconds: z.number().nullable(),
});

export type OpenMhzCall = z.infer<typeof openMhzCallSchema>;

export const sourceCallSchema = z.object({
  source: z.string(),
  cursorKey: z.string(),
  sourceEventId: z.string(),
  occurredAt: z.string(),
  occurredAtMs: z.number().int().nonnegative(),
  audioUrl: z.string().url().nullable(),
  fileName: z.string().nullable(),
  transcriptText: z.string().nullable(),
  channel: z.string().nullable(),
  label: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type SourceCall = z.infer<typeof sourceCallSchema>;

export const storedSourceCallSchema = sourceCallSchema.extend({
  id: z.string().uuid(),
  rawPayload: z.unknown().default({}),
  createdAt: z.string(),
});

export type StoredSourceCall = z.infer<typeof storedSourceCallSchema>;

export const openMhzAdapterResponseSchema = z.object({
  system: z.string(),
  mode: z.enum(["direct", "fixture"]),
  generatedAt: z.string(),
  calls: z.array(openMhzCallSchema),
});

export type OpenMhzAdapterResponse = z.infer<typeof openMhzAdapterResponseSchema>;

export const ingestCursorSchema = z.object({
  source: z.string(),
  cursorKey: z.string(),
  lastOccurredAtMs: z.number().int().nonnegative(),
  lastSourceEventId: z.string().nullable(),
  updatedAt: z.string(),
});

export type IngestCursor = z.infer<typeof ingestCursorSchema>;

export const enrichmentJobStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
  "dead_letter",
]);

export type EnrichmentJobStatus = z.infer<typeof enrichmentJobStatusSchema>;

export const enrichmentJobSchema = z.object({
  id: z.string().uuid(),
  sourceCallId: z.string().uuid(),
  jobType: z.string(),
  status: enrichmentJobStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  availableAt: z.string(),
  lockedAt: z.string().nullable(),
  lockedBy: z.string().nullable(),
  lastError: z.string().nullable(),
  priority: z.number().int(),
  payload: z.unknown().default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});

export type EnrichmentJob = z.infer<typeof enrichmentJobSchema>;

export const transcriptionSchema = z.object({
  provider: z.enum(["whisper_local", "xai", "openai"]),
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});

export type Transcription = z.infer<typeof transcriptionSchema>;

export const extractedIncidentSchema = z.object({
  incidentType: z.string().nullable(),
  category: z.string().nullable(),
  locationText: z.string().nullable(),
  address: z.string().nullable(),
  summary: z.string(),
  severity: z.number().int().min(1).max(5),
  statusHint: z.enum(["new", "update", "clear", "unknown"]),
  confidence: z.number().min(0).max(1),
  matchedCodes: z.array(
    z.object({
      code: z.string(),
      meaning: z.string(),
      role: z.enum(["incident", "status", "resource", "unit", "reference"]),
      category: z.string().nullable(),
      severity: z.number().int().min(1).max(5).nullable(),
      statusHint: z.enum(["new", "update", "clear", "unknown"]).nullable(),
      source: z.string().nullable(),
      notes: z.string().nullable(),
    }),
  ),
});

export type ExtractedIncident = z.infer<typeof extractedIncidentSchema>;

export const incidentUpsertSchema = z.object({
  source: z.string(),
  sourceEventId: z.string().nullable().optional(),
  layer: layerSchema,
  category: z.string(),
  address: z.string(),
  description: z.string(),
  severity: z.number().int().min(1).max(5),
  status: incidentStatusSchema.default("Active"),
  occurredAt: z.string(),
  point: pointSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type IncidentUpsert = z.infer<typeof incidentUpsertSchema>;
