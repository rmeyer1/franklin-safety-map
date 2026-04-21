import { createOpenMhzClient } from "@/lib/openmhz/client";
import type { SourceAdapter } from "@/lib/sources/types";
import { getEnv } from "@/lib/config/env";
import type { IngestCursor, OpenMhzCall, SourceCall } from "@/lib/types/domain";

function mapOpenMhzCallToSourceCall(call: OpenMhzCall): SourceCall {
  return {
    source: "openmhz",
    cursorKey: getEnv().OPENMHZ_SYSTEM,
    sourceEventId: call.id,
    occurredAt: call.occurredAt,
    occurredAtMs: call.occurredAtMs,
    audioUrl: call.audioUrl,
    fileName: call.fileName,
    transcriptText: null,
    channel: call.talkgroup,
    label: call.talkgroupLabel,
    durationSeconds: call.durationSeconds,
    metadata: {
      talkgroup: call.talkgroup,
      talkgroupNumber: call.talkgroupNumber,
      talkgroupLabel: call.talkgroupLabel,
    },
  };
}

export class OpenMhzSourceAdapter implements SourceAdapter {
  readonly source = "openmhz";
  readonly cursorKey = getEnv().OPENMHZ_SYSTEM;

  async poll(cursor: IngestCursor | null): Promise<SourceCall[]> {
    const client = createOpenMhzClient();
    const calls = await client.pollCalls(cursor);
    return calls.map(mapOpenMhzCallToSourceCall);
  }
}
