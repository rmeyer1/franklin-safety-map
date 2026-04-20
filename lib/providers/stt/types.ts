import type { Transcription } from "@/lib/types/domain";

export interface SpeechToTextProvider {
  readonly name: "xai" | "openai";
  isConfigured(): boolean;
  transcribe(input: { audio: Buffer; fileName: string; mimeType: string }): Promise<Transcription>;
}

