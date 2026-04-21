import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

import { getEnv } from "@/lib/config/env";
import { transcriptionSchema, type Transcription } from "@/lib/types/domain";
import type { SpeechToTextProvider } from "@/lib/providers/stt/types";

const execFileAsync = promisify(execFile);

function extensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case "audio/wav":
      return ".wav";
    case "audio/mp4":
      return ".m4a";
    case "audio/ogg":
      return ".ogg";
    case "audio/webm":
      return ".webm";
    default:
      return ".mp3";
  }
}

export class WhisperLocalSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "whisper_local" as const;

  isConfigured(): boolean {
    const env = getEnv();
    return env.WHISPER_LOCAL_ENABLED;
  }

  async transcribe(input: {
    audio: Buffer;
    fileName: string;
    mimeType: string;
  }): Promise<Transcription> {
    const env = getEnv();

    if (!env.WHISPER_LOCAL_ENABLED) {
      throw new Error("WHISPER_LOCAL_ENABLED is false");
    }

    const sourceExt = extname(input.fileName).toLowerCase();
    const audioExt = sourceExt.length > 0 ? sourceExt : extensionFromMimeType(input.mimeType);
    const tempDir = await mkdtemp(join(tmpdir(), "franklin-whisper-"));
    const audioPath = join(tempDir, `input${audioExt}`);
    const outputBasename = basename(audioPath, audioExt);
    const outputTextPath = join(tempDir, `${outputBasename}.txt`);

    try {
      await writeFile(audioPath, input.audio);

      const args = [
        audioPath,
        "--model",
        env.WHISPER_MODEL,
        "--output_format",
        "txt",
        "--output_dir",
        tempDir,
        "--task",
        "transcribe",
      ];

      if (env.WHISPER_LANGUAGE) {
        args.push("--language", env.WHISPER_LANGUAGE);
      }

      if (env.WHISPER_EXTRA_ARGS.trim().length > 0) {
        const extraArgs = env.WHISPER_EXTRA_ARGS.split(" ")
          .map((arg) => arg.trim())
          .filter((arg) => arg.length > 0);
        args.push(...extraArgs);
      }

      await execFileAsync(env.WHISPER_COMMAND, args);

      const text = await readFile(outputTextPath, "utf8");

      return transcriptionSchema.parse({
        provider: "whisper_local",
        text: text.trim(),
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new Error(
          `Whisper command not found: ${env.WHISPER_COMMAND}. Install whisper and ffmpeg, or set WHISPER_COMMAND to the correct binary.`,
        );
      }

      throw error;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
