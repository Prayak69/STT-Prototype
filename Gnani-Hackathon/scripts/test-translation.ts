import assert from "node:assert/strict";

// Configure the translation module before importing it.
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.GEMINI_MODEL = "test-gemini-model";
process.env.TRANSLATION_MAX_RETRIES = "0";
process.env.TRANSLATION_MAX_SEGMENTS = "2";
process.env.TRANSLATION_MAX_SEGMENT_CHARS = "40";
process.env.TRANSLATION_MAX_TOTAL_CHARS = "60";

const {
  TranslationError,
  TranslationInputError,
  translateSegments,
  translationConfigured,
  validateTranslationRequest,
} = await import("../backend/translation.ts");

let passed = 0;

async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL  ${name}`);
    throw error;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function geminiBody(translations: Array<{ id: string; text: string }>): unknown {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify({ translations }) }],
        },
      },
    ],
  };
}

const originalFetch = globalThis.fetch;

console.log("Translation validation");

await check("accepts a valid request and trims text", () => {
  const result = validateTranslationRequest({
    segments: [
      { id: " a ", text: "  नमस्ते  ", language: " Hindi " },
      { id: "b", text: "Hello" },
    ],
  });
  assert.deepEqual(result, [
    { id: "a", text: "नमस्ते", language: "Hindi" },
    { id: "b", text: "Hello", language: null },
  ]);
});

await check("accepts the English target explicitly", () => {
  const result = validateTranslationRequest({
    targetLanguage: "english",
    segments: [{ id: "a", text: "नमस्ते" }],
  });
  assert.equal(result.length, 1);
});

await check("rejects a non-English target", () => {
  assert.throws(
    () =>
      validateTranslationRequest({
        targetLanguage: "Hindi",
        segments: [{ id: "a", text: "Hello" }],
      }),
    TranslationInputError,
  );
});

await check("rejects a non-object body", () => {
  assert.throws(() => validateTranslationRequest(null), TranslationInputError);
});

await check("rejects missing or empty segments", () => {
  assert.throws(() => validateTranslationRequest({}), TranslationInputError);
  assert.throws(
    () => validateTranslationRequest({ segments: [] }),
    TranslationInputError,
  );
});

await check("rejects too many segments", () => {
  assert.throws(
    () =>
      validateTranslationRequest({
        segments: [
          { id: "a", text: "one" },
          { id: "b", text: "two" },
          { id: "c", text: "three" },
        ],
      }),
    TranslationInputError,
  );
});

await check("rejects duplicate ids", () => {
  assert.throws(
    () =>
      validateTranslationRequest({
        segments: [
          { id: "a", text: "one" },
          { id: "a", text: "two" },
        ],
      }),
    TranslationInputError,
  );
});

await check("rejects empty text", () => {
  assert.throws(
    () => validateTranslationRequest({ segments: [{ id: "a", text: "  " }] }),
    TranslationInputError,
  );
});

await check("rejects oversized text", () => {
  assert.throws(
    () =>
      validateTranslationRequest({
        segments: [{ id: "a", text: "x".repeat(41) }],
      }),
    TranslationInputError,
  );
});

await check("rejects oversized total text", () => {
  assert.throws(
    () =>
      validateTranslationRequest({
        segments: [
          { id: "a", text: "x".repeat(31) },
          { id: "b", text: "y".repeat(30) },
        ],
      }),
    TranslationInputError,
  );
});

console.log("Translation service");

await check("is configured from the environment", () => {
  assert.equal(translationConfigured(), true);
});

await check("returns translations aligned to the input ids", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    requestUrl = String(input);
    requestInit = init;
    return jsonResponse(
      geminiBody([
        { id: "a", text: "I have a headache." },
        { id: "b", text: "Take one tablet twice a day." },
      ]),
    );
  }) as typeof fetch;

  const result = await translateSegments({
    segments: [
      { id: "a", text: "मुझे सिरदर्द है", language: "Hindi" },
      { id: "b", text: "एक गोली दिन में दो बार लें" },
    ],
  });

  assert.equal(result.model, "test-gemini-model");
  assert.equal(result.targetLanguage, "English");
  assert.deepEqual(result.translations, [
    { id: "a", text: "I have a headache." },
    { id: "b", text: "Take one tablet twice a day." },
  ]);
  assert.match(requestUrl, /test-gemini-model:generateContent$/);
  assert.equal(
    (requestInit?.headers as Record<string, string>)["x-goog-api-key"],
    "test-gemini-key",
  );

  const sent = JSON.parse(String(requestInit?.body)) as {
    contents: Array<{ parts: Array<{ text: string }> }>;
    generationConfig: { responseMimeType: string };
  };
  assert.equal(sent.generationConfig.responseMimeType, "application/json");
  const payload = JSON.parse(sent.contents[0].parts[0].text) as {
    segments: Array<{ id: string; language?: string; text: string }>;
  };
  assert.deepEqual(payload.segments[0], {
    id: "a",
    language: "Hindi",
    text: "मुझे सिरदर्द है",
  });
});

await check("maps HTTP 429 to a rate-limited error", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({ error: { message: "quota exceeded" } }, 429)) as typeof fetch;

  await assert.rejects(
    () => translateSegments({ segments: [{ id: "a", text: "नमस्ते" }] }),
    (error: unknown) =>
      error instanceof TranslationError &&
      error.code === "rate_limited" &&
      error.status === 429,
  );
});

await check("maps rejected credentials to not-configured", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({ error: { message: "bad key" } }, 401)) as typeof fetch;

  await assert.rejects(
    () => translateSegments({ segments: [{ id: "a", text: "नमस्ते" }] }),
    (error: unknown) =>
      error instanceof TranslationError && error.code === "not_configured",
  );
});

await check("rejects a response that omits a segment", async () => {
  globalThis.fetch = (async () =>
    jsonResponse(geminiBody([{ id: "a", text: "Hello" }]))) as typeof fetch;

  await assert.rejects(
    () =>
      translateSegments({
        segments: [
          { id: "a", text: "नमस्ते" },
          { id: "b", text: "धन्यवाद" },
        ],
      }),
    (error: unknown) =>
      error instanceof TranslationError && error.code === "invalid_response",
  );
});

await check("rejects an empty candidate response", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({ candidates: [] })) as typeof fetch;

  await assert.rejects(
    () => translateSegments({ segments: [{ id: "a", text: "नमस्ते" }] }),
    (error: unknown) =>
      error instanceof TranslationError && error.code === "invalid_response",
  );
});

await check("rejects an unreadable model response", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({
      candidates: [{ content: { parts: [{ text: "not json" }] } }],
    })) as typeof fetch;

  await assert.rejects(
    () => translateSegments({ segments: [{ id: "a", text: "नमस्ते" }] }),
    (error: unknown) =>
      error instanceof TranslationError && error.code === "invalid_response",
  );
});

globalThis.fetch = originalFetch;

console.log(`\n${passed} translation checks passed.`);
