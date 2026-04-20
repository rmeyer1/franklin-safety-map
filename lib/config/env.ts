import { z } from "zod";

const envSchema = z.object({
  OPENMHZ_SYSTEM: z.string().default("frkoh"),
  OPENMHZ_API_BASE_URL: z.string().optional(),
  OPENMHZ_WEB_BASE_URL: z.string().default("https://openmhz.com"),
  XAI_API_KEY: z.string().optional(),
  XAI_STT_MODEL: z.string().default("grok-2-stt"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_STT_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  OLLAMA_API_URL: z.string().optional(),
  OLLAMA_MODEL: z.string().default("llama3.1:8b"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  MAPBOX_ACCESS_TOKEN: z.string().optional(),
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

