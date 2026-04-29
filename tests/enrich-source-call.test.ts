import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldPublishIncident,
  SourceCallEnrichmentService,
} from "../lib/services/enrich-source-call";
import { DeterministicIncidentAuditService } from "../lib/services/audit-incident";
import { resetEnvCache } from "../lib/config/env";
import type {
  EnrichmentRun,
  Incident,
  IncidentUpsert,
  StoredSourceCall,
} from "../lib/types/domain";

test("publishes when an incident type is present", () => {
  assert.equal(
    shouldPublishIncident({
      incidentType: "Domestic Disturbance",
      matchedCodes: [],
    }),
    true,
  );
});

test("publishes when a matched radio code is explicitly incident-scoped", () => {
  assert.equal(
    shouldPublishIncident({
      incidentType: null,
      matchedCodes: [{ role: "incident" }],
    }),
    true,
  );
});

test("does not publish low-signal conversational transcripts", () => {
  assert.equal(
    shouldPublishIncident({
      incidentType: null,
      matchedCodes: [{ role: "status" }, { role: "unit" }],
    }),
    false,
  );
});

test("auditor suppression records a skipped enrichment run without upserting an incident", async () => {
  process.env.AUDIT_SEVERITY_THRESHOLD = "5";
  process.env.AUDIT_LOW_CONFIDENCE_THRESHOLD = "0.65";
  process.env.AUDIT_SUPPRESS_CONFIDENCE_THRESHOLD = "0.45";
  process.env.AUDIT_MIN_GEOCODE_CONFIDENCE = "0.7";
  resetEnvCache();

  const sourceCall: StoredSourceCall = {
    id: "11111111-1111-4111-8111-111111111111",
    source: "openmhz",
    cursorKey: "frkoh",
    sourceEventId: "call-1",
    occurredAt: "2026-04-29T12:00:00.000Z",
    occurredAtMs: 1,
    audioUrl: null,
    fileName: null,
    transcriptText: "Possible suspicious activity, unknown location.",
    channel: "dispatch",
    label: null,
    durationSeconds: 12,
    metadata: {},
    rawPayload: {},
    createdAt: "2026-04-29T12:00:00.000Z",
  };
  const runs: Array<{
    extraction?: Record<string, unknown>;
    outcome: string;
  }> = [];
  let incidentUpsertCount = 0;

  const service = new SourceCallEnrichmentService({
    sourceCallRepository: {
      put: async () => sourceCall,
      getById: async () => sourceCall,
      getBySourceEvent: async () => sourceCall,
      setTranscript: async () => sourceCall,
    },
    enrichmentRunRepository: {
      create: async (input) => {
        runs.push({
          extraction: input.extraction,
          outcome: input.outcome,
        });

        return {
          id: "22222222-2222-4222-8222-222222222222",
          sourceCallId: sourceCall.id,
          enrichmentJobId: input.enrichmentJobId ?? null,
          transcriptText: input.transcriptText ?? null,
          transcriptionProvider: input.transcriptionProvider ?? null,
          extraction: input.extraction ?? {},
          geocoding: input.geocoding,
          outcome: input.outcome,
          createdAt: "2026-04-29T12:00:00.000Z",
        } satisfies EnrichmentRun;
      },
    },
    incidentRepository: {
      listActive: async () => [],
      upsert: async (_incident: IncidentUpsert): Promise<Incident> => {
        incidentUpsertCount += 1;
        throw new Error("incident upsert should not be called");
      },
    },
    geocodingService: {
      geocode: async () => ({
        provider: "county_bias",
        resolved: false,
        confidence: 0.15,
        query: null,
        reason: "missing_location_text",
        point: null,
      }),
    },
    transcriptionService: {
      transcribe: async () => {
        throw new Error("transcription should not be called");
      },
    },
    extractionService: {
      extractFromTranscript: async () => ({
        incident: {
          incidentType: "Suspicious Activity",
          category: "Suspicious Activity",
          locationText: null,
          address: null,
          summary: "Possible suspicious activity, unknown location.",
          severity: 2,
          statusHint: "new",
          confidence: 0.38,
          needsReview: true,
          matchedCodes: [],
        },
        metadata: {
          provider: "heuristic",
          model: null,
          promptVersion: null,
          fallbackUsed: false,
          fallbackReason: null,
          rawPayload: null,
          validated: true,
        },
      }),
    },
    auditService: new DeterministicIncidentAuditService(),
  });

  const result = await service.enrich({
    sourceCallId: sourceCall.id,
    enrichmentJobId: "33333333-3333-4333-8333-333333333333",
  });

  assert.equal(result.outcome, "suppressed");
  assert.equal(result.publishDecision.route, "suppressed");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].outcome, "skipped");
  assert.equal(runs[0].extraction?.skippedReason, "auditor_suppressed");
  assert.equal(incidentUpsertCount, 0);
});
