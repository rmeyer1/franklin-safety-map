import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateExtractionDataset,
  evaluationDatasetSchema,
} from "../lib/services/evaluate-extraction";
import type { PublishDecision } from "../lib/types/domain";

function publishDecision(): PublishDecision {
  return {
    route: "direct_publish",
    publishable: true,
    audited: false,
    actions: [],
    reasons: [],
    initialConfidence: 0.9,
    finalConfidence: 0.9,
    needsReview: false,
    provider: "test",
    metadata: {},
  };
}

test("computes publish, skip, location, and escalation metrics", async () => {
  const dataset = evaluationDatasetSchema.parse({
    name: "test-eval",
    items: [
      {
        id: "publish-theft",
        transcript: "Theft at 8101 Waynesboro.",
        label: "8101 Waynesboro",
        expected: {
          publish: true,
          category: "Theft",
          severity: 2,
          locationText: "8101 Waynesboro",
          needsReview: false,
        },
      },
      {
        id: "skip-clear",
        transcript: "13 York Clear 22 54.",
        expected: {
          publish: false,
          needsReview: false,
        },
      },
      {
        id: "false-positive-alarm",
        transcript: "Alarm at 200 Main Street.",
        label: "200 Main Street",
        expected: {
          publish: false,
        },
      },
    ],
  });

  const report = await evaluateExtractionDataset({
    dataset,
    deps: {
      extractionService: {
        extractFromTranscript: async (input) => {
          const transcript = typeof input === "string" ? input : input.transcript;
          if (transcript.includes("Clear")) {
            return {
              incident: {
                incidentType: null,
                category: "13 York Clear 22",
                locationText: null,
                address: null,
                summary: transcript,
                severity: 1,
                statusHint: "clear",
                confidence: 0.5,
                needsReview: false,
                matchedCodes: [
                  {
                    code: "clear",
                    meaning: "Clear",
                    role: "status",
                    category: null,
                    severity: null,
                    statusHint: "clear",
                    source: "test",
                    notes: null,
                  },
                ],
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
            };
          }

          const isTheft = transcript.includes("Theft");
          return {
            incident: {
              incidentType: isTheft ? "Theft" : "Alarm",
              category: isTheft ? "Theft" : "Alarm",
              locationText: isTheft ? "8101 Waynesboro" : "200 Main Street",
              address: isTheft ? "8101 Waynesboro" : "200 Main Street",
              summary: transcript,
              severity: isTheft ? 2 : 1,
              statusHint: "new",
              confidence: 0.9,
              needsReview: false,
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
          };
        },
      },
      geocodingService: {
        geocode: async () => ({
          provider: "test",
          resolved: true,
          confidence: 0.95,
          query: "test",
          reason: null,
          point: { lat: 39.43, lng: -84.21 },
        }),
      },
      auditService: {
        review: () => publishDecision(),
      },
    },
    run: {
      source: "openmhz",
      since: null,
      until: null,
      promptVersion: "v-test",
      model: "model-test",
      generatedAt: "2026-04-29T00:00:00.000Z",
    },
  });

  assert.equal(report.run.datasetName, "test-eval");
  assert.equal(report.metrics.total, 3);
  assert.equal(report.metrics.truePositive, 1);
  assert.equal(report.metrics.falsePositive, 1);
  assert.equal(report.metrics.trueNegative, 1);
  assert.equal(report.metrics.falseNegative, 0);
  assert.equal(report.metrics.publishPrecision, 0.5);
  assert.equal(report.metrics.falsePositiveRate, 0.5);
  assert.equal(report.metrics.skipRate, 0.3333);
  assert.equal(report.metrics.categoryAccuracy, 1);
  assert.equal(report.metrics.severityAccuracy, 1);
  assert.equal(report.metrics.locationExtractionAccuracy, 1);
  assert.equal(report.results[1].route, "skipped_no_incident_signal");
});
