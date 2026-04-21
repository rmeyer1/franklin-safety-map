import { OpenMhzHttpClient } from "@/lib/openmhz/client";
import { getEnv } from "@/lib/config/env";
import {
  getOpenMhzCapturePaths,
  getOpenMhzFixture,
  getOpenMhzFixtureSummary,
} from "@/lib/openmhz/fixture";

async function main() {
  const env = getEnv();
  const summary = getOpenMhzFixtureSummary(env.OPENMHZ_SYSTEM);

  console.log("OpenMHz capture validation");
  console.log(`system=${env.OPENMHZ_SYSTEM}`);
  console.log(`source=${summary.source}`);
  console.log(`callCount=${summary.callCount}`);
  console.log(`talkgroupCount=${summary.talkgroupCount}`);
  console.log(`firstCallAt=${summary.firstCallAt ?? "n/a"}`);
  console.log(`lastCallAt=${summary.lastCallAt ?? "n/a"}`);
  console.log("");

  console.log("capturePaths=");
  for (const filePath of getOpenMhzCapturePaths(env.OPENMHZ_SYSTEM)) {
    console.log(`- ${filePath}`);
  }
  console.log("");

  if (summary.files.length > 0) {
    console.log("resolvedFiles=");
    for (const filePath of summary.files) {
      console.log(`- ${filePath}`);
    }
    console.log("");
  }

  const fixture = getOpenMhzFixture(env.OPENMHZ_SYSTEM);
  const client = OpenMhzHttpClient.fromFixture(env.OPENMHZ_SYSTEM, fixture);

  const coldStartCalls = await client.pollCalls(null);
  const allTimes = fixture.calls
    .map((call) => new Date(String(call.time ?? call.occurredAt ?? "")).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  const midpoint = allTimes.length > 1 ? allTimes[0] : null;
  const incrementalCalls = midpoint
    ? await client.pollCalls({
        source: "openmhz",
        cursorKey: env.OPENMHZ_SYSTEM,
        lastOccurredAtMs: midpoint,
        lastSourceEventId: null,
        updatedAt: new Date().toISOString(),
      })
    : [];

  console.log("pollResults=");
  console.log(
    JSON.stringify(
      {
        coldStartCount: coldStartCalls.length,
        coldStartLastCallId: coldStartCalls.at(-1)?.id ?? null,
        incrementalCount: incrementalCalls.length,
        incrementalFirstCallId: incrementalCalls[0]?.id ?? null,
      },
      null,
      2,
    ),
  );

  if (summary.source !== "capture") {
    console.log("");
    console.log("No captured browser payloads found. Using synthetic fixture data.");
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
