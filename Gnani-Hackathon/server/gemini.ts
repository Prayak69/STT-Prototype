import { config } from "./config";
import { logger } from "./logger";

export interface AiSegmentInput {
  index: number;
  timestamp: string;
  text: string;
}

export interface ConsultationSummary {
  headline: string;
  chiefComplaint: string;
  symptoms: string[];
  history: string;
  medications: string[];
  assessment: string;
  plan: string[];
  followUp: string;
  redFlags: string[];
}

export interface InsightsResult {
  summary: ConsultationSummary;
  translation: {
    segments: Array<{ index: number; text: string }>;
    targetLanguage: string;
  };
  model: string;
  generatedAt: string;
}

type GeminiPart = { text?: string; thought?: boolean };
type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  error?: { message?: string; status?: string };
};

export class GeminiError extends Error {
  status: number;
  retryable: boolean;

  constructor(message: string, status = 502, retryable = status === 429 || status >= 500) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
    this.retryable = retryable;
  }
}

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    chiefComplaint: { type: "string" },
    symptoms: { type: "array", items: { type: "string" } },
    history: { type: "string" },
    medications: { type: "array", items: { type: "string" } },
    assessment: { type: "string" },
    plan: { type: "array", items: { type: "string" } },
    followUp: { type: "string" },
    redFlags: { type: "array", items: { type: "string" } },
  },
  required: [
    "headline",
    "chiefComplaint",
    "symptoms",
    "history",
    "medications",
    "assessment",
    "plan",
    "followUp",
    "redFlags",
  ],
} as const;

const TRANSLATION_SCHEMA = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          text: { type: "string" },
        },
        required: ["index", "text"],
      },
    },
  },
  required: ["segments"],
} as const;

const INSIGHTS_SCHEMA = {
  type: "object",
  properties: {
    summary: SUMMARY_SCHEMA,
    translation: TRANSLATION_SCHEMA,
  },
  required: ["summary", "translation"],
} as const;

export function geminiStatus(): { configured: boolean; provider: string; model: string } {
  return {
    configured: Boolean(config.ai.apiKey),
    provider: "Google Gemini",
    model: config.ai.model,
  };
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim());
    }
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("The AI response was not valid JSON.");
  }
}

async function requestModel(
  model: string,
  prompt: string,
  schema: unknown,
  maxOutputTokens: number,
): Promise<{ data: unknown; model: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ai.timeoutMs);

  try {
    const response = await fetch(
      `${config.ai.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.ai.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens,
            responseMimeType: "application/json",
            responseSchema: schema,
          },
        }),
      },
    );

    const bodyText = await response.text();
    if (!response.ok) {
      let detail = "";
      try {
        const parsed = JSON.parse(bodyText) as GeminiResponse;
        detail = parsed.error?.message ?? "";
      } catch {
        // ignore malformed error bodies
      }

      if (response.status === 400) {
        throw new GeminiError(
          detail || "Gemini rejected the request. Check the configured model and inputs.",
          400,
          false,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new GeminiError(
          "The Gemini API key is invalid or does not have access to the configured model.",
          502,
          false,
        );
      }
      if (response.status === 429) {
        throw new GeminiError(
          "Gemini is rate limiting requests right now. Wait a moment and try again.",
          429,
        );
      }
      throw new GeminiError(
        detail || `Gemini returned an error (${response.status}).`,
        502,
      );
    }

    const data = JSON.parse(bodyText) as GeminiResponse;
    const text =
      data.candidates?.[0]?.content?.parts
        ?.filter((part) => !part.thought && typeof part.text === "string")
        .map((part) => part.text)
        .join("") ?? "";

    if (!text.trim()) {
      const reason = data.candidates?.[0]?.finishReason;
      throw new GeminiError(
        reason === "SAFETY"
          ? "Gemini blocked this response for safety reasons. Review the transcript and try again."
          : "Gemini returned an empty response. Please try again.",
        502,
        reason !== "SAFETY",
      );
    }

    return { data: extractJson(text), model };
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GeminiError("Gemini took too long to respond. Please try again.", 504);
    }
    logger.error("Gemini request failed", {
      error: error instanceof Error ? error.message : String(error),
      model,
    });
    throw new GeminiError("Could not reach Gemini. Check the server connection and try again.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(
  prompt: string,
  schema: unknown,
  maxOutputTokens: number,
): Promise<{ data: unknown; model: string }> {
  if (!config.ai.apiKey) {
    throw new GeminiError(
      "Gemini is not configured. Add GEMINI_API_KEY to the server .env file.",
      503,
      false,
    );
  }

  const models = Array.from(new Set([config.ai.model, ...config.ai.fallbackModels]));
  let lastError: GeminiError | null = null;

  for (const [index, model] of models.entries()) {
    try {
      return await requestModel(model, prompt, schema, maxOutputTokens);
    } catch (error) {
      if (!(error instanceof GeminiError)) throw error;
      lastError = error;

      const hasFallback = index < models.length - 1;
      if (!error.retryable || !hasFallback) throw error;

      logger.warn("Gemini model unavailable, trying a fallback", {
        model,
        status: error.status,
        error: error.message,
      });
    }
  }

  throw lastError ?? new GeminiError("Gemini is unavailable. Please try again.", 502);
}

function promptTranscript(segments: AiSegmentInput[]): string {
  return segments
    .map(
      (segment) =>
        `[#${segment.index}] (${segment.timestamp}): ${segment.text}`,
    )
    .join("\n");
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function textValue(value: unknown, fallback = "Not stated"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeSummary(value: unknown): ConsultationSummary {
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    headline: textValue(record.headline, "Consultation summary"),
    chiefComplaint: textValue(record.chiefComplaint),
    symptoms: textArray(record.symptoms),
    history: textValue(record.history),
    medications: textArray(record.medications),
    assessment: textValue(record.assessment),
    plan: textArray(record.plan),
    followUp: textValue(record.followUp),
    redFlags: textArray(record.redFlags),
  };
}

function translationInstruction(targetLanguage: string): string {
  switch (targetLanguage) {
    case "hi":
      return "Translate into natural conversational Hindi using Devanagari script. Keep medicine names, numbers, and units unchanged.";
    case "hinglish":
      return "Translate into natural Hinglish: romanized Hindi mixed with everyday English medical terms, written in Latin script. Keep medicine names and numbers unchanged.";
    default:
      return "Translate into clear, natural English. Keep medicine names, numbers, and units unchanged.";
  }
}

function normalizeTranslatedSegments(
  value: unknown,
  segments: AiSegmentInput[],
): Array<{ index: number; text: string }> {
  const record = (value ?? {}) as { segments?: unknown };
  const rawSegments = Array.isArray(record.segments) ? record.segments : [];
  const validIndexes = new Set(segments.map((segment) => segment.index));
  const translated = new Map<number, string>();

  for (const item of rawSegments) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { index?: unknown; text?: unknown };
    const index = typeof entry.index === "number" ? entry.index : Number(entry.index);
    if (!Number.isInteger(index) || !validIndexes.has(index)) continue;
    if (typeof entry.text !== "string" || !entry.text.trim()) continue;
    translated.set(index, entry.text.trim());
  }

  return segments.map((segment) => ({
    index: segment.index,
    text: translated.get(segment.index) ?? segment.text,
  }));
}

/**
 * Generates the clinical summary and the segment translation in a single
 * Gemini request. Both outputs share the same transcript, so one call is
 * enough; the UI still presents them as separate views.
 */
export async function analyzeConsultation(
  segments: AiSegmentInput[],
  targetLanguage: string,
  language: string,
  fileName: string,
): Promise<InsightsResult> {
  const prompt = `You are a careful clinical documentation assistant and a professional medical translator working on a doctor–patient consultation. Produce both outputs below from the same transcript, in one response.

1) CLINICAL SUMMARY
- Use only information that is present in the transcript. Never invent diagnoses, medicines, doses, tests, or findings.
- If a field is not mentioned, write "Not stated" (or an empty list, where allowed).
- Keep the summary in English even when the transcript is in Hindi, Hinglish, or another language.
- Be neutral and professional. This is a draft for clinician review, not a final diagnosis.
- Keep the headline under 90 characters.
- Keep each list item short (one line where possible).

2) SEGMENT TRANSLATION
${translationInstruction(targetLanguage)}
- Translate every numbered segment exactly once.
- Preserve the meaning, tone, and clinical details. Do not add advice or commentary.
- Do not merge, split, reorder, or omit segments.
- If a segment is already in the target language, return it unchanged.
- Return only the translated text for each segment — no timestamp.

Return one JSON object with exactly two keys: "summary" and "translation".
- "summary" must match the requested summary schema.
- "translation" must contain a "segments" array. Every item must contain the original "index" and the translated "text".

File: ${fileName}
Detected language: ${language}

Transcript:
${promptTranscript(segments)}`;

  const { data, model } = await callGemini(prompt, INSIGHTS_SCHEMA, 16384);
  const record = (data ?? {}) as { summary?: unknown; translation?: unknown };

  return {
    summary: normalizeSummary(record.summary),
    translation: {
      segments: normalizeTranslatedSegments(record.translation, segments),
      targetLanguage,
    },
    model,
    generatedAt: new Date().toISOString(),
  };
}
