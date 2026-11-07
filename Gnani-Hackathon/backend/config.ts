import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });

const DEFAULT_STT_URL = "wss://api.vachana.ai/stt/v3/stream";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: intFromEnv("PORT", 8787),
  host: process.env.HOST ?? "0.0.0.0",
  isProduction: process.env.NODE_ENV === "production",

  /** Static values for the Prisma v3.0 realtime session. */
  stt: {
    url: process.env.GNANI_STT_URL ?? DEFAULT_STT_URL,
    apiKey: (process.env.GNANI_API_KEY ?? "").trim(),
    model: "prisma-v3.0",
    languageCode: "indic-auto",
    sampleRate: 16000,
    format: "transcribe",
    minSilenceMs: 500,
    vadThreshold: 0.6,
    /** Recycle silent sessions after 5 minutes instead of Gnani's 60 s default. */
    idleTimeoutSec: 300,
    /** Force a transcript for very long monologues so results keep flowing. */
    maxSpeechSec: 30,
  },

  /**
   * Local pyannote sidecar used only by the realtime microphone path.
   * Gnani Batch already returns `speaker_id` and is not affected by this.
   * See `python/diarizer_server.py`.
   */
  diarization: {
    enabled: (process.env.DIARIZATION_ENABLED ?? "true").toLowerCase() !== "false",
    url: process.env.DIARIZER_URL ?? "ws://127.0.0.1:8790",
    /** Fixed speaker count for the recording (2 for a clinician/patient call). */
    numSpeakers: intFromEnv("DIARIZER_NUM_SPEAKERS", 2),
  },

  /**
   * Google Gemini summary + translation used by the VoxNote dashboard.
   *
   * Shares the same key/base URL as the additive translation and report
   * features. This block backs `GET /api/ai/status` and
   * `POST /api/ai/analyze`; the key never leaves the server.
   */
  ai: {
    apiKey: (process.env.GEMINI_API_KEY ?? "").trim(),
    model: (process.env.GEMINI_MODEL ?? "gemini-3.5-flash").trim(),
    fallbackModels: (
      process.env.GEMINI_FALLBACK_MODELS ??
      "gemini-3.8-flash,gemini-3.5-flash"
    )
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean),
    baseUrl: (
      process.env.GEMINI_BASE_URL ??
      process.env.GEMINI_API_BASE_URL ??
      "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, ""),
    timeoutMs: intFromEnv("GEMINI_TIMEOUT_MS", 90_000),
  },

  /**
   * English translation of finished transcript segments.
   *
   * Gnani Prisma does not translate, so this uses Gemini on the server. The
   * key stays server-side; the browser only posts segment text to
   * `POST /api/translate`. Translation is optional: without a key the rest of
   * the app works exactly as before and the endpoint reports "not configured".
   */
  translation: {
    enabled: (process.env.TRANSLATION_ENABLED ?? "true").toLowerCase() !== "false",
    apiKey: (process.env.GEMINI_API_KEY ?? "").trim(),
    model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
    baseUrl: (
      process.env.GEMINI_API_BASE_URL ??
      "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, ""),
    targetLanguage: "English",
    timeoutMs: intFromEnv("TRANSLATION_TIMEOUT_MS", 20000),
    maxRetries: intFromEnv("TRANSLATION_MAX_RETRIES", 1),
    maxSegments: intFromEnv("TRANSLATION_MAX_SEGMENTS", 50),
    maxSegmentChars: intFromEnv("TRANSLATION_MAX_SEGMENT_CHARS", 4000),
    maxTotalChars: intFromEnv("TRANSLATION_MAX_TOTAL_CHARS", 24000),
  },

  /**
   * Structured consultation report.
   *
   * Derived from finished transcript text with Gemini. This is a documentation
   * aid, not a diagnostic system. The key stays server-side; the browser posts
   * validated segments to `POST /api/report`. Without a key the endpoint
   * reports "not configured" and transcription is unaffected.
   */
  report: {
    enabled: (process.env.REPORT_ENABLED ?? "true").toLowerCase() !== "false",
    apiKey: (process.env.GEMINI_API_KEY ?? "").trim(),
    model:
      process.env.REPORT_MODEL ??
      process.env.GEMINI_MODEL ??
      "gemini-3.5-flash",
    baseUrl: (
      process.env.GEMINI_API_BASE_URL ??
      "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, ""),
    timeoutMs: intFromEnv("REPORT_TIMEOUT_MS", 60000),
    maxRetries: intFromEnv("REPORT_MAX_RETRIES", 1),
    maxSegments: intFromEnv("REPORT_MAX_SEGMENTS", 400),
    maxSegmentChars: intFromEnv("REPORT_MAX_SEGMENT_CHARS", 8000),
    /** Hard cap before the request is rejected as too large. */
    maxInputChars: intFromEnv("REPORT_MAX_INPUT_CHARS", 200000),
    /** Transcripts above this size are processed in chunks. */
    chunkChars: intFromEnv("REPORT_CHUNK_CHARS", 60000),
    maxOutputTokens: intFromEnv("REPORT_MAX_OUTPUT_TOKENS", 8192),
  },

  /**
   * PharmaDesk Medicine Reference API.
   *
   * The published service needs no credential. The base URL stays server-side
   * so the browser only ever talks to this backend. The API is licensed for
   * reference use only; responses are displayed transiently and are not
   * persisted or redistributed.
   */
  medicine: {
    baseUrl: (process.env.PHARMADESK_BASE_URL ?? "https://pharmadesk.accron.in/api").replace(
      /\/+$/,
      "",
    ),
    timeoutMs: intFromEnv("PHARMADESK_TIMEOUT_MS", 8000),
    maxRetries: intFromEnv("PHARMADESK_MAX_RETRIES", 2),
    defaultLimit: intFromEnv("PHARMADESK_DEFAULT_LIMIT", 10),
  },

  limits: {
    /** Concurrent Gnani streams allowed per client IP. */
    sessionsPerIp: intFromEnv("MAX_SESSIONS_PER_IP", 2),
    maxFrameBytes: 1024,
    maxClientBufferedBytes: 1024 * 1024,
    maxUpstreamBufferedBytes: 256 * 1024,
  },
} as const;

export function assertConfig(): void {
  if (config.stt.apiKey) return;

  console.error(
    [
      "",
      "  GNANI_API_KEY is missing.",
      "",
      "  Add it to the .env file in the project root:",
      "    GNANI_API_KEY=your-gnani-api-key",
      "",
      "  The server will not start without it.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
