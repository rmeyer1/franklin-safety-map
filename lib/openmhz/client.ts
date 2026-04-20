import { getEnv } from "@/lib/config/env";
import type { OpenMhzCall } from "@/lib/types/domain";

export interface OpenMhzClient {
  listRecentCalls(): Promise<OpenMhzCall[]>;
}

export class OpenMhzHttpClient implements OpenMhzClient {
  async listRecentCalls(): Promise<OpenMhzCall[]> {
    const env = getEnv();

    if (!env.OPENMHZ_API_BASE_URL) {
      return [];
    }

    const url = new URL(`/api/systems/${env.OPENMHZ_SYSTEM}/calls`, env.OPENMHZ_API_BASE_URL);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`OpenMHz request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as unknown;

    if (!Array.isArray(payload)) {
      return [];
    }

    return payload
      .map((item) => {
        const record = item as Record<string, unknown>;

        return {
          id: String(record.id ?? record._id ?? crypto.randomUUID()),
          occurredAt: new Date(String(record.time ?? record.occurredAt ?? Date.now())).toISOString(),
          talkgroup: record.talkgroup ? String(record.talkgroup) : null,
          talkgroupLabel: record.talkgroupLabel ? String(record.talkgroupLabel) : null,
          audioUrl: String(record.audioUrl ?? record.url ?? ""),
        } satisfies OpenMhzCall;
      })
      .filter((call) => call.audioUrl.length > 0);
  }
}

export function createOpenMhzClient(): OpenMhzClient {
  return new OpenMhzHttpClient();
}

