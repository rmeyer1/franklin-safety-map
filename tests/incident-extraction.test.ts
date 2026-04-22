import assert from "node:assert/strict";
import test from "node:test";

import { resetEnvCache } from "../lib/config/env";
import { createIncidentExtractionService } from "../lib/services/extract-incident";
import { loadRadioCodebook } from "../lib/services/radio-codebook";

process.env.INCIDENT_EXTRACTION_PROVIDER = "heuristic";
process.env.RADIO_CODEBOOK_PATH = "data/radio-codes/frkoh.json";
delete process.env.OLLAMA_API_URL;
resetEnvCache();

test("suppresses numeric incident matches inside unit traffic", () => {
  const codebook = loadRadioCodebook("data/radio-codes/frkoh.json");
  assert.ok(codebook);

  const lincolnTraffic = codebook.matchTranscript(
    "2 Lincoln 32 SF non-active 81 41 Waynesboro.",
  );
  assert.deepEqual(
    lincolnTraffic.filter((match) => match.role === "incident"),
    [],
  );
  assert.ok(lincolnTraffic.some((match) => match.code === "LINCOLN"));

  const unitClearTraffic = codebook.matchTranscript("13 York Clear 22 54.");
  assert.deepEqual(
    unitClearTraffic.filter((match) => match.role === "incident"),
    [],
  );

  const fireDispatch = codebook.matchTranscript(
    "Station 16, request mutual aid for a ladder at 10406 Brentwood Pike Apartment 216 for a structure fire.",
  );
  assert.deepEqual(
    fireDispatch.filter((match) => match.role === "incident"),
    [],
  );
});

test("does not infer an incident type from unit-status chatter", async () => {
  const service = createIncidentExtractionService();

  const unitTraffic = await service.extractFromTranscript(
    "2 Lincoln 32 SF non-active 81 41 Waynesboro.",
  );
  assert.equal(unitTraffic.incident.incidentType, null);
  assert.equal(unitTraffic.metadata.provider, "heuristic");
  assert.equal(unitTraffic.metadata.fallbackUsed, false);

  const clearTraffic = await service.extractFromTranscript("13 York Clear 22 54.");
  assert.equal(clearTraffic.incident.incidentType, null);
  assert.equal(clearTraffic.incident.statusHint, "clear");
});

test("classifies missing-person traffic from plain language instead of unit suffixes", async () => {
  const service = createIncidentExtractionService();
  const incident = await service.extractFromTranscript(
    "2 0 31, a missing person, West Laurel Spring Drive, Beckworth.",
  );

  assert.equal(incident.incident.category, "Missing Person");
  assert.equal(incident.incident.incidentType, "Missing Person");
  assert.deepEqual(
    incident.incident.matchedCodes.filter((match) => match.role === "incident"),
    [],
  );
});

test("classifies structure-fire and theft traffic from transcript content", async () => {
  const service = createIncidentExtractionService();

  const structureFire = await service.extractFromTranscript(
    "Station 16, request mutual aid for a ladder at 10406 Brentwood Pike Apartment 216 for a structure fire.",
  );
  assert.equal(structureFire.incident.category, "Structure Fire");
  assert.equal(structureFire.incident.incidentType, "Structure Fire");

  const theft = await service.extractFromTranscript(
    "8101 Waynesboro needs to file a report reference bank theft.",
  );
  assert.equal(theft.incident.category, "Theft");
  assert.equal(theft.incident.incidentType, "Theft");
});

test("falls back to heuristic extraction with explicit metadata when ollama is unavailable", async () => {
  process.env.INCIDENT_EXTRACTION_PROVIDER = "auto";
  delete process.env.OLLAMA_API_URL;
  resetEnvCache();

  const service = createIncidentExtractionService();
  const result = await service.extractFromTranscript(
    "8101 Waynesboro needs to file a report reference bank theft.",
  );

  assert.equal(result.incident.category, "Theft");
  assert.equal(result.metadata.provider, "heuristic");
  assert.equal(result.metadata.fallbackUsed, true);
  assert.match(result.metadata.fallbackReason ?? "", /OLLAMA_API_URL is not configured/);
  assert.equal(result.metadata.promptVersion, "v1");

  process.env.INCIDENT_EXTRACTION_PROVIDER = "heuristic";
  resetEnvCache();
});

test("returns validated ollama extraction metadata when model output is well-formed", async () => {
  process.env.INCIDENT_EXTRACTION_PROVIDER = "ollama";
  process.env.OLLAMA_API_URL = "https://example.test";
  process.env.OLLAMA_API_KEY = "test-ollama-key";
  process.env.OLLAMA_MODEL = "llama-test";
  process.env.EXTRACTION_PROMPT_VERSION = "v-test";
  resetEnvCache();

  const originalFetch = globalThis.fetch;
  let capturedAuthorizationHeader: string | null = null;
  globalThis.fetch = async (_input, init) => {
    capturedAuthorizationHeader = new Headers(init?.headers).get("Authorization");

    return new Response(
      JSON.stringify({
        response: JSON.stringify({
          incidentType: "Theft",
          category: "Theft",
          locationText: "8101 Waynesboro",
          address: "8101 Waynesboro",
          summary: "Bank theft report",
          severity: 2,
          statusHint: "new",
          confidence: 0.92,
          needsReview: false,
        }),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    const service = createIncidentExtractionService();
    const result = await service.extractFromTranscript(
      "8101 Waynesboro needs to file a report reference bank theft.",
    );

    assert.equal(result.incident.category, "Theft");
    assert.equal(result.metadata.provider, "ollama");
    assert.equal(result.metadata.model, "llama-test");
    assert.equal(result.metadata.promptVersion, "v-test");
    assert.equal(result.metadata.fallbackUsed, false);
    assert.equal(result.metadata.validated, true);
    assert.ok(result.metadata.rawPayload);
    assert.equal(capturedAuthorizationHeader, "Bearer test-ollama-key");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.INCIDENT_EXTRACTION_PROVIDER = "heuristic";
    delete process.env.OLLAMA_API_URL;
    delete process.env.OLLAMA_API_KEY;
    resetEnvCache();
  }
});

test("falls back to heuristic extraction when ollama returns invalid JSON", async () => {
  process.env.INCIDENT_EXTRACTION_PROVIDER = "ollama";
  process.env.OLLAMA_API_URL = "https://example.test";
  resetEnvCache();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        response: "{not valid json",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

  try {
    const service = createIncidentExtractionService();
    const result = await service.extractFromTranscript(
      "8101 Waynesboro needs to file a report reference bank theft.",
    );

    assert.equal(result.incident.category, "Theft");
    assert.equal(result.metadata.provider, "heuristic");
    assert.equal(result.metadata.fallbackUsed, true);
    assert.match(result.metadata.fallbackReason ?? "", /Unexpected token|JSON/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.INCIDENT_EXTRACTION_PROVIDER = "heuristic";
    delete process.env.OLLAMA_API_URL;
    resetEnvCache();
  }
});

test("falls back to heuristic and marks needsReview when ollama times out", async () => {
  process.env.INCIDENT_EXTRACTION_PROVIDER = "ollama";
  process.env.OLLAMA_API_URL = "https://example.test";
  process.env.EXTRACTION_TIMEOUT_MS = "10";
  resetEnvCache();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) =>
    await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }
    });

  try {
    const service = createIncidentExtractionService();
    const result = await service.extractFromTranscript(
      "8101 Waynesboro needs to file a report reference bank theft.",
    );

    assert.equal(result.incident.category, "Theft");
    assert.equal(result.incident.needsReview, true);
    assert.equal(result.metadata.provider, "heuristic");
    assert.equal(result.metadata.fallbackUsed, true);
    assert.match(result.metadata.fallbackReason ?? "", /timed out after 10ms/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.INCIDENT_EXTRACTION_PROVIDER = "heuristic";
    delete process.env.OLLAMA_API_URL;
    delete process.env.EXTRACTION_TIMEOUT_MS;
    resetEnvCache();
  }
});
