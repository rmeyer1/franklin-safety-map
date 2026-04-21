import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: ".env.local" });
dotenv.config();

const envBooleanSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  INGEST_SOURCE: z.enum(["openmhz"]).default("openmhz"),
  OPENMHZ_SYSTEM: z.string().default("frkoh"),
  OPENMHZ_API_BASE_URL: z.string().trim().optional(),
  OPENMHZ_ADAPTER_BASE_URL: z.string().trim().optional(),
  OPENMHZ_ADAPTER_CALLS_PATH: z.string().default("/api/ingest/openmhz/calls"),
  OPENMHZ_ADAPTER_MODE: z.enum(["direct", "fixture"]).default("direct"),
  OPENMHZ_ADAPTER_TOKEN: z.string().optional(),
  OPENMHZ_CAPTURE_DIR: z.string().default("data/openmhz"),
  OPENMHZ_WEB_BASE_URL: z.string().default("https://openmhz.com"),
  OPENMHZ_POLL_LOOKBACK_MS: z.coerce.number().int().min(0).default(5000),
  OPENMHZ_TALKGROUP_ALLOWLIST: z.string().optional(),
  WHISPER_LOCAL_ENABLED: envBooleanSchema.default(false),
  WHISPER_COMMAND: z.string().default("whisper"),
  WHISPER_MODEL: z.string().default("turbo"),
  WHISPER_LANGUAGE: z.string().trim().default("en"),
  WHISPER_EXTRA_ARGS: z.string().trim().default(""),
  INCIDENT_EXTRACTION_PROVIDER: z
    .enum(["auto", "heuristic", "ollama"])
    .default("auto"),
  RADIO_CODEBOOK_PATH: z.string().default("data/radio-codes/frkoh.json"),
  EXTRACTION_PROMPT_VERSION: z.string().default("v1"),
  XAI_API_KEY: z.string().optional(),
  XAI_STT_MODEL: z.string().default("grok-2-stt"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_STT_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  OLLAMA_API_URL: z.string().optional(),
  OLLAMA_MODEL: z.string().default("llama3.1:8b"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_DB_URL: z.string().optional(),
  MAPBOX_ACCESS_TOKEN: z.string().optional(),
  WORKER_MODE: z.enum(["once", "loop"]).default("once"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  WORKER_ERROR_BACKOFF_MS: z.coerce.number().int().positive().default(30000),
  WORKER_MAX_CALLS_PER_RUN: z.coerce.number().int().positive().default(10),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = envSchema.parse(process.env);
  return cachedEnv;
}
