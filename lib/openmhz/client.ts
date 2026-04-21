import { getEnv } from "@/lib/config/env";
import {
  openMhzAdapterResponseSchema,
  type IngestCursor,
  type OpenMhzCall,
} from "@/lib/types/domain";

export interface OpenMhzClient {
  pollCalls(cursor: IngestCursor | null): Promise<OpenMhzCall[]>;
}

export type OpenMhzTalkgroupMap = Record<
  number,
  {
    alpha?: string;
    description?: string;
  }
>;

export function normalizeTime(value: unknown): { iso: string; ms: number } {
  if (typeof value === "number") {
    const date = new Date(value);
    return { iso: date.toISOString(), ms: date.getTime() };
  }

  const date = new Date(String(value ?? Date.now()));
  return { iso: date.toISOString(), ms: date.getTime() };
}

export function parseTalkgroupNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function normalizeCall(
  item: unknown,
  talkgroups: OpenMhzTalkgroupMap,
): OpenMhzCall | null {
  const record = item as Record<string, unknown>;
  const time = normalizeTime(record.time ?? record.occurredAt ?? Date.now());
  const talkgroupNumber = parseTalkgroupNumber(record.talkgroupNum);
  const talkgroupInfo =
    talkgroupNumber !== null ? talkgroups[talkgroupNumber] : undefined;
  const audioUrl = String(record.audioUrl ?? record.url ?? "");

  if (!audioUrl) {
    return null;
  }

  return {
    id: String(record.id ?? record._id ?? crypto.randomUUID()),
    occurredAt: time.iso,
    occurredAtMs: time.ms,
    talkgroupNumber,
    talkgroup:
      talkgroupNumber !== null ? String(talkgroupNumber) : null,
    talkgroupLabel:
      typeof talkgroupInfo?.description === "string"
        ? talkgroupInfo.description
        : typeof record.talkgroupLabel === "string"
          ? record.talkgroupLabel
          : null,
    audioUrl,
    fileName:
      typeof record.name === "string" && record.name.length > 0
        ? record.name
        : null,
    durationSeconds:
      typeof record.len === "number" ? record.len : null,
  };
}

export function parseCallsPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as Record<string, unknown>).calls)
  ) {
    return (payload as Record<string, unknown>).calls as unknown[];
  }

  return [];
}

export function parseTalkgroupsPayload(payload: unknown): OpenMhzTalkgroupMap {
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as Record<string, unknown>).talkgroups !== "object"
  ) {
    return {};
  }

  const map = (payload as Record<string, unknown>).talkgroups as Record<
    string,
    unknown
  >;
  const normalized: OpenMhzTalkgroupMap = {};

  for (const [key, value] of Object.entries(map)) {
    const talkgroupNumber = parseTalkgroupNumber(key);
    if (talkgroupNumber === null || !value || typeof value !== "object") {
      continue;
    }

    const record = value as Record<string, unknown>;
    normalized[talkgroupNumber] = {
      alpha:
        typeof record.alpha === "string" ? record.alpha : undefined,
      description:
        typeof record.description === "string"
          ? record.description
          : undefined,
    };
  }

  return normalized;
}

function buildAllowedTalkgroups(envValue?: string): Set<number> | null {
  if (!envValue) {
    return null;
  }

  const values = envValue
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value));

  return values.length > 0 ? new Set(values) : null;
}

export class OpenMhzHttpClient implements OpenMhzClient {
  private talkgroupsCache?: OpenMhzTalkgroupMap;
  private readonly requestHeaders: HeadersInit = {
    Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    "User-Agent":
      "Mozilla/5.0 (compatible; franklin-safety-map-ingest/1.0)",
  };

  constructor(
    private readonly system = getEnv().OPENMHZ_SYSTEM,
    private readonly fixture?: {
      calls: Array<Record<string, unknown>>;
      talkgroups: Record<number, { alpha?: string; description?: string }>;
    },
  ) {}

  static fromFixture(
    system: string,
    fixture: {
      calls: Array<Record<string, unknown>>;
      talkgroups: Record<number, { alpha?: string; description?: string }>;
    },
  ) {
    return new OpenMhzHttpClient(system, fixture);
  }

  private async fetchJson(pathname: string, params?: URLSearchParams) {
    if (this.fixture) {
      if (pathname.endsWith("/talkgroups")) {
        return { talkgroups: this.fixture.talkgroups };
      }

      if (pathname.endsWith("/calls/latest")) {
        return { calls: this.fixture.calls };
      }

      if (pathname.endsWith("/calls/newer")) {
        const sinceMs = Number.parseInt(params?.get("time") ?? "0", 10);
        const calls = this.fixture.calls.filter((call) => {
          const normalized = normalizeTime(
            (call as Record<string, unknown>).time,
          );
          return normalized.ms > sinceMs;
        });

        return { calls };
      }
    }

    const env = getEnv();

    if (!env.OPENMHZ_API_BASE_URL) {
      return null;
    }

    const url = new URL(pathname, env.OPENMHZ_API_BASE_URL);
    if (params) {
      url.search = params.toString();
    }

    const response = await fetch(url, {
      headers: this.requestHeaders,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`OpenMHz request failed with status ${response.status} for ${url.toString()}`);
    }

    return (await response.json()) as unknown;
  }

  private async getTalkgroups(): Promise<OpenMhzTalkgroupMap> {
    if (this.talkgroupsCache) {
      return this.talkgroupsCache;
    }

    const env = getEnv();
    const payload = await this.fetchJson(`/${this.system}/talkgroups`);
    this.talkgroupsCache = parseTalkgroupsPayload(payload);
    return this.talkgroupsCache;
  }

  async pollCalls(cursor: IngestCursor | null): Promise<OpenMhzCall[]> {
    const env = getEnv();

    if (!this.fixture && !env.OPENMHZ_API_BASE_URL) {
      return [];
    }

    const talkgroups = await this.getTalkgroups();
    const allowedTalkgroups = buildAllowedTalkgroups(
      env.OPENMHZ_TALKGROUP_ALLOWLIST,
    );
    const payload = cursor
      ? await this.fetchJson(
          `/${this.system}/calls/newer`,
          new URLSearchParams({
            time: String(
              Math.max(0, cursor.lastOccurredAtMs - env.OPENMHZ_POLL_LOOKBACK_MS),
            ),
          }),
        )
      : await this.fetchJson(`/${this.system}/calls/latest`);

    const calls = parseCallsPayload(payload)
      .map((item) => normalizeCall(item, talkgroups))
      .filter((call): call is OpenMhzCall => call !== null)
      .filter((call) =>
        allowedTalkgroups
          ? call.talkgroupNumber !== null &&
            allowedTalkgroups.has(call.talkgroupNumber)
          : true,
      )
      .sort((left, right) => left.occurredAtMs - right.occurredAtMs);

    if (!cursor) {
      return calls.slice(-1);
    }

    return calls;
  }
}

export class OpenMhzAdapterHttpClient implements OpenMhzClient {
  async pollCalls(cursor: IngestCursor | null): Promise<OpenMhzCall[]> {
    const env = getEnv();

    if (!env.OPENMHZ_ADAPTER_BASE_URL) {
      return [];
    }

    const url = new URL(env.OPENMHZ_ADAPTER_CALLS_PATH, env.OPENMHZ_ADAPTER_BASE_URL);
    url.searchParams.set("system", env.OPENMHZ_SYSTEM);

    if (cursor) {
      url.searchParams.set("cursorTime", String(cursor.lastOccurredAtMs));
      if (cursor.lastSourceEventId) {
        url.searchParams.set("cursorId", cursor.lastSourceEventId);
      }
    }

    const headers: HeadersInit = {
      Accept: "application/json",
    };

    if (env.OPENMHZ_ADAPTER_TOKEN) {
      headers["x-openmhz-adapter-token"] = env.OPENMHZ_ADAPTER_TOKEN;
    }

    const response = await fetch(url, {
      headers,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`OpenMHz adapter request failed with status ${response.status} for ${url.toString()}`);
    }

    const payload = openMhzAdapterResponseSchema.parse(await response.json());
    return payload.calls;
  }
}

export function createOpenMhzClient(): OpenMhzClient {
  if (getEnv().OPENMHZ_ADAPTER_BASE_URL) {
    return new OpenMhzAdapterHttpClient();
  }

  return new OpenMhzHttpClient();
}
