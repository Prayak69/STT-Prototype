import assert from "node:assert/strict";
import {
  MedicineSearchInputError,
  compareStrengths,
  normalizeMedicineText,
  parseCompositionKey,
  parseStrengthTokens,
  searchMedicineMatches,
  validateMedicineSearchRequest,
} from "../backend/medicineMatcher.ts";
import {
  PharmaDeskError,
  parseRetryAfter,
  searchPharmaDesk,
} from "../backend/pharmaDesk.ts";
import type {
  MedicineSearchFn,
  PharmaDeskMedicine,
  PharmaDeskSearchResponse,
} from "../backend/medicineTypes.ts";

let passed = 0;

async function check(
  name: string,
  fn: () => Promise<void> | void,
): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`  FAIL  ${name}`);
    throw error;
  }
}

function makeMedicine(
  overrides: Partial<PharmaDeskMedicine> & { id: number; name: string },
): PharmaDeskMedicine {
  return {
    id: overrides.id,
    market: overrides.market ?? "IN",
    name: overrides.name,
    genericName: overrides.genericName ?? null,
    manufacturer: overrides.manufacturer ?? null,
    dosageForm: overrides.dosageForm ?? null,
    route: overrides.route ?? null,
    strength: overrides.strength ?? null,
    packSize: overrides.packSize ?? null,
    prescriptionOnly: overrides.prescriptionOnly ?? null,
    schedule: overrides.schedule ?? null,
    status: overrides.status ?? "ACTIVE",
    compositionKey: overrides.compositionKey ?? null,
    source: overrides.source ?? { name: "test", ref: null, url: null },
    firstSeenAt: overrides.firstSeenAt ?? null,
    lastSeenAt: overrides.lastSeenAt ?? null,
  };
}

function response(
  query: string,
  results: PharmaDeskMedicine[],
): PharmaDeskSearchResponse {
  return {
    ok: true,
    query,
    market: "IN",
    count: results.length,
    results,
    disclaimer: "Test disclaimer.",
  };
}

function mockFetch(
  handler: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
): typeof fetch {
  return handler as typeof fetch;
}

const paracetamol650 = makeMedicine({
  id: 1,
  name: "Paracetamol Tablet 650 mg",
  genericName: "Paracetamol",
  dosageForm: "Tablet",
  route: "ORAL",
  strength: "650 mg",
  compositionKey: "paracetamol@650mg",
  manufacturer: "Test Labs",
});

const paracetamol500 = makeMedicine({
  id: 2,
  name: "Paracetamol Tablet 500 mg",
  genericName: "Paracetamol",
  dosageForm: "Tablet",
  strength: "500 mg",
  compositionKey: "paracetamol@500mg",
});

const paracetamolLiquid650 = makeMedicine({
  id: 3,
  name: "Paracetamol Oral Liquid 650 mg/5ml",
  genericName: "Paracetamol",
  dosageForm: "Oral Liquid",
  strength: "650 mg/5ml",
  compositionKey: "paracetamol@650mg",
});

const paracetamolSyrup650 = makeMedicine({
  id: 4,
  name: "Paracetamol Syrup 650 mg/5ml",
  genericName: "Paracetamol",
  dosageForm: "Syrup",
  strength: "650 mg/5ml",
  compositionKey: "paracetamol@650mg",
});

await check("normalises spoken-strength words and Hindi script", () => {
  const spoken = normalizeMedicineText("Dolo Six Fifty");
  assert.equal(spoken.text, "dolo 650");
  assert.ok(spoken.transformations.includes("spoken_number_normalization"));

  const hindi = normalizeMedicineText("पैरासिटामोल ६५०");
  assert.equal(hindi.text, "paracetamol 650");
  assert.ok(hindi.transformations.includes("devanagari_transliteration"));
});

await check("parses strengths and matches combination totals", () => {
  const requested = parseStrengthTokens(["amoxicillin", "625"]).strengths;
  const combination = parseStrengthTokens([
    "amoxicillin",
    "500",
    "mg",
    "clavulanic",
    "125",
    "mg",
  ]).strengths;

  const result = compareStrengths(requested, combination);
  assert.equal(result.match, true);
  assert.equal(result.matchedBy, "sum");

  const mismatch = compareStrengths(
    parseStrengthTokens(["paracetamol", "650", "mg"]).strengths,
    parseStrengthTokens(["paracetamol", "500", "mg"]).strengths,
  );
  assert.equal(mismatch.match, false);
});

await check("parses compositionKey components without inventing fields", () => {
  assert.deepEqual(parseCompositionKey("amoxicillin@500mg|clavulanic acid@125mg"), [
    { name: "amoxicillin", strength: "500mg" },
    { name: "clavulanic acid", strength: "125mg" },
  ]);
  assert.deepEqual(parseCompositionKey(null), []);
});

await check("PharmaDesk client sends verified query parameters", async () => {
  let captured = "";
  const fetchImpl = mockFetch(async (input, init) => {
    captured = String(input);
    assert.equal(init?.method, "GET");
    return new Response(JSON.stringify(response("paracetamol", [paracetamol650])), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const result = await searchPharmaDesk(
    "paracetamol",
    { market: "IN", limit: 3 },
    { fetchImpl, sleep: async () => undefined },
  );

  assert.equal(result.results[0]?.name, "Paracetamol Tablet 650 mg");
  const url = new URL(captured);
  assert.equal(url.searchParams.get("q"), "paracetamol");
  assert.equal(url.searchParams.get("market"), "IN");
  assert.equal(url.searchParams.get("limit"), "3");
});

await check("PharmaDesk client retries 429 and honours Retry-After", async () => {
  let calls = 0;
  const waits: number[] = [];
  const fetchImpl = mockFetch(async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("", {
        status: 429,
        headers: { "retry-after": "1" },
      });
    }
    return new Response(JSON.stringify(response("paracetamol", [paracetamol650])), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const result = await searchPharmaDesk(
    "paracetamol",
    {},
    {
      fetchImpl,
      sleep: async (ms) => {
        waits.push(ms);
      },
    },
  );

  assert.equal(calls, 2);
  assert.deepEqual(waits, [1000]);
  assert.equal(result.results.length, 1);
});

await check("PharmaDesk client surfaces exhausted rate limits", async () => {
  let calls = 0;
  const fetchImpl = mockFetch(async () => {
    calls += 1;
    return new Response("", {
      status: 429,
      headers: { "retry-after": "2" },
    });
  });

  await assert.rejects(
    () =>
      searchPharmaDesk(
        "paracetamol",
        {},
        { fetchImpl, sleep: async () => undefined },
      ),
    (error: unknown) =>
      error instanceof PharmaDeskError &&
      error.code === "rate_limited" &&
      error.retryAfterSeconds === 2,
  );
  assert.equal(calls, 3);
});

await check("PharmaDesk client maps 400 errors without guessing", async () => {
  const fetchImpl = mockFetch(
    async () =>
      new Response(
        JSON.stringify({ ok: false, error: "q must be at least 2 characters" }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
  );

  await assert.rejects(
    () =>
      searchPharmaDesk(
        "ab",
        {},
        { fetchImpl, sleep: async () => undefined },
      ),
    (error: unknown) =>
      error instanceof PharmaDeskError &&
      error.code === "bad_request" &&
      error.message.includes("at least 2"),
  );
});

await check("PharmaDesk client rejects unexpected response shapes", async () => {
  const fetchImpl = mockFetch(
    async () =>
      new Response(JSON.stringify({ ok: true, count: 1, results: [{ id: "1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );

  await assert.rejects(
    () =>
      searchPharmaDesk(
        "paracetamol",
        {},
        { fetchImpl, sleep: async () => undefined },
      ),
    (error: unknown) =>
      error instanceof PharmaDeskError && error.code === "invalid_response",
  );
});

await check("PharmaDesk client times out", async () => {
  const fetchImpl = mockFetch(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      }),
  );

  await assert.rejects(
    () =>
      searchPharmaDesk(
        "paracetamol",
        {},
        {
          fetchImpl,
          sleep: async () => undefined,
          timeoutMs: 10,
        },
      ),
    (error: unknown) =>
      error instanceof PharmaDeskError && error.code === "timeout",
  );
});

await check("parses numeric and HTTP-date Retry-After values", () => {
  assert.equal(parseRetryAfter("3"), 3);
  assert.equal(parseRetryAfter(null), null);
  const now = Date.parse("2026-01-01T00:00:10Z");
  assert.equal(
    parseRetryAfter("Thu, 01 Jan 2026 00:00:20 GMT", () => now),
    10,
  );
});

await check("validates the HTTP request contract", () => {
  assert.deepEqual(validateMedicineSearchRequest({ query: "  dolo 650 " }), {
    query: "dolo 650",
    market: "IN",
    limit: 10,
  });
  assert.throws(
    () => validateMedicineSearchRequest({ query: "a" }),
    MedicineSearchInputError,
  );
  assert.throws(
    () => validateMedicineSearchRequest({ query: "paracetamol", market: "XX" }),
    MedicineSearchInputError,
  );
  assert.throws(
    () => validateMedicineSearchRequest({ query: "paracetamol", limit: 0 }),
    MedicineSearchInputError,
  );
});

await check("brand alias produces a suggestion, never an automatic match", async () => {
  const calls: string[] = [];
  const search: MedicineSearchFn = async (query) => {
    calls.push(query);
    if (query === "paracetamol 650") return response(query, [paracetamol650]);
    return response(query, []);
  };

  const result = await searchMedicineMatches({ query: "Dolo 650" }, { search });

  assert.equal(result.status, "suggested");
  assert.equal(result.results[0]?.matchStatus, "suggested");
  assert.equal(result.results[0]?.canonicalName, "Paracetamol Tablet 650 mg");
  assert.equal(result.results[0]?.aliasUsed, "dolo");
  assert.equal(result.results[0]?.brand, null);
  assert.equal(result.results[0]?.strengthComparison.match, true);
  assert.ok((result.results[0]?.confidence ?? 1) <= 0.85);
  assert.ok(calls.includes("paracetamol 650"));
  assert.ok(result.notices.some((notice) => notice.includes("brand field")));
  assert.ok(result.notices.some((notice) => notice.includes("transient display")));
});

await check("Hindi brand text is transliterated into an alias search", async () => {
  const search: MedicineSearchFn = async (query) =>
    query === "paracetamol 650"
      ? response(query, [paracetamol650])
      : response(query, []);

  const result = await searchMedicineMatches({ query: "डोलो ६५०" }, { search });

  assert.equal(result.normalizedQuery, "dolo 650");
  assert.equal(result.status, "suggested");
  assert.equal(result.results[0]?.aliasUsed, "dolo");
});

await check("exact product name and strength is the only matched state", async () => {
  const search: MedicineSearchFn = async (query) =>
    response(query, [paracetamol650]);

  const result = await searchMedicineMatches(
    { query: "Paracetamol Tablet 650 mg" },
    { search },
  );

  assert.equal(result.status, "matched");
  assert.equal(result.results[0]?.matchStatus, "matched");
  assert.equal(result.results[0]?.confidence, 1);
  assert.equal(result.results[0]?.deterministic, true);
  assert.ok(result.results[0]?.matchedFields.includes("name"));
});

await check("strength mismatch is rejected, not silently substituted", async () => {
  const search: MedicineSearchFn = async (query) =>
    response(query, [paracetamol500]);

  const result = await searchMedicineMatches(
    { query: "paracetamol 650 mg tablet" },
    { search },
  );

  assert.equal(result.status, "unmatched");
  assert.equal(result.results[0]?.matchStatus, "unmatched");
  assert.equal(result.results[0]?.strengthComparison.match, false);
  assert.ok(result.results[0]?.reason.includes("Strength mismatch"));
});

await check("dosage-form mismatch is rejected", async () => {
  const search: MedicineSearchFn = async (query) =>
    response(query, [paracetamolSyrup650]);

  const result = await searchMedicineMatches(
    { query: "paracetamol 650 tablet" },
    { search },
  );

  assert.equal(result.status, "unmatched");
  assert.equal(result.results[0]?.dosageFormComparison.match, false);
  assert.ok(result.results[0]?.reason.includes("Dosage form mismatch"));
});

await check("multiple equally plausible products stay ambiguous", async () => {
  const search: MedicineSearchFn = async (query) =>
    response(query, [paracetamol650, paracetamolLiquid650]);

  const result = await searchMedicineMatches({ query: "paracetamol 650" }, { search });

  assert.equal(result.status, "ambiguous");
  assert.equal(result.results.length, 2);
  assert.ok(result.results.every((item) => item.matchStatus === "ambiguous"));
  assert.ok(result.notices.some((notice) => notice.includes("choose")));
});

await check("generic-only query never auto-selects one product", async () => {
  const search: MedicineSearchFn = async (query) =>
    response(query, [paracetamol650, paracetamol500]);

  const result = await searchMedicineMatches({ query: "paracetamol" }, { search });

  assert.equal(result.status, "ambiguous");
  assert.ok(result.results.every((item) => item.matchStatus !== "matched"));
});

await check("spelling correction is conservative and marked", async () => {
  const search: MedicineSearchFn = async (query) =>
    query.includes("paracetamol")
      ? response(query, [paracetamol650])
      : response(query, []);

  const result = await searchMedicineMatches(
    { query: "paracetamxl 650" },
    { search },
  );

  assert.equal(result.status, "suggested");
  assert.equal(result.results[0]?.spellingCorrected, true);
  assert.ok((result.results[0]?.confidence ?? 1) <= 0.85);
});

await check("empty catalogue response is unmatched with a warning", async () => {
  const search: MedicineSearchFn = async (query) => response(query, []);

  const result = await searchMedicineMatches({ query: "zzzzunknown" }, { search });

  assert.equal(result.status, "unmatched");
  assert.equal(result.count, 0);
  assert.ok(
    result.notices.some((notice) => notice.includes("No catalogue match")),
  );
});

console.log(`\n${passed} medicine tests passed.\n`);
