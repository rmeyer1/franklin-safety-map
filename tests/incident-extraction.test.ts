import assert from "node:assert/strict";
import test from "node:test";

import { createIncidentExtractionService } from "../lib/services/extract-incident";
import { loadRadioCodebook } from "../lib/services/radio-codebook";

process.env.INCIDENT_EXTRACTION_PROVIDER = "heuristic";
process.env.RADIO_CODEBOOK_PATH = "data/radio-codes/frkoh.json";

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
  assert.equal(unitTraffic.incidentType, null);

  const clearTraffic = await service.extractFromTranscript("13 York Clear 22 54.");
  assert.equal(clearTraffic.incidentType, null);
  assert.equal(clearTraffic.statusHint, "clear");
});

test("classifies missing-person traffic from plain language instead of unit suffixes", async () => {
  const service = createIncidentExtractionService();
  const incident = await service.extractFromTranscript(
    "2 0 31, a missing person, West Laurel Spring Drive, Beckworth.",
  );

  assert.equal(incident.category, "Missing Person");
  assert.equal(incident.incidentType, "Missing Person");
  assert.deepEqual(
    incident.matchedCodes.filter((match) => match.role === "incident"),
    [],
  );
});

test("classifies structure-fire and theft traffic from transcript content", async () => {
  const service = createIncidentExtractionService();

  const structureFire = await service.extractFromTranscript(
    "Station 16, request mutual aid for a ladder at 10406 Brentwood Pike Apartment 216 for a structure fire.",
  );
  assert.equal(structureFire.category, "Structure Fire");
  assert.equal(structureFire.incidentType, "Structure Fire");

  const theft = await service.extractFromTranscript(
    "8101 Waynesboro needs to file a report reference bank theft.",
  );
  assert.equal(theft.category, "Theft");
  assert.equal(theft.incidentType, "Theft");
});
