import OpenAI from "openai";

import { getEnv } from "@/lib/config/env";
import { transcriptionSchema, type Transcription } from "@/lib/types/domain";
import type { SpeechToTextProvider } from "@/lib/providers/stt/types";

export class OpenAiSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "openai" as const;

  isConfigured(): boolean {
    return Boolean(getEnv().OPENAI_API_KEY);
  }

  async transcribe(input: {
    audio: Buffer;
    fileName: string;
    mimeType: string;
  }): Promise<Transcription> {
    const env = getEnv();

    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const bytes = new Uint8Array(input.audio);
    const file = new File([bytes], input.fileName, { type: input.mimeType });

    const result = await client.audio.transcriptions.create({
      file,
      model: env.OPENAI_STT_MODEL,
    });

    return transcriptionSchema.parse({
      provider: "openai",
      text: result.text,
    });
  }
}
