import fs from "node:fs";
import path from "node:path";

import { getEnv } from "@/lib/config/env";

type FixtureTalkgroup = {
  alpha?: string;
  description?: string;
};

export type FixtureData = {
  calls: Array<Record<string, unknown>>;
  talkgroups: Record<number, FixtureTalkgroup>;
};

export type FixtureResolution = {
  source: "capture" | "synthetic";
  files: string[];
  data: FixtureData;
};

const FRKOH_FIXTURE: FixtureData = {
  calls: [
    {
      _id: "frkoh-fixture-001",
      time: Date.parse("2026-04-20T14:03:12.000Z"),
      talkgroupNum: 10101,
      url: "https://example.com/audio/frkoh-fixture-001.m4a",
      name: "frkoh-fixture-001.m4a",
      len: 18,
    },
    {
      _id: "frkoh-fixture-002",
      time: Date.parse("2026-04-20T14:05:44.000Z"),
      talkgroupNum: 10103,
      url: "https://example.com/audio/frkoh-fixture-002.m4a",
      name: "frkoh-fixture-002.m4a",
      len: 11,
    },
    {
      _id: "frkoh-fixture-003",
      time: Date.parse("2026-04-20T14:08:19.000Z"),
      talkgroupNum: 10101,
      url: "https://example.com/audio/frkoh-fixture-003.m4a",
      name: "frkoh-fixture-003.m4a",
      len: 23,
    },
  ],
  talkgroups: {
    10101: {
      alpha: "Dispatch 1",
      description: "Franklin County Sheriff Dispatch 1",
    },
    10103: {
      alpha: "Dispatch 3",
      description: "Franklin County Sheriff Dispatch 3",
    },
  },
};

function parseCallsPayload(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    );
  }

  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as Record<string, unknown>).calls)
  ) {
    return ((payload as Record<string, unknown>).calls as unknown[]).filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    );
  }

  return [];
}

function parseTalkgroupsPayload(payload: unknown): Record<number, FixtureTalkgroup> {
  const record =
    payload &&
    typeof payload === "object" &&
    typeof (payload as Record<string, unknown>).talkgroups === "object"
      ? ((payload as Record<string, unknown>).talkgroups as Record<string, unknown>)
      : payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};

  const talkgroups: Record<number, FixtureTalkgroup> = {};

  for (const [key, value] of Object.entries(record)) {
    const talkgroupNumber = Number.parseInt(key, 10);
    if (!Number.isFinite(talkgroupNumber) || !value || typeof value !== "object") {
      continue;
    }

    const source = value as Record<string, unknown>;
    talkgroups[talkgroupNumber] = {
      alpha: typeof source.alpha === "string" ? source.alpha : undefined,
      description:
        typeof source.description === "string" ? source.description : undefined,
    };
  }

  return talkgroups;
}

function readJsonIfPresent(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

function resolveCaptureFiles(system: string) {
  const env = getEnv();
  const systemDir = path.join(process.cwd(), env.OPENMHZ_CAPTURE_DIR, system);

  return {
    systemDir,
    callsJson: path.join(systemDir, "calls.json"),
    callsLatestJson: path.join(systemDir, "calls-latest.json"),
    talkgroupsJson: path.join(systemDir, "talkgroups.json"),
  };
}

export function resolveOpenMhzFixture(system: string): FixtureResolution {
  const files = resolveCaptureFiles(system);
  const callsPayload =
    readJsonIfPresent(files.callsJson) ?? readJsonIfPresent(files.callsLatestJson);
  const talkgroupsPayload = readJsonIfPresent(files.talkgroupsJson);

  if (callsPayload && talkgroupsPayload) {
    return {
      source: "capture",
      files: [files.callsJson, files.callsLatestJson, files.talkgroupsJson].filter(
        (filePath) => fs.existsSync(filePath),
      ),
      data: {
        calls: parseCallsPayload(callsPayload),
        talkgroups: parseTalkgroupsPayload(talkgroupsPayload),
      },
    };
  }

  if (system === "frkoh") {
    return {
      source: "synthetic",
      files: [],
      data: FRKOH_FIXTURE,
    };
  }

  return {
    source: "synthetic",
    files: [],
    data: {
      calls: [],
      talkgroups: {},
    },
  };
}

export function getOpenMhzFixture(system: string): FixtureData {
  return resolveOpenMhzFixture(system).data;
}

export function getOpenMhzCapturePaths(system: string): string[] {
  const files = resolveCaptureFiles(system);

  return [files.callsJson, files.callsLatestJson, files.talkgroupsJson];
}

export function getOpenMhzFixtureSummary(system: string) {
  const resolved = resolveOpenMhzFixture(system);
  const times = resolved.data.calls
    .map((call) => {
      const value = (call.time ?? call.occurredAt) as number | string | undefined;
      const date =
        typeof value === "number" ? new Date(value) : new Date(String(value ?? ""));
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    })
    .filter((value): value is string => value !== null)
    .sort();

  return {
    source: resolved.source,
    files: resolved.files,
    callCount: resolved.data.calls.length,
    talkgroupCount: Object.keys(resolved.data.talkgroups).length,
    firstCallAt: times[0] ?? null,
    lastCallAt: times.at(-1) ?? null,
  };
}
