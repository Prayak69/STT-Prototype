import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import express from "express";
import type { Response } from "express";
import multer from "multer";
import { assertConfig, config } from "./config";
import {
  buildBatchJobForm,
  cancelBatchJob,
  createBatchJob,
  downloadBatchTranscript,
  getBatchJobFiles,
  getBatchJobStatus,
  normalizeAudioFilename,
  startBatchJob,
} from "./gnaniBatch";
import { attachSttProxy } from "./gnaniWebSocket";
import {
  GeminiError,
  analyzeConsultation,
  geminiStatus,
  type AiSegmentInput,
} from "./gemini";
import { logger } from "./logger";

assertConfig();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const TARGET_LANGUAGES = new Set(["en", "hi", "hinglish"]);
const MAX_AI_SEGMENTS = 300;
const MAX_AI_TRANSCRIPT_CHARS = 80_000;

function parseAiSegments(value: unknown): AiSegmentInput[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_AI_SEGMENTS) {
    return null;
  }

  const segments: AiSegmentInput[] = [];
  let totalChars = 0;

  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const index = typeof record.index === "number" ? record.index : Number(record.index);
    const timestamp = typeof record.timestamp === "string" ? record.timestamp.trim() : "";
    const text = typeof record.text === "string" ? record.text.trim() : "";

    if (!Number.isInteger(index) || index < 0) return null;
    if (!timestamp || timestamp.length > 24) return null;
    if (!text || text.length > 6000) return null;

    totalChars += text.length;
    if (totalChars > MAX_AI_TRANSCRIPT_CHARS) return null;

    segments.push({ index, timestamp, text });
  }

  return segments;
}

function sendAiError(res: Response, error: unknown): void {
  if (error instanceof GeminiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error("Unexpected AI route failure", {
    error: error instanceof Error ? error.message : String(error),
  });
  res.status(500).json({ error: "Unexpected server error while generating AI output." });
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    model: config.stt.model,
    language: config.stt.languageCode,
    sampleRate: config.stt.sampleRate,
    configured: Boolean(config.stt.apiKey),
  });
});

/**
 * Post-processing endpoints. The Gemini key stays on the server and is never
 * exposed to the browser.
 */
app.get("/api/ai/status", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(geminiStatus());
});

app.post("/api/ai/analyze", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const segments = parseAiSegments(body.segments);
  const targetLanguage =
    typeof body.targetLanguage === "string" ? body.targetLanguage.trim() : "";
  const language = typeof body.language === "string" ? body.language.trim() : "Unknown";
  const fileName =
    typeof body.fileName === "string" && body.fileName.trim()
      ? body.fileName.trim().slice(0, 200)
      : "Consultation";

  if (!segments) {
    res.status(400).json({
      error: "Send between 1 and 300 valid transcript segments (timestamp, text).",
    });
    return;
  }
  if (!TARGET_LANGUAGES.has(targetLanguage)) {
    res.status(400).json({ error: "targetLanguage must be one of: en, hi, hinglish." });
    return;
  }

  try {
    const result = await analyzeConsultation(segments, targetLanguage, language, fileName);
    res.setHeader("Cache-Control", "no-store");
    res.json(result);
  } catch (error) {
    sendAiError(res, error);
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // Gnani direct-upload limit: 10 MB
});

/**
 * Gnani Batch STT proxy for plain transcription (no speaker labels).
 *
 * POST   /api/stt/batch                    — upload file + create batch job
 * POST   /api/stt/batch/:id/start          — start the job
 * GET    /api/stt/batch/:id                — poll job status
 * GET    /api/stt/batch/:id/files          — get completed file transcript URLs
 * GET    /api/stt/batch/download           — download a transcript URL (proxy)
 *
 * The GNANI_API_KEY is attached server-side; the browser never sees it.
 */
app.post("/api/stt/batch", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No audio file provided." });
    return;
  }

  try {
    const form = buildBatchJobForm(
      {
        buffer: file.buffer,
        name: normalizeAudioFilename(file.originalname, new Uint8Array(file.buffer)),
        type: file.mimetype,
      },
      { languageCode: "indic-auto" },
    );
    const job = await createBatchJob(form);
    res.status(201).json(job);
  } catch (error) {
    const err = error as Error & { cause?: Error };
    logger.error("Gnani batch create failed", {
      error: err.message,
      cause: err.cause?.message,
    });
    const isNetwork = err.message === "fetch failed";
    res.status(isNetwork ? 504 : 502).json({
      error: isNetwork
        ? "Could not reach the transcription service. Check internet connectivity and try again."
        : err.message,
    });
  }
});

app.post(
  "/api/stt/batch/:jobId/start",
  async (req, res) => {
    try {
      const job = await startBatchJob(req.params.jobId);
      res.json(job);
    } catch (error) {
      logger.error("Gnani batch start failed", {
        jobId: req.params.jobId,
        error: (error as Error).message,
      });
      res.status(502).json({ error: (error as Error).message });
    }
  },
);

// NOTE: must be registered before the "/:jobId" routes or Express will match
// "download" as a jobId.
app.get("/api/stt/batch/download", async (req, res) => {
  const url = req.query.url;
  if (typeof url !== "string") {
    res.status(400).json({ error: "Missing url query parameter." });
    return;
  }
  try {
    const transcript = await downloadBatchTranscript(url);
    res.json(transcript);
  } catch (error) {
    logger.error("Gnani batch download failed", {
      url,
      error: (error as Error).message,
    });
    res.status(502).json({ error: (error as Error).message });
  }
});

app.get("/api/stt/batch/:jobId", async (req, res) => {
  try {
    const status = await getBatchJobStatus(req.params.jobId);
    res.json(status);
  } catch (error) {
    logger.error("Gnani batch status failed", {
      jobId: req.params.jobId,
      error: (error as Error).message,
    });
    res.status(502).json({ error: (error as Error).message });
  }
});

app.get("/api/stt/batch/:jobId/files", async (req, res) => {
  try {
    const files = await getBatchJobFiles(req.params.jobId);
    res.json({ data: files });
  } catch (error) {
    logger.error("Gnani batch files failed", {
      jobId: req.params.jobId,
      error: (error as Error).message,
    });
    res.status(502).json({ error: (error as Error).message });
  }
});

app.post("/api/stt/batch/:jobId/cancel", async (req, res) => {
  try {
    const job = await cancelBatchJob(req.params.jobId);
    res.json(job);
  } catch (error) {
    logger.error("Gnani batch cancel failed", {
      jobId: req.params.jobId,
      error: (error as Error).message,
    });
    res.status(502).json({ error: (error as Error).message });
  }
});

const distDir = path.resolve(process.cwd(), "dist");
const indexFile = path.join(distDir, "index.html");

if (existsSync(indexFile)) {
  app.use(
    "/assets",
    express.static(path.join(distDir, "assets"), {
      immutable: true,
      maxAge: "1y",
      fallthrough: true,
    }),
  );
  app.use(express.static(distDir, { index: false }));

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api") || req.path.startsWith("/ws")) return next();
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(indexFile);
  });
} else {
  app.get("/", (_req, res) => {
    res.status(200).type("text/plain").send(
      [
        "Voice-to-Text API is running.",
        "",
        "The frontend has not been built yet. Either:",
        "  • run `npm run dev` (frontend on http://localhost:5173), or",
        "  • run `npm run build` then `npm start` (frontend on http://localhost:8787).",
      ].join("\n"),
    );
  });
}

const server = createServer(app);
const proxy = attachSttProxy(server);

server.listen(config.port, config.host, () => {
  logger.info(`Voice-to-Text server listening on http://localhost:${config.port}`);
  logger.info(`Gnani realtime STT: ${config.stt.url}`, {
    model: config.stt.model,
    language: config.stt.languageCode,
  });
});

function shutdown(signal: string): void {
  logger.info(`Received ${signal}; shutting down.`);
  proxy.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
