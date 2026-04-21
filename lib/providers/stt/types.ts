import type { Transcription } from "@/lib/types/domain";

export interface SpeechToTextProvider {
  readonly name: "whisper_local" | "xai" | "openai";
  isConfigured(): boolean;
  transcribe(input: { audio: Buffer; fileName: string; mimeType: string }): Promise<Transcription>;
}
