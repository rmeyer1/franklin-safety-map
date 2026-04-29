import assert from "node:assert/strict";
import test from "node:test";

import { resetEnvCache } from "../lib/config/env";
import { DeterministicIncidentAuditService } from "../lib/services/audit-incident";
import type {
  ExtractedIncident,
  ExtractionMetadata,
  GeocodingResult,
} from "../lib/types/domain";

function configureAuditEnv() {
  process.env.AUDIT_SEVERITY_THRESHOLD = "5";
  process.env.AUDIT_LOW_CONFIDENCE_THRESHOLD = "0.65";
  process.env.AUDIT_SUPPRESS_CONFIDENCE_THRESHOLD = "0.45";
  process.env.AUDIT_MIN_GEOCODE_CONFIDENCE = "0.7";
  resetEnvCache();
}

function baseIncident(overrides: Partial<ExtractedIncident> = {}): ExtractedIncident {
  return {
    incidentType: "Theft",
    category: "Theft",
    locationText: "8101 Waynesboro",
    address: "8101 Waynesboro",
    summary: "Theft report at 8101 Waynesboro",
    severity: 2,
    statusHint: "new",
    confidence: 0.88,
    needsReview: false,
    matchedCodes: [],
    ...overrides,
  };
}

function baseGeocoding(overrides: Partial<GeocodingResult> = {}): GeocodingResult {
  return {
    provider: "mapbox",
    resolved: true,
    confidence: 0.95,
    query: "8101 Waynesboro, Warren County, Ohio",
    reason: null,
    point: {
      lat: 39.43,
      lng: -84.21,
    },
    ...overrides,
  };
}

function baseMetadata(overrides: Partial<ExtractionMetadata> = {}): ExtractionMetadata {
  return {
    provider: "ollama",
    model: "llama-test",
    promptVersion: "v-test",
    fallbackUsed: false,
    fallbackReason: null,
    rawPayload: null,
    validated: true,
    ...overrides,
  };
}

test("allows direct publish when no audit triggers fire", () => {
  configureAuditEnv();
  const service = new DeterministicIncidentAuditService();

  const decision = service.review({
    incident: baseIncident(),
    geocoding: baseGeocoding(),
    extractionMetadata: baseMetadata(),
  });

  assert.equal(decision.route, "direct_publish");
  assert.equal(decision.publishable, true);
  assert.equal(decision.audited, false);
  assert.deepEqual(decision.reasons, []);
  assert.equal(decision.finalConfidence, 0.88);
  assert.equal(decision.needsReview, false);
});

test("audits and confirms high-risk publish decisions", () => {
  configureAuditEnv();
  const service = new DeterministicIncidentAuditService();

  const decision = service.review({
    incident: baseIncident({
      incidentType: "Shots Fired",
      category: "Shots Fired",
      severity: 5,
      confidence: 0.91,
      summary: "Shots fired reported near the caller location",
    }),
    geocoding: baseGeocoding(),
    extractionMetadata: baseMetadata(),
  });

  assert.equal(decision.route, "audited_publish");
  assert.equal(decision.publishable, true);
  assert.equal(decision.audited, true);
  assert.deepEqual(decision.reasons, ["high_severity", "high_risk_category"]);
  assert.deepEqual(decision.actions, ["confirm_publish"]);
  assert.equal(decision.needsReview, false);
});

test("suppresses weak low-confidence incidents instead of publishing them", () => {
  configureAuditEnv();
  const service = new DeterministicIncidentAuditService();

  const decision = service.review({
    incident: baseIncident({
      incidentType: "Unclassified Call",
      category: "Unclassified Call",
      locationText: null,
      address: null,
      confidence: 0.38,
      severity: 2,
      needsReview: true,
    }),
    geocoding: baseGeocoding({
      provider: "county_bias",
      resolved: false,
      confidence: 0.15,
      query: null,
      reason: "missing_location_text",
      point: null,
    }),
    extractionMetadata: baseMetadata({ provider: "heuristic", model: null }),
  });

  assert.equal(decision.route, "suppressed");
  assert.equal(decision.publishable, false);
  assert.deepEqual(decision.actions, ["suppress_publish"]);
  assert.deepEqual(decision.reasons, [
    "low_extraction_confidence",
    "weak_location",
    "extractor_requested_review",
  ]);
});

test("downgrades confidence and marks review on extraction signal conflicts", () => {
  configureAuditEnv();
  const service = new DeterministicIncidentAuditService();

  const decision = service.review({
    incident: baseIncident({
      category: "Alarm",
      incidentType: "Alarm",
      severity: 1,
      confidence: 0.82,
      matchedCodes: [
        {
          code: "10-65",
          meaning: "Domestic Disturbance",
          role: "incident",
          category: "Domestic Disturbance",
          severity: 4,
          statusHint: null,
          source: "test",
          notes: null,
        },
      ],
    }),
    geocoding: baseGeocoding(),
    extractionMetadata: baseMetadata(),
  });

  assert.equal(decision.route, "audited_publish");
  assert.equal(decision.publishable, true);
  assert.deepEqual(decision.reasons, ["extraction_signal_conflict"]);
  assert.deepEqual(decision.actions, [
    "confirm_publish",
    "downgrade_confidence",
    "mark_needs_review",
  ]);
  assert.equal(decision.finalConfidence, 0.67);
  assert.equal(decision.needsReview, true);
});
