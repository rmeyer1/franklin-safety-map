/**
 * Cloudflare-aware fetch for OpenMHz API.
 *
 * OpenMHz (api.openmhz.com) is behind Cloudflare JS challenge.
 * Raw `fetch()` from Node.js gets 403 — Cloudflare checks TLS fingerprint.
 *
 * Strategy:
 * 1. Launch headless Playwright browser
 * 2. Navigate to OpenMHz to solve Cloudflare challenge
 * 3. Keep the browser page alive and use `page.evaluate(fetch(...))`
 *    to make API calls from within the page's browser context
 * 4. The page context has the cf_clearance cookie and matching TLS fingerprint
 *
 * For large responses, we use `page.evaluate` to fetch as text and parse
 * in Node.js, avoiding serialization limits.
 */

import { type Page, type BrowserContext, type Browser, chromium } from "playwright";
import { getEnv } from "@/lib/config/env";

let browserInstance: Browser | null = null;
let contextInstance: BrowserContext | null = null;
let pageInstance: Page | null = null;
let lastActivityMs = 0;

const BROWSER_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

async function ensureBrowser(): Promise<Page> {
  // Reuse existing page if still valid
  if (
    pageInstance &&
    !pageInstance.isClosed() &&
    browserInstance?.isConnected() &&
    Date.now() - lastActivityMs < BROWSER_IDLE_TIMEOUT_MS
  ) {
    return pageInstance;
  }

  await closeBrowser();

  console.log("[cf-fetch] Launching Playwright browser for Cloudflare bypass...");

  browserInstance = await chromium.launch({ headless: true });
  contextInstance = await browserInstance.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  pageInstance = await contextInstance.newPage();

  // Navigate to trigger Cloudflare challenge
  await pageInstance.goto("https://openmhz.com/system/frkoh", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  // Wait for cf_clearance cookie (HttpOnly, so need context.cookies())
  const maxWaitMs = 20_000;
  const startMs = Date.now();

  while (Date.now() - startMs < maxWaitMs) {
    await pageInstance.waitForTimeout(2000);

    const cookies = await contextInstance.cookies();
    if (cookies.some((c) => c.name === "cf_clearance")) {
      console.log("[cf-fetch] Cloudflare challenge solved (cf_clearance found)!");
      break;
    }
  }

  // Extra wait for cookie to propagate to API subdomain
  await pageInstance.waitForTimeout(2000);

  // Verify API works from page context (only way to pass CF)
  const apiStatus = await pageInstance.evaluate(() => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://api.openmhz.com/frkoh/talkgroups");
      xhr.timeout = 15000;
      xhr.onload = () => resolve(xhr.status);
      xhr.onerror = () => resolve(0);
      xhr.ontimeout = () => resolve(0);
      xhr.send();
    });
  });

  if (apiStatus !== 200) {
    await closeBrowser();
    throw new Error(
      `Cloudflare challenge not solved — API returned ${apiStatus}`,
    );
  }

  console.log("[cf-fetch] Browser session ready, API accessible");
  lastActivityMs = Date.now();
  return pageInstance;
}

async function closeBrowser(): Promise<void> {
  try {
    if (browserInstance) await browserInstance.close();
  } catch {
    // ignore
  }
  browserInstance = null;
  contextInstance = null;
  pageInstance = null;
}

/**
 * Fetch JSON from OpenMHz API using browser page context to bypass Cloudflare.
 * Uses page.evaluate to run fetch inside the browser, then returns the
 * response body as text (avoiding serialization limits on large responses).
 */
export async function cfFetchJson(
  url: string | URL,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const page = await ensureBrowser();
    const urlStr = url.toString();

    const evalResult: { ok: boolean; status: number; body: string | null; error?: string } =
      await page.evaluate(
        async (fetchUrl: string) => {
          // Use XMLHttpRequest instead of fetch() — fetch() gets "Failed to fetch"
          // on /calls/* endpoints (likely CORS preflight issue), while XHR works.
          return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", fetchUrl);
            xhr.setRequestHeader("Accept", "application/json");
            xhr.timeout = 30000; // 30s timeout
            xhr.onload = () => {
              resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body: xhr.responseText });
            };
            xhr.onerror = () => {
              resolve({ ok: false, status: 0, body: null, error: "XHR error" });
            };
            xhr.ontimeout = () => {
              resolve({ ok: false, status: 0, body: null, error: "XHR timeout" });
            };
            xhr.send();
          });
        },
        urlStr,
      );

    lastActivityMs = Date.now();

    if (!evalResult.ok) {
      const errMsg = evalResult.error
        ? `[cf-fetch] page.evaluate fetch error: ${evalResult.error}`
        : `[cf-fetch] API returned status ${evalResult.status}`;
      console.error(errMsg);

      if (evalResult.status === 403 || evalResult.status === 0) {
        console.warn("[cf-fetch] Session may have expired, will restart on next request...");
        await closeBrowser();
      }
      return { ok: false, status: evalResult.status ?? 0, data: null };
    }

    try {
      const data = JSON.parse(evalResult.body ?? "null") as unknown;
      return { ok: true, status: evalResult.status, data };
    } catch {
      console.error("[cf-fetch] Failed to parse JSON response");
      return { ok: false, status: 0, data: null };
    }
  } catch (error) {
    console.warn(
      "[cf-fetch] Browser fetch failed, falling back to plain fetch:",
      error instanceof Error ? error.message : error,
    );

    // Fallback: plain fetch with browser headers (won't work past CF but worth trying)
    const response = await fetch(url, {
      headers: {
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Referer: "https://openmhz.com/",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return { ok: false, status: response.status, data: null };
    }

    const data = (await response.json()) as unknown;
    return { ok: true, status: response.status, data };
  }
}

/**
 * Invalidate cached session (restart browser on next request).
 */
export function invalidateCfCookies(): void {
  closeBrowser().catch(() => {});
}

/**
 * Check if Playwright is available (for startup diagnostics).
 */
export function isPlaywrightAvailable(): boolean {
  try {
    require.resolve("playwright");
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up browser resources (call on process exit).
 */
export function cleanupCfBrowser(): void {
  closeBrowser().catch(() => {});
}