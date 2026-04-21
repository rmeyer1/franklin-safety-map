import { NextResponse } from "next/server";

import { getEnv } from "@/lib/config/env";
import { buildOpenMhzAdapterResponse } from "@/lib/openmhz/adapter";
import { ingestCursorSchema } from "@/lib/types/domain";

function parseCursor(request: Request) {
  const { searchParams } = new URL(request.url);
  const cursorTime = searchParams.get("cursorTime");
  const cursorId = searchParams.get("cursorId");

  if (!cursorTime) {
    return null;
  }

  return ingestCursorSchema.parse({
    source: "openmhz",
    cursorKey: searchParams.get("system") ?? "openmhz",
    lastOccurredAtMs: Number.parseInt(cursorTime, 10),
    lastSourceEventId: cursorId,
    updatedAt: new Date().toISOString(),
  });
}

function isAuthorized(request: Request): boolean {
  const env = getEnv();

  if (!env.OPENMHZ_ADAPTER_TOKEN) {
    return true;
  }

  return request.headers.get("x-openmhz-adapter-token") === env.OPENMHZ_ADAPTER_TOKEN;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const env = getEnv();
  const { searchParams } = new URL(request.url);
  const system = searchParams.get("system") ?? env.OPENMHZ_SYSTEM;

  try {
    const response = await buildOpenMhzAdapterResponse({
      system,
      cursor: parseCursor(request),
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "adapter_error";
    return NextResponse.json(
      { error: message, system, mode: env.OPENMHZ_ADAPTER_MODE },
      { status: 502 },
    );
  }
}
