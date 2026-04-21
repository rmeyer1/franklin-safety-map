import { getEnv } from "@/lib/config/env";
import { transcriptionSchema, type Transcription } from "@/lib/types/domain";
import type { SpeechToTextProvider } from "@/lib/providers/stt/types";

export class XaiSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "xai" as const;

  isConfigured(): boolean {
    return Boolean(getEnv().XAI_API_KEY);
  }

  async transcribe(input: {
    audio: Buffer;
    fileName: string;
    mimeType: string;
  }): Promise<Transcription> {
    const env = getEnv();

    if (!env.XAI_API_KEY) {
      throw new Error("XAI_API_KEY is not configured");
    }

    const bytes = new Uint8Array(input.audio);
    const form = new FormData();
    form.append("format", "true");
    form.append("language", "en");
    form.append(
      "file",
      new Blob([bytes], { type: input.mimeType }),
      input.fileName,
    );

    const response = await fetch("https://api.x.ai/v1/stt", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.XAI_API_KEY}`,
      },
      body: form,
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(
        `xAI STT request failed with status ${response.status}: ${responseBody.slice(0, 240)}`,
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    return transcriptionSchema.parse({
      provider: "xai",
      text: String(payload.text ?? ""),
      confidence:
        typeof payload.confidence === "number" ? payload.confidence : undefined,
    });
  }
}
