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
  talkgroup: z.string().nullable(),
  talkgroupLabel: z.string().nullable(),
  audioUrl: z.string().url(),
});

export type OpenMhzCall = z.infer<typeof openMhzCallSchema>;

export const transcriptionSchema = z.object({
  provider: z.enum(["xai", "openai"]),
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});

export type Transcription = z.infer<typeof transcriptionSchema>;

export const extractedIncidentSchema = z.object({
  category: z.string().nullable(),
  address: z.string().nullable(),
  summary: z.string(),
  severity: z.number().int().min(1).max(5),
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
