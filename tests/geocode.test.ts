import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { ProviderFallbackGeocodingService } from "../lib/services/geocode";
import { geocodingResultSchema, incidentUpsertSchema } from "../lib/types/domain";

// These tests cover:
// - GeocodingService: unresolved when no location inputs (no env needed)
// - Schema: resolved/unresolved geocoding results, lineage fields

describe("ProviderFallbackGeocodingService", () => {
  test("returns unresolved when no location inputs are provided", async () => {
    const service = new ProviderFallbackGeocodingService();
    const result = await service.geocode({});

    assert.equal(result.resolved, false);
    assert.equal(result.provider, "county_bias");
    assert.equal(result.reason, "missing_location_text");
    assert.equal(result.confidence, 0.15);
    assert.ok(result.point, "unresolved result should still include fallback point");
    assert.deepEqual(result.point, { lat: 39.43, lng: -84.21 });
  });

  test("returns unresolved when all location fields are whitespace", async () => {
    const service = new ProviderFallbackGeocodingService();
    const result = await service.geocode({
      address: "   ",
      locationText: "",
      label: null,
    });

    assert.equal(result.resolved, false);
    assert.equal(result.reason, "missing_location_text");
  });

  test("returns county_bias fallback point in unresolved result", async () => {
    const service = new ProviderFallbackGeocodingService();
    const result = await service.geocode({});

    // Even when unresolved, a point is provided for map display.
    // The frontend distinguishes resolved vs unresolved via the 'resolved' flag.
    assert.deepEqual(result.point, { lat: 39.43, lng: -84.21 });
  });
});

describe("geocodingResultSchema", () => {
  test("validates a fully resolved mapbox result", () => {
    const result = geocodingResultSchema.parse({
      provider: "mapbox",
      resolved: true,
      confidence: 0.95,
      query: "400 E Main St, Warren County, Ohio",
      reason: null,
      point: { lat: 39.43, lng: -84.21 },
    });

    assert.equal(result.resolved, true);
    assert.equal(result.provider, "mapbox");
    assert.equal(result.confidence, 0.95);
    assert.deepEqual(result.point, { lat: 39.43, lng: -84.21 });
  });

  test("validates an unresolved county_bias result with reason", () => {
    const result = geocodingResultSchema.parse({
      provider: "county_bias",
      resolved: false,
      confidence: 0.15,
      query: "123 Main St",
      reason: "mapbox_no_result",
      point: { lat: 39.43, lng: -84.21 },
    });

    assert.equal(result.resolved, false);
    assert.equal(result.reason, "mapbox_no_result");
    assert.equal(result.provider, "county_bias");
  });

  test("accepts null point for truly unresolved locations", () => {
    const result = geocodingResultSchema.parse({
      provider: "county_bias",
      resolved: false,
      confidence: 0.15,
      query: null,
      reason: "missing_location_text",
      point: null,
    });

    assert.equal(result.point, null);
    assert.equal(result.resolved, false);
    assert.equal(result.reason, "missing_location_text");
  });

  test("rejects confidence outside [0, 1] range", () => {
    assert.throws(
      () =>
        geocodingResultSchema.parse({
          provider: "mapbox",
          resolved: true,
          confidence: 1.5,
          query: "test",
          reason: null,
          point: { lat: 39.43, lng: -84.21 },
        }),
      /.*/
    );
  });
});

describe("incidentUpsertSchema lineage fields", () => {
  test("accepts sourceCallId and enrichmentRunId UUIDs", () => {
    const parsed = incidentUpsertSchema.parse({
      source: "openmhz",
      sourceEventId: "evt-456",
      sourceCallId: "550e8400-e29b-41d4-a716-446655440000",
      enrichmentRunId: "660e8400-e29b-41d4-a716-446655440000",
      layer: "police",
      category: "Structure Fire",
      address: "10406 Brentwood Pike",
      description: "Structure fire reported",
      severity: 4,
      status: "Active",
      occurredAt: "2026-04-21T22:00:00Z",
      point: { lat: 39.43, lng: -84.21 },
      metadata: {
        geocoding: {
          provider: "mapbox",
          resolved: true,
          confidence: 0.95,
          query: "10406 Brentwood Pike",
          reason: null,
          point: { lat: 39.43, lng: -84.21 },
        },
      },
    });

    assert.equal(
      parsed.sourceCallId,
      "550e8400-e29b-41d4-a716-446655440000"
    );
    assert.equal(
      parsed.enrichmentRunId,
      "660e8400-e29b-41d4-a716-446655440000"
    );
  });

  test("allows null lineage fields", () => {
    const parsed = incidentUpsertSchema.parse({
      source: "openmhz",
      sourceEventId: null,
      sourceCallId: null,
      enrichmentRunId: null,
      layer: "fire",
      category: "Fire",
      address: "Unknown",
      description: "test",
      severity: 2,
      status: "Active",
      occurredAt: "2026-04-21T22:00:00Z",
      point: { lat: 39.43, lng: -84.21 },
      metadata: {},
    });

    assert.equal(parsed.sourceCallId, null);
    assert.equal(parsed.enrichmentRunId, null);
  });

  test("stores geocoding metadata in incident metadata", () => {
    const parsed = incidentUpsertSchema.parse({
      source: "openmhz",
      sourceEventId: "evt-789",
      sourceCallId: "550e8400-e29b-41d4-a716-446655440000",
      enrichmentRunId: "660e8400-e29b-41d4-a716-446655440000",
      layer: "police",
      category: "Theft",
      address: "8101 Waynesboro",
      description: "Bank theft report",
      severity: 3,
      status: "Active",
      occurredAt: "2026-04-21T22:00:00Z",
      point: { lat: 39.43, lng: -84.21 },
      metadata: {
        geocoding: {
          provider: "mapbox",
          resolved: false,
          confidence: 0.15,
          query: "8101 Waynesboro",
          reason: "mapbox_no_result",
          point: { lat: 39.43, lng: -84.21 },
        },
      },
    });

    const geocoding = parsed.metadata.geocoding as Record<string, unknown>;
    assert.equal(geocoding.resolved, false);
    assert.equal(geocoding.reason, "mapbox_no_result");
  });
});