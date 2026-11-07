import { config } from "./config";
import { logger } from "./logger";

/**
 * English translation for finished transcript segments.
 *
 * Gnani Prisma only transcribes, so translation is a separate, additive step.
 * The raw transcript is never modified: the browser keeps it and displays the
 * translated text alongside it. This module is server-only so the Gemini key
 * never reaches the client.
 */

export interface TranslationSegmentInput {
  id: string;
  text: string;
  /** Optional source-language hint from Gnani (e.g. "Hindi", "Tamil"). */
  language?: string | null;
}

export interface TranslationResult {
  id: string;
  text: string;
}

export type TranslationErrorCode =
  | "invalid_request"
  | "not_configured"
  | "disabled"
  | "rate_limited"
  | "timeout"
  | "upstream_error"
  | "invalid_response";

export class TranslationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationInputError";
  }
}

export class TranslationError extends Error {
  readonly code: TranslationErrorCode;
  readonly status?: number;

  constructor(code: TranslationErrorCode, message: string, status?: number) {
    super(message);
    this.name = "TranslationError";
    this.code = code;
    this.status = status;
  }
}

export interface TranslationServiceResult {
  targetLanguage: string;
  model: string;
  translations: TranslationResult[];
}

export function translationConfigured(): boolean {
  return config.translation.enabled && Boolean(config.translation.apiKey);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates the API request body. Returns only the fields the translator
 * needs, with trimmed text and unique ids.
 */
export function validateTranslationRequest(body: unknown): TranslationSegmentInput[] {
  if (!isRecord(body)) {
    throw new TranslationInputError("Request body must be a JSON object.");
  }

  if (body.targetLanguage !== undefined) {
    if (
      typeof body.targetLanguage !== "string" ||
      body.targetLanguage.trim().toLowerCase() !== "english"
    ) {
      throw new TranslationInputError("Only English translation is supported.");
    }
  }

  if (!Array.isArray(body.segments)) {
    throw new TranslationInputError("`segments` must be an array.");
  }

  const { maxSegments, maxSegmentChars, maxTotalChars } = config.translation;
  if (body.segments.length === 0) {
    throw new TranslationInputError("`segments` must contain at least one segment.");
  }
  if (body.segments.length > maxSegments) {
    throw new TranslationInputError(
      `Too many segments in one request (maximum ${maxSegments}).`,
    );
  }

  const seen = new Set<string>();
  let totalChars = 0;

  const segments = body.segments.map((value, index) => {
    if (!isRecord(value)) {
      throw new TranslationInputError(`segments[${index}] must be an object.`);
    }

    if (typeof value.id !== "string" || value.id.trim().length === 0) {
      throw new TranslationInputError(`segments[${index}].id must be a non-empty string.`);
    }
    const id = value.id.trim();
    if (id.length > 200) {
      throw new TranslationInputError(`segments[${index}].id is too long.`);
    }
    if (seen.has(id)) {
      throw new TranslationInputError(`segments[${index}].id is duplicated.`);
    }
    seen.add(id);

    if (typeof value.text !== "string" || value.text.trim().length === 0) {
      throw new TranslationInputError(
        `segments[${index}].text must be a non-empty string.`,
      );
    }
    const text = value.text.trim();
    if (text.length > maxSegmentChars) {
      throw new TranslationInputError(
        `segments[${index}].text is too long (maximum ${maxSegmentChars} characters).`,
      );
    }
    totalChars += text.length;

    let language: string | null = null;
    if (value.language !== undefined && value.language !== null) {
      if (typeof value.language !== "string") {
        throw new TranslationInputError(
          `segments[${index}].language must be a string when provided.`,
        );
      }
      language = value.language.trim().slice(0, 60) || null;
    }

    return { id, text, language };
  });

  if (totalChars > maxTotalChars) {
    throw new TranslationInputError(
      `Transcript text is too large in one request (maximum ${maxTotalChars} characters).`,
    );
  }

  return segments;
}

const SYSTEM_PROMPT = [
  "You are a professional medical interpreter.",
  "Translate each transcript segment into natural, accurate English.",
  "",
  "Rules:",
  "1. Translate every segment into English. The input may mix Indic languages and English.",
  "2. If a segment is already entirely English, return it unchanged.",
  "3. Preserve clinical meaning, medicine names, dosages, numbers, dates, names and speaker intent.",
  "4. Keep exactly one output object per input segment, with the same id. Never merge, split, reorder or add segments.",
  "5. Do not add commentary, summaries or explanations.",
  "6. Return only JSON that matches the provided schema.",
].join("\n");

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    translations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          text: { type: "STRING" },
        },
        required: ["id", "text"],
      },
    },
  },
  required: ["translations"],
} as const;

function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new TranslationError(
      "invalid_response",
      "The translation service returned an unreadable response.",
    );
  }
}

function parseTranslations(
  body: unknown,
  expected: TranslationSegmentInput[],
): TranslationResult[] {
  const text = (() => {
    if (!isRecord(body)) return null;
    const candidates = body.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const content = isRecord(candidates[0]) ? candidates[0].content : null;
    if (!isRecord(content) || !Array.isArray(content.parts)) return null;
    return content.parts
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .join("");
  })();

  if (!text) {
    throw new TranslationError(
      "invalid_response",
      "The translation service returned an empty response.",
    );
  }

  const parsed = extractJson(text);
  if (!isRecord(parsed) || !Array.isArray(parsed.translations)) {
    throw new TranslationError(
      "invalid_response",
      "The translation service returned an unexpected response.",
    );
  }

  const byId = new Map<string, string>();
  for (const item of parsed.translations) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.text !== "string") {
      continue;
    }
    const translated = item.text.trim();
    if (!translated) continue;
    byId.set(item.id, translated);
  }

  const translations: TranslationResult[] = [];
  for (const segment of expected) {
    const translated = byId.get(segment.id);
    if (!translated) {
      throw new TranslationError(
        "invalid_response",
        "The translation service did not return every segment.",
      );
    }
    translations.push({ id: segment.id, text: translated });
  }

  return translations;
}

function upstreamMessage(status: number, body: unknown): string {
  if (isRecord(body)) {
    const error = body.error;
    if (isRecord(error) && typeof error.message === "string") return error.message;
  }
  return `Translation service returned HTTP ${status}.`;
}

async function requestGemini(
  segments: TranslationSegmentInput[],
): Promise<TranslationResult[]> {
  const { apiKey, model, baseUrl, timeoutMs } = config.translation;
  if (!translationConfigured()) {
    throw new TranslationError(
      "not_configured",
      "Translation is not configured on the server.",
    );
  }

  const payload = segments.map((segment) => ({
    id: segment.id,
    ...(segment.language ? { language: segment.language } : {}),
    text: segment.text,
  }));

  const requestBody = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [{ text: JSON.stringify({ segments: payload }) }],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 8192,
    },
  };

  let lastError: TranslationError | null = null;
  const attempts = Math.max(0, config.translation.maxRetries) + 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(
        `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
    } catch (error) {
      const aborted = (error as Error).name === "AbortError" ||
        (error as Error).name === "TimeoutError";
      lastError = new TranslationError(
        aborted ? "timeout" : "upstream_error",
        aborted
          ? "The translation service took too long to respond."
          : "Could not reach the translation service.",
      );
      if (aborted) throw lastError;
      continue;
    }

    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      if (response.status === 429) {
        throw new TranslationError(
          "rate_limited",
          "The translation service is rate limited. Try again shortly.",
          429,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new TranslationError(
          "not_configured",
          "The translation service rejected the server credentials.",
          503,
        );
      }
      lastError = new TranslationError(
        "upstream_error",
        upstreamMessage(response.status, body),
        response.status,
      );
      if (response.status < 500) throw lastError;
      continue;
    }

    try {
      return parseTranslations(body, segments);
    } catch (error) {
      lastError =
        error instanceof TranslationError
          ? error
          : new TranslationError(
              "invalid_response",
              "The translation service returned an unexpected response.",
            );
      const blocked = isRecord(body) &&
        Array.isArray(body.candidates) &&
        body.candidates.length === 0;
      if (blocked) throw lastError;
    }
  }

  throw lastError ?? new TranslationError("upstream_error", "Translation failed.");
}

/** Translates validated transcript segments into English. */
export async function translateSegments(
  body: unknown,
): Promise<TranslationServiceResult> {
  if (!config.translation.enabled) {
    throw new TranslationError("disabled", "Translation is disabled on the server.", 503);
  }

  const segments = validateTranslationRequest(body);

  if (!translationConfigured()) {
    throw new TranslationError(
      "not_configured",
      "Translation is not configured on the server.",
      503,
    );
  }

  try {
    const translations = await requestGemini(segments);
    return {
      targetLanguage: config.translation.targetLanguage,
      model: config.translation.model,
      translations,
    };
  } catch (error) {
    const translationError =
      error instanceof TranslationError
        ? error
        : new TranslationError("upstream_error", "Translation failed.");
    logger.warn("Translation failed", {
      code: translationError.code,
      status: translationError.status,
      segments: segments.length,
      message: translationError.message,
    });
    throw translationError;
  }
}
