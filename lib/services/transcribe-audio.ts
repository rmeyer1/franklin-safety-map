import { OpenAiSpeechToTextProvider } from "@/lib/providers/stt/openai";
import type { SpeechToTextProvider } from "@/lib/providers/stt/types";
import { WhisperLocalSpeechToTextProvider } from "@/lib/providers/stt/whisper-local";
import { XaiSpeechToTextProvider } from "@/lib/providers/stt/xai";
import type { Transcription } from "@/lib/types/domain";

export interface TranscriptionService {
  transcribe(input: {
    audio: Buffer;
    fileName: string;
    mimeType: string;
  }): Promise<Transcription>;
}

export class TranscriptionFailedError extends Error {
  constructor(
    readonly kind: "no_speech" | "provider_error",
    message: string,
  ) {
    super(message);
    this.name = "TranscriptionFailedError";
  }
}

export class ProviderFallbackTranscriptionService implements TranscriptionService {
  constructor(private readonly providers: SpeechToTextProvider[]) {}

  async transcribe(input: {
    audio: Buffer;
    fileName: string;
    mimeType: string;
  }): Promise<Transcription> {
    const errors: string[] = [];
    let hasConfiguredProvider = false;
    let hasEmptyTranscription = false;
    let hasProviderExecutionError = false;

    for (const provider of this.providers) {
      if (!provider.isConfigured()) {
        errors.push(`${provider.name}: not configured`);
        continue;
      }

      hasConfiguredProvider = true;

      try {
        const transcription = await provider.transcribe(input);
        if (transcription.text.trim().length > 0) {
          return transcription;
        }

        hasEmptyTranscription = true;
        errors.push(`${provider.name}: empty transcription`);
      } catch (error) {
        hasProviderExecutionError = true;
        errors.push(
          `${provider.name}: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }

    const summary = `All STT providers failed: ${errors.join("; ")}`;

    if (hasEmptyTranscription && !hasProviderExecutionError) {
      throw new TranscriptionFailedError("no_speech", summary);
    }

    if (!hasConfiguredProvider) {
      throw new TranscriptionFailedError("provider_error", summary);
    }

    throw new TranscriptionFailedError("provider_error", summary);
  }
}

export function createTranscriptionService(): TranscriptionService {
  return new ProviderFallbackTranscriptionService([
    new WhisperLocalSpeechToTextProvider(),
    new XaiSpeechToTextProvider(),
    new OpenAiSpeechToTextProvider(),
  ]);
}
