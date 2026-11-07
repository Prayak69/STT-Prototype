import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import express from "express";
import type { Response } from "express";
import multer from "multer";
import { assertConfig, config } from "./config";
import {
  buildDiarizeJobForm,
  cancelDiarizeJob,
  createDiarizeJob,
  downloadDiarizeTranscript,
  getDiarizeJobFiles,
  getDiarizeJobStatus,
  normalizeAudioFilename,
  startDiarizeJob,
} from "./gnaniBatch";
import { attachSttProxy } from "./gnaniWebSocket";
import {
  GeminiError,
  analyzeConsultation,
  geminiStatus,
  type AiSegmentInput,
} from "./gemini";
import { logger } from "./logger";
import {
  MedicineSearchInputError,
  searchMedicineMatches,
} from "./medicineMatcher";
import { PharmaDeskError } from "./pharmaDesk";
import {
  TranslationError,
  TranslationInputError,
  translateSegments,
  translationConfigured,
} from "./translation";
import {
  generateConsultationReport,
  reportConfigured,
  ReportError,
  ReportInputError,
} from "./consultationReport";

assertConfig();

const app = express();
app.disable("x-powered-by");

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    model: config.stt.model,
    language: config.stt.languageCode,
    sampleRate: config.stt.sampleRate,
    configured: Boolean(config.stt.apiKey),
    translation: {
      configured: translationConfigured(),
      model: config.translation.model,
      targetLanguage: config.translation.targetLanguage,
    },
    report: {
      configured: reportConfigured(),
      model: config.report.model,
    },
    ai: geminiStatus(),
  });
});

/**
 * VoxNote AI summary + translation endpoints.
 *
 * The Gemini key stays on the server. `POST /api/ai/analyze` returns a
 * consultation summary and segment translations in one call.
 */
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
    const index =
      typeof record.index === "number" ? record.index : Number(record.index);
    const speaker = typeof record.speaker === "string" ? record.speaker.trim() : "";
    const timestamp =
      typeof record.timestamp === "string" ? record.timestamp.trim() : "";
    const text = typeof record.text === "string" ? record.text.trim() : "";

    if (!Number.isInteger(index) || index < 0) return null;
    if (!speaker || speaker.length > 80) return null;
    if (!timestamp || timestamp.length > 24) return null;
    if (!text || text.length > 6000) return null;

    totalChars += text.length;
    if (totalChars > MAX_AI_TRANSCRIPT_CHARS) return null;

    segments.push({ index, speaker, timestamp, text });
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
  res.status(500).json({
    error: "Unexpected server error while generating AI output.",
  });
}

app.get("/api/ai/status", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(geminiStatus());
});

const aiJson = express.json({ limit: "1mb" });

app.post(
  "/api/ai/analyze",
  (req, res, next) => {
    aiJson(req, res, (error) => {
      if (error) {
        res.status(400).json({ error: "Request body must be valid JSON." });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const segments = parseAiSegments(body.segments);
    const targetLanguage =
      typeof body.targetLanguage === "string" ? body.targetLanguage.trim() : "";
    const language =
      typeof body.language === "string" ? body.language.trim() : "Unknown";
    const fileName =
      typeof body.fileName === "string" && body.fileName.trim()
        ? body.fileName.trim().slice(0, 200)
        : "Consultation";

    if (!segments) {
      res.status(400).json({
        error:
          "Send between 1 and 300 valid transcript segments (speaker, timestamp, text).",
      });
      return;
    }
    if (!TARGET_LANGUAGES.has(targetLanguage)) {
      res
        .status(400)
        .json({ error: "targetLanguage must be one of: en, hi, hinglish." });
      return;
    }

    try {
      const result = await analyzeConsultation(
        segments,
        targetLanguage,
        language,
        fileName,
      );
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (error) {
      sendAiError(res, error);
    }
  },
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // Gnani direct-upload limit: 10 MB
});

/**
 * Medicine reference search.
 *
 * POST /api/medicines/search
 *   Body: { query: string, market?: "IN"|"US"|"GB"|"EU"|"CA"|"AU", limit?: 1..50 }
 *
 * This is an additive reference feature. It never changes transcripts and is
 * intentionally separate from STT, WebSocket, audio and diarization code so
 * the results can later feed SOAP-note generation. PharmaDesk needs no API
 * key; the browser only talks to this server.
 */
const medicineJson = express.json({ limit: "8kb" });

app.post(
  "/api/medicines/search",
  (req, res, next) => {
    medicineJson(req, res, (error) => {
      if (error) {
        res.status(400).json({
          ok: false,
          code: "invalid_json",
          error: "Request body must be valid JSON.",
        });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const result = await searchMedicineMatches(req.body);
      res.json(result);
    } catch (error) {
      if (error instanceof MedicineSearchInputError) {
        res.status(400).json({
          ok: false,
          code: "invalid_request",
          error: error.message,
        });
        return;
      }

      if (error instanceof PharmaDeskError) {
        if (error.retryAfterSeconds !== undefined) {
          res.setHeader(
            "Retry-After",
            String(Math.max(0, Math.ceil(error.retryAfterSeconds))),
          );
        }
        const status =
          error.code === "invalid_request" || error.code === "bad_request"
            ? 400
            : error.code === "not_found"
              ? 404
              : error.code === "rate_limited"
                ? 429
                : error.code === "timeout"
                  ? 504
                  : 502;
        logger.warn("Medicine search upstream error", {
          code: error.code,
          status: error.status,
          message: error.message,
        });
        res.status(status).json({
          ok: false,
          code: error.code,
          error: error.message,
        });
        return;
      }

      logger.error("Medicine search failed", {
        error: (error as Error).message,
      });
      res.status(500).json({
        ok: false,
        code: "internal_error",
        error: "Medicine search failed.",
      });
    }
  },
);

/**
 * English translation for transcript segments.
 *
 * POST /api/translate
 *   Body: { segments: [{ id, text, language? }], targetLanguage?: "English" }
 *
 * Additive and independent of STT: the browser keeps the raw transcript and
 * displays the returned English text alongside it. The Gemini key stays here.
 */
const translationJson = express.json({ limit: "128kb" });

app.post(
  "/api/translate",
  (req, res, next) => {
    translationJson(req, res, (error) => {
      if (error) {
        res.status(400).json({
          ok: false,
          code: "invalid_json",
          error: "Request body must be valid JSON.",
        });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const result = await translateSegments(req.body);
      res.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof TranslationInputError) {
        res.status(400).json({
          ok: false,
          code: "invalid_request",
          error: error.message,
        });
        return;
      }

      if (error instanceof TranslationError) {
        const status =
          error.code === "not_configured" || error.code === "disabled"
            ? 503
            : error.code === "rate_limited"
              ? 429
              : error.code === "timeout"
                ? 504
                : 502;
        res.status(status).json({
          ok: false,
          code: error.code,
          error: error.message,
        });
        return;
      }

      logger.error("Translation failed", {
        error: (error as Error).message,
      });
      res.status(500).json({
        ok: false,
        code: "internal_error",
        error: "Translation failed.",
      });
    }
  },
);

/**
 * Structured consultation report.
 *
 * POST /api/report
 *   Body: { mode?: "live"|"batch", segments: [{ id, text, speaker?, role?,
 *           startTime?, endTime?, language? }] }
 *
 * Derived from finished transcript text; the raw transcript is never changed.
 * The Gemini key stays on the server.
 */
const reportJson = express.json({ limit: "1mb" });

app.post(
  "/api/report",
  (req, res, next) => {
    reportJson(req, res, (error) => {
      if (error) {
        res.status(400).json({
          ok: false,
          code: "invalid_json",
          error: "Request body must be valid JSON.",
        });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const result = await generateConsultationReport(req.body);
      res.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof ReportInputError) {
        res.status(error.status).json({
          ok: false,
          code: error.status === 413 ? "too_large" : "invalid_request",
          error: error.message,
        });
        return;
      }

      if (error instanceof ReportError) {
        const status =
          error.code === "not_configured" || error.code === "disabled"
            ? 503
            : error.code === "rate_limited"
              ? 429
              : error.code === "timeout"
                ? 504
                : error.code === "too_large"
                  ? 413
                  : 502;
        res.status(status).json({
          ok: false,
          code: error.code,
          error: error.message,
        });
        return;
      }

      logger.error("Report generation failed", {
        error: (error as Error).message,
      });
      res.status(500).json({
        ok: false,
        code: "internal_error",
        error: "Report generation failed.",
      });
    }
  },
);

/**
 * Gnani Batch STT proxy for speaker diarization.
 *
 * POST   /api/stt/batch/diarize        — upload file + create diarization job
 * POST   /api/stt/batch/diarize/:id/start — start the job
 * GET    /api/stt/batch/diarize/:id    — poll job status
 * GET    /api/stt/batch/diarize/:id/files — get completed file transcript URLs
 * GET    /api/stt/batch/diarize/download — download a transcript URL (proxy)
 *
 * The GNANI_API_KEY is attached server-side; the browser never sees it.
 */
app.post("/api/stt/batch/diarize", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No audio file provided." });
    return;
  }

  try {
    const form = buildDiarizeJobForm(
      {
        buffer: file.buffer,
        name: normalizeAudioFilename(file.originalname, new Uint8Array(file.buffer)),
        type: file.mimetype,
      },
      { languageCode: "indic-auto", numSpeakers: 5 },
    );
    const job = await createDiarizeJob(form);
    res.status(201).json(job);
  } catch (error) {
    const err = error as Error & { cause?: Error };
    logger.error("Gnani batch diarize create failed", {
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
  "/api/stt/batch/diarize/:jobId/start",
  async (req, res) => {
    try {
      const job = await startDiarizeJob(req.params.jobId);
      res.json(job);
    } catch (error) {
      logger.error("Gnani batch diarize start failed", {
        jobId: req.params.jobId,
        error: (error as Error).message,
      });
      res.status(502).json({ error: (error as Error).message });
    }
  },
);

// NOTE: must be registered before the "/:jobId" routes or Express will match
// "download" as a jobId.
app.get("/api/stt/batch/diarize/download", async (req, res) => {
  const url = req.query.url;
  if (typeof url !== "string") {
    res.status(400).json({ error: "Missing url query parameter." });
    return;
  }
  try {
    const transcript = await downloadDiarizeTranscript(url);
    res.json(transcript);
  } catch (error) {
    logger.error("Gnani batch diarize download failed", {
      url,
      error: (error as Error).message,
    });
    res.status(502).json({ error: (error as Error).message });
  }
});

app.get("/api/stt/batch/diarize/:jobId", async (req, res) => {
  try {
    const status = await getDiarizeJobStatus(req.params.jobId);
    res.json(status);
  } catch (error) {
    logger.error("Gnani batch diarize status failed", {
      jobId: req.params.jobId,
      error: (error as Error).message,
    });
    res.status(502).json({ error: (error as Error).message });
  }
});

app.get("/api/stt/batch/diarize/:jobId/files", async (req, res) => {
  try {
    const files = await getDiarizeJobFiles(req.params.jobId);
    res.json({ data: files });
  } catch (error) {
    logger.error("Gnani batch diarize files failed", {
      jobId: req.params.jobId,
      error: (error as Error).message,
    });
    res.status(502).json({ error: (error as Error).message });
  }
});

app.post("/api/stt/batch/diarize/:jobId/cancel", async (req, res) => {
  try {
    const job = await cancelDiarizeJob(req.params.jobId);
    res.json(job);
  } catch (error) {
    logger.error("Gnani batch diarize cancel failed", {
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
