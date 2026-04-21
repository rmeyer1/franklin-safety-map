import { NextResponse } from "next/server";

import { getEnv } from "@/lib/config/env";

export const dynamic = "force-dynamic";

type EndpointCheck = {
  name: string;
  path: string;
};

type EndpointResult = {
  name: string;
  url: string;
  ok: boolean;
  status: number | null;
  contentType: string | null;
  bodyPreview: string;
  jsonKeys: string[] | null;
  error?: string;
};

const ENDPOINTS: EndpointCheck[] = [
  { name: "talkgroups", path: "/talkgroups" },
  { name: "calls/latest", path: "/calls/latest" },
  { name: "calls/newer", path: "/calls/newer?time=0" },
];

function formatPreview(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 240);
}

function resolveBaseUrl(request: Request): string {
  const env = getEnv();
  const { searchParams } = new URL(request.url);
  return (
    searchParams.get("baseUrl") ??
    env.OPENMHZ_API_BASE_URL ??
    "https://api.openmhz.com"
  );
}

function resolveSystem(request: Request): string {
  const env = getEnv();
  const { searchParams } = new URL(request.url);
  return searchParams.get("system") ?? env.OPENMHZ_SYSTEM;
}

async function fetchEndpoint(
  baseUrl: string,
  system: string,
  endpoint: EndpointCheck,
): Promise<EndpointResult> {
  const url = new URL(`/${system}${endpoint.path}`, baseUrl).toString();

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (compatible; franklin-safety-map-adapter-check/1.0)",
      },
      cache: "no-store",
    });

    const contentType = response.headers.get("content-type");
    const body = await response.text();
    let jsonKeys: string[] | null = null;

    if (contentType?.includes("application/json")) {
      try {
        const parsed = JSON.parse(body) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          jsonKeys = Object.keys(parsed as Record<string, unknown>).slice(0, 12);
        }
      } catch {
        jsonKeys = null;
      }
    }

    return {
      name: endpoint.name,
      url,
      ok: response.ok,
      status: response.status,
      contentType,
      bodyPreview: formatPreview(body),
      jsonKeys,
    };
  } catch (error) {
    return {
      name: endpoint.name,
      url,
      ok: false,
      status: null,
      contentType: null,
      bodyPreview: "",
      jsonKeys: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET(request: Request) {
  const baseUrl = resolveBaseUrl(request);
  const system = resolveSystem(request);
  const results = await Promise.all(
    ENDPOINTS.map((endpoint) => fetchEndpoint(baseUrl, system, endpoint)),
  );

  const okCount = results.filter((result) => result.ok).length;

  return NextResponse.json(
    {
      baseUrl,
      system,
      okCount,
      results,
    },
    { status: okCount === results.length ? 200 : 207 },
  );
}
