import { getEnv } from "@/lib/config/env";
import { OpenMhzSourceAdapter } from "@/lib/sources/openmhz";
import type { SourceAdapter } from "@/lib/sources/types";

export function createSourceAdapter(): SourceAdapter {
  const env = getEnv();

  switch (env.INGEST_SOURCE) {
    case "openmhz":
      return new OpenMhzSourceAdapter();
    default:
      throw new Error(`Unsupported ingest source: ${env.INGEST_SOURCE satisfies never}`);
  }
}
