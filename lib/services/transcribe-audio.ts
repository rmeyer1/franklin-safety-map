import { OpenAiSpeechToTextProvider } from "@/lib/providers/stt/openai";
import type { SpeechToTextProvider } from "@/lib/providers/stt/types";
import { XaiSpeechToTextProvider } from "@/lib/providers/stt/xai";
import type { Transcription } from "@/lib/types/domain";

export interface TranscriptionService {
  transcribe(input: {
    audio: Buffer;
    fileName: string;
    mimeType: string;
  }): Promise<Transcription>;
}

export class ProviderFallbackTranscriptionService implements TranscriptionService {
  constructor(private readonly providers: SpeechToTextProvider[]) {}

  async transcribe(input: {
    audio: Buffer;
    fileName: string;
    mimeType: string;
  }): Promise<Transcription> {
    const errors: string[] = [];

    for (const provider of this.providers) {
      if (!provider.isConfigured()) {
        errors.push(`${provider.name}: not configured`);
        continue;
      }

      try {
        const transcription = await provider.transcribe(input);
        if (transcription.text.trim().length > 0) {
          return transcription;
        }

        errors.push(`${provider.name}: empty transcription`);
      } catch (error) {
        errors.push(
          `${provider.name}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }

    throw new Error(`All STT providers failed: ${errors.join("; ")}`);
  }
}

export function createTranscriptionService(): TranscriptionService {
  return new ProviderFallbackTranscriptionService([
    new XaiSpeechToTextProvider(),
    new OpenAiSpeechToTextProvider(),
  ]);
}

