import { getEnv } from "@/lib/config/env";
import { OpenMhzHttpClient } from "@/lib/openmhz/client";
import { getOpenMhzFixture } from "@/lib/openmhz/fixture";
import {
  openMhzAdapterResponseSchema,
  type IngestCursor,
  type OpenMhzAdapterResponse,
} from "@/lib/types/domain";

export type OpenMhzAdapterMode = "direct" | "fixture";

type BuildBatchInput = {
  system: string;
  cursor: IngestCursor | null;
};

function resolveMode(): OpenMhzAdapterMode {
  const env = getEnv();
  return env.OPENMHZ_ADAPTER_MODE;
}

export async function buildOpenMhzAdapterResponse(
  input: BuildBatchInput,
): Promise<OpenMhzAdapterResponse> {
  const mode = resolveMode();
  const client =
    mode === "fixture"
      ? OpenMhzHttpClient.fromFixture(input.system, getOpenMhzFixture(input.system))
      : new OpenMhzHttpClient(input.system);

  const calls = await client.pollCalls(input.cursor);

  return openMhzAdapterResponseSchema.parse({
    system: input.system,
    mode,
    generatedAt: new Date().toISOString(),
    calls,
  });
}
