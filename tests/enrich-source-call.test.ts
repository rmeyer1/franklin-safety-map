import assert from "node:assert/strict";
import test from "node:test";

import { shouldPublishIncident } from "../lib/services/enrich-source-call";

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
