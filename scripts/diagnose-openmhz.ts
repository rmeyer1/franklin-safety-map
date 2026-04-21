import { createOpenMhzClient } from "@/lib/openmhz/client";
import { getEnv } from "@/lib/config/env";

type EndpointCheck = {
  name: string;
  path: string;
};

type DiagnosticResult = {
  name: string;
  url: string;
  ok: boolean;
  status: number | null;
  contentType: string | null;
  bodyPreview: string;
  error?: string;
};

const ENDPOINTS: EndpointCheck[] = [
  { name: "talkgroups", path: "/talkgroups" },
  { name: "calls/latest", path: "/calls/latest" },
  { name: "calls/newer", path: "/calls/newer?time=0" },
];

function buildBaseUrl(): string {
  const env = getEnv();
  return env.OPENMHZ_API_BASE_URL || "https://api.openmhz.com";
}

function buildSystemUrl(path: string): string {
  const env = getEnv();
  const baseUrl = buildBaseUrl();
  return new URL(`/${env.OPENMHZ_SYSTEM}${path}`, baseUrl).toString();
}

function formatPreview(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 240);
}

async function fetchEndpoint(endpoint: EndpointCheck): Promise<DiagnosticResult> {
  const url = buildSystemUrl(endpoint.path);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
      },
      cache: "no-store",
    });

    const body = await response.text();

    return {
      name: endpoint.name,
      url,
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
      bodyPreview: formatPreview(body),
    };
  } catch (error) {
    return {
      name: endpoint.name,
      url,
      ok: false,
      status: null,
      contentType: null,
      bodyPreview: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runClientProbe() {
  try {
    const client = createOpenMhzClient();
    const calls = await client.pollCalls(null);

    return {
      ok: true,
      callCount: calls.length,
      firstCall: calls[0] ?? null,
      lastCall: calls.at(-1) ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const env = getEnv();
  const baseUrl = buildBaseUrl();

  console.log("OpenMHz diagnostic");
  console.log(`system=${env.OPENMHZ_SYSTEM}`);
  console.log(`baseUrl=${baseUrl}`);
  console.log("");

  const endpointResults = await Promise.all(
    ENDPOINTS.map((endpoint) => fetchEndpoint(endpoint)),
  );

  for (const result of endpointResults) {
    console.log(`[${result.name}] ${result.url}`);
    console.log(`status=${result.status ?? "error"} ok=${result.ok}`);
    if (result.contentType) {
      console.log(`contentType=${result.contentType}`);
    }
    if (result.error) {
      console.log(`error=${result.error}`);
    }
    if (result.bodyPreview) {
      console.log(`bodyPreview=${result.bodyPreview}`);
    }
    console.log("");
  }

  const clientProbe = await runClientProbe();
  console.log("[client.pollCalls(null)]");
  console.log(JSON.stringify(clientProbe, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
