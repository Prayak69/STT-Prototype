import assert from "node:assert/strict";

// Configure the report module before importing it.
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.REPORT_MODEL = "test-report-model";
process.env.REPORT_MAX_RETRIES = "0";
process.env.REPORT_MAX_SEGMENTS = "3";
process.env.REPORT_MAX_SEGMENT_CHARS = "500";
process.env.REPORT_MAX_INPUT_CHARS = "1000";
process.env.REPORT_CHUNK_CHARS = "300";
process.env.REPORT_TIMEOUT_MS = "1000";

const {
  REPORT_DISCLAIMER,
  ReportError,
  ReportInputError,
  generateConsultationReport,
  mergeReports,
  normalizeReport,
  reportConfigured,
  validateReportRequest,
} = await import("../backend/consultationReport.ts");

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function geminiBody(report: unknown): unknown {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(report) }],
        },
      },
    ],
  };
}

function context(segments: unknown[], mode: "live" | "batch" = "batch") {
  return {
    mode,
    segments: segments as never[],
    generatedAt: "2026-11-06T12:00:00.000Z",
  };
}

const originalFetch = globalThis.fetch;

const baseSegments = [
  {
    id: "a",
    text: "I have had a headache and fever for two days.",
    speaker: "Speaker 1",
    role: "patient",
    startTime: 0,
    endTime: 60,
    language: "Hindi",
  },
  {
    id: "b",
    text: "Take one Paracetamol 650 mg tablet twice a day after food.",
    speaker: "Speaker 2",
    role: "clinician",
    startTime: 60,
    endTime: 120,
    language: "Hindi",
  },
];

const fullReport = {
  summary: "A patient with headache and fever.",
  patient: { age: "34", sex: "male", identifiers: [] },
  chiefComplaint: {
    text: "Headache and fever for two days",
    evidence: ["a"],
  },
  subjective: {
    historyOfPresentIllness: "Two days of headache and fever.",
    symptoms: [
      {
        symptom: "Headache",
        onset: "2 days ago",
        duration: "2 days",
        severity: "moderate",
        aggravatingFactors: "",
        relievingFactors: "",
        evidence: ["a", "not-a-real-segment"],
      },
    ],
    pastMedicalHistory: ["Hypertension"],
    currentMedications: [
      {
        name: "Paracetamol",
        strength: "650 mg",
        dose: "1 tablet",
        frequency: "twice a day",
        duration: "5 days",
        route: "oral",
        instructions: "after food",
        statedBy: "clinician",
        evidence: ["b"],
      },
    ],
    allergies: ["No known allergies"],
    familyHistory: [],
    socialHistory: [],
    reviewOfSystems: [],
  },
  objective: {
    vitals: [{ name: "Temperature", value: "38.2", unit: "°C", evidence: ["b"] }],
    examinationFindings: ["Febrile"],
  },
  assessment: {
    impression: "",
    differential: [],
    statedBy: "unknown",
    evidence: [],
  },
  plan: {
    investigations: ["CBC"],
    medications: [
      {
        name: "Paracetamol",
        strength: "650 mg",
        dose: "1 tablet",
        frequency: "twice a day",
        duration: "5 days",
        route: "oral",
        instructions: "after food",
        statedBy: "clinician",
        evidence: ["b"],
      },
    ],
    advice: ["Hydration"],
    followUp: "3 days",
  },
  redFlags: ["Fever above 39°C"],
  gaps: ["No medication allergies documented"],
  warnings: [],
  completeness: "complete",
  hallucinated: "must be dropped",
};

console.log("Report validation");

await check("accepts a valid request and normalizes optional fields", () => {
  const result = validateReportRequest({
    mode: "batch",
    segments: [
      {
        id: " a ",
        text: "  Hello  ",
        speaker: " Speaker 1 ",
        role: "Patient",
        startTime: 0,
        endTime: 2.25,
        language: " Hindi ",
      },
    ],
  });

  assert.equal(result.mode, "batch");
  assert.deepEqual(result.segments, [
    {
      id: "a",
      text: "Hello",
      speaker: "Speaker 1",
      role: "patient",
      startTime: 0,
      endTime: 2.3,
      language: "Hindi",
    },
  ]);
});

await check("defaults mode to live", () => {
  const result = validateReportRequest({
    segments: [{ id: "a", text: "Hello" }],
  });
  assert.equal(result.mode, "live");
});

await check("rejects a non-object body", () => {
  assert.throws(() => validateReportRequest(null), ReportInputError);
});

await check("rejects an invalid mode", () => {
  assert.throws(
    () =>
      validateReportRequest({
        mode: "phone",
        segments: [{ id: "a", text: "Hello" }],
      }),
    ReportInputError,
  );
});

await check("rejects missing or empty segments", () => {
  assert.throws(() => validateReportRequest({}), ReportInputError);
  assert.throws(
    () => validateReportRequest({ segments: [] }),
    ReportInputError,
  );
});

await check("rejects too many segments", () => {
  assert.throws(
    () =>
      validateReportRequest({
        segments: [
          { id: "a", text: "one" },
          { id: "b", text: "two" },
          { id: "c", text: "three" },
          { id: "d", text: "four" },
        ],
      }),
    ReportInputError,
  );
});

await check("rejects duplicate ids", () => {
  assert.throws(
    () =>
      validateReportRequest({
        segments: [
          { id: "a", text: "one" },
          { id: "a", text: "two" },
        ],
      }),
    ReportInputError,
  );
});

await check("rejects empty segment text", () => {
  assert.throws(
    () => validateReportRequest({ segments: [{ id: "a", text: "  " }] }),
    ReportInputError,
  );
});

await check("rejects oversized segment text", () => {
  assert.throws(
    () =>
      validateReportRequest({
        segments: [{ id: "a", text: "x".repeat(501) }],
      }),
    ReportInputError,
  );
});

await check("rejects an invalid speaker role", () => {
  assert.throws(
    () =>
      validateReportRequest({
        segments: [{ id: "a", text: "Hello", role: "doctor" }],
      }),
    ReportInputError,
  );
});

await check("rejects a negative timestamp", () => {
  assert.throws(
    () =>
      validateReportRequest({
        segments: [{ id: "a", text: "Hello", startTime: -1 }],
      }),
    ReportInputError,
  );
});

await check("rejects an oversized transcript with 413", () => {
  const error = (() => {
    try {
      validateReportRequest({
        segments: [
          { id: "a", text: "x".repeat(400) },
          { id: "b", text: "y".repeat(400) },
          { id: "c", text: "z".repeat(400) },
        ],
      });
      return null;
    } catch (caught) {
      return caught;
    }
  })();

  assert.ok(error instanceof ReportInputError);
  assert.equal(error.status, 413);
});

console.log("Report service");

await check("is configured from the environment", () => {
  assert.equal(reportConfigured(), true);
});

await check("normalizes a report and preserves clinical details", () => {
  const report = normalizeReport(fullReport, context(baseSegments));

  assert.equal(report.meta.source, "batch");
  assert.equal(report.meta.segmentCount, 2);
  assert.equal(report.meta.durationSeconds, 120);
  assert.deepEqual(report.meta.languages, ["Hindi"]);
  assert.equal(report.meta.speakerCount, 2);
  assert.equal(report.meta.completeness, "complete");
  assert.equal(report.disclaimer, REPORT_DISCLAIMER);

  assert.equal(report.patient.age, "34");
  assert.equal(report.patient.sex, "male");
  assert.equal(report.chiefComplaint.text, "Headache and fever for two days");
  assert.deepEqual(report.chiefComplaint.evidence, ["a"]);

  assert.equal(report.subjective.symptoms[0]?.symptom, "Headache");
  assert.deepEqual(report.subjective.symptoms[0]?.evidence, ["a"]);

  const medication = report.plan.medications[0];
  assert.equal(medication?.name, "Paracetamol");
  assert.equal(medication?.strength, "650 mg");
  assert.equal(medication?.dose, "1 tablet");
  assert.equal(medication?.frequency, "twice a day");
  assert.equal(medication?.statedBy, "clinician");

  assert.equal(report.assessment.impression, null);
  assert.equal(report.assessment.statedBy, null);
  assert.equal(report.plan.followUp, "3 days");
  assert.deepEqual(report.redFlags, ["Fever above 39°C"]);
  assert.equal(
    (report as unknown as Record<string, unknown>).hallucinated,
    undefined,
  );
});

await check("turns placeholders into empty values", () => {
  const report = normalizeReport(
    {
      summary: "Not stated",
      patient: { age: "unknown", sex: "not documented", identifiers: [] },
      chiefComplaint: { text: "", evidence: [] },
      subjective: {},
      objective: {},
      assessment: {},
      plan: {},
      redFlags: [],
      gaps: [],
      warnings: [],
      completeness: "limited",
    },
    context([baseSegments[0]]),
  );

  assert.equal(report.summary, null);
  assert.equal(report.patient.age, null);
  assert.equal(report.patient.sex, null);
  assert.equal(report.chiefComplaint.text, null);
});

await check("generates a report, sends the key server-side and keeps evidence", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    requestUrl = String(input);
    requestInit = init;
    return jsonResponse(geminiBody(fullReport));
  }) as typeof fetch;

  const result = await generateConsultationReport({
    mode: "batch",
    segments: baseSegments,
  });

  assert.equal(result.model, "test-report-model");
  assert.equal(result.report.meta.source, "batch");
  assert.equal(result.report.plan.medications[0]?.strength, "650 mg");
  assert.deepEqual(result.report.subjective.symptoms[0]?.evidence, ["a"]);
  assert.equal(result.report.disclaimer, REPORT_DISCLAIMER);

  assert.match(requestUrl, /test-report-model:generateContent$/);
  assert.equal(
    (requestInit?.headers as Record<string, string>)["x-goog-api-key"],
    "test-gemini-key",
  );

  const sent = JSON.parse(String(requestInit?.body)) as {
    contents: Array<{ parts: Array<{ text: string }> }>;
    generationConfig: { responseMimeType: string; temperature: number };
  };
  assert.equal(sent.generationConfig.responseMimeType, "application/json");
  assert.equal(sent.generationConfig.temperature, 0);
  assert.match(sent.contents[0].parts[0].text, /Consultation transcript:/);
  assert.match(sent.contents[0].parts[0].text, /"id":"a"/);
  assert.match(sent.contents[0].parts[0].text, /"role":"patient"/);
});

await check("warns when speaker roles are missing", async () => {
  globalThis.fetch = (async () =>
    jsonResponse(geminiBody(fullReport))) as typeof fetch;

  const result = await generateConsultationReport({
    segments: baseSegments.map((segment) => ({
      id: segment.id,
      text: segment.text,
      speaker: segment.speaker,
      startTime: segment.startTime,
      endTime: segment.endTime,
      language: segment.language,
    })),
  });

  assert.ok(
    result.report.warnings.some((warning) => warning.includes("Speaker roles")),
  );
});

await check("merges chunked reports and deduplicates items", async () => {
  let calls = 0;

  globalThis.fetch = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as {
      contents: Array<{ parts: Array<{ text: string }> }>;
    };
    const prompt = body.contents[0].parts[0].text;

    const partial = prompt.includes('"id":"a"')
      ? {
          summary: "Headache and fever.",
          chiefComplaint: {
            text: "Headache and fever",
            evidence: ["a"],
          },
          subjective: {
            historyOfPresentIllness: "Two days.",
            symptoms: [
              {
                symptom: "Headache",
                onset: "2 days",
                duration: "",
                severity: "",
                aggravatingFactors: "",
                relievingFactors: "",
                evidence: ["a"],
              },
            ],
          },
        }
      : {
          plan: {
            investigations: [],
            medications: [
              {
                name: "Paracetamol",
                strength: "650 mg",
                dose: "1 tablet",
                frequency: "twice a day",
                duration: "5 days",
                route: "oral",
                instructions: "after food",
                statedBy: "clinician",
                evidence: ["c"],
              },
            ],
            advice: [],
            followUp: "",
          },
          assessment: {
            impression: "",
            differential: [],
            statedBy: "unknown",
            evidence: [],
          },
        };

    return jsonResponse(geminiBody(partial));
  }) as typeof fetch;

  const longSegments = [
    {
      id: "a",
      text: "a".repeat(140),
      speaker: "Speaker 1",
      role: "patient" as const,
      startTime: 0,
      endTime: 10,
      language: "Hindi",
    },
    {
      id: "b",
      text: "b".repeat(140),
      speaker: "Speaker 1",
      role: "patient" as const,
      startTime: 10,
      endTime: 20,
      language: "Hindi",
    },
    {
      id: "c",
      text: "c".repeat(140),
      speaker: "Speaker 2",
      role: "clinician" as const,
      startTime: 20,
      endTime: 30,
      language: "Hindi",
    },
  ];

  const result = await generateConsultationReport({
    mode: "batch",
    segments: longSegments,
  });

  assert.equal(calls, 2);
  assert.equal(result.report.chiefComplaint.text, "Headache and fever");
  assert.equal(result.report.subjective.symptoms.length, 1);
  assert.equal(result.report.plan.medications.length, 1);
  assert.equal(result.report.plan.medications[0]?.evidence[0], "c");
  assert.equal(result.report.meta.segmentCount, 3);
  assert.equal(result.report.meta.durationSeconds, 30);
  assert.ok(
    result.report.warnings.some((warning) =>
      warning.includes("processed in 2 parts"),
    ),
  );
});

await check("rejects a malformed model response", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({
      candidates: [{ content: { parts: [{ text: "not json" }] } }],
    })) as typeof fetch;

  await assert.rejects(
    () =>
      generateConsultationReport({
        segments: [{ id: "a", text: "Hello", speaker: "Speaker 1" }],
      }),
    (error: unknown) =>
      error instanceof ReportError && error.code === "invalid_response",
  );
});

await check("rejects an empty candidate response", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({ candidates: [] })) as typeof fetch;

  await assert.rejects(
    () =>
      generateConsultationReport({
        segments: [{ id: "a", text: "Hello", speaker: "Speaker 1" }],
      }),
    (error: unknown) =>
      error instanceof ReportError && error.code === "invalid_response",
  );
});

await check("maps HTTP 429 to a rate-limited error", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({ error: { message: "quota exceeded" } }, 429)) as typeof fetch;

  await assert.rejects(
    () =>
      generateConsultationReport({
        segments: [{ id: "a", text: "Hello", speaker: "Speaker 1" }],
      }),
    (error: unknown) =>
      error instanceof ReportError &&
      error.code === "rate_limited" &&
      error.status === 429,
  );
});

await check("maps rejected credentials to not-configured", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({ error: { message: "bad key" } }, 401)) as typeof fetch;

  await assert.rejects(
    () =>
      generateConsultationReport({
        segments: [{ id: "a", text: "Hello", speaker: "Speaker 1" }],
      }),
    (error: unknown) =>
      error instanceof ReportError && error.code === "not_configured",
  );
});

await check("mergeReports keeps the full context metadata", () => {
  const report = normalizeReport(fullReport, context(baseSegments));
  const merged = mergeReports([report], context(baseSegments));

  assert.equal(merged.meta.segmentCount, 2);
  assert.equal(merged.meta.speakerCount, 2);
  assert.equal(merged.meta.durationSeconds, 120);
  assert.equal(merged.disclaimer, REPORT_DISCLAIMER);
});

globalThis.fetch = originalFetch;

console.log(`\n${passed} report checks passed.`);
