import { config } from "./config";
import { logger } from "./logger";
import {
  SPEAKER_ROLES,
  type ConsultationReport,
  type ConsultationSource,
  type ReportCompleteness,
  type ReportMedication,
  type ReportSegmentInput,
  type ReportServiceResult,
  type ReportSymptom,
  type ReportVital,
  type SpeakerRole,
  type ValidatedReportRequest,
} from "./reportTypes";

/**
 * Structured consultation report generation.
 *
 * Gnani only transcribes, so the report is a separate, on-demand Gemini step.
 * The raw transcript is never modified: the browser keeps it and sends a copy
 * of the finished segments to this server. Every extracted item carries the
 * segment ids that support it so the UI can link back to the transcript.
 */

export const REPORT_DISCLAIMER =
  "AI-generated consultation draft. Review against the original conversation before any clinical use. This is not a diagnosis, prescription or medical advice.";

export type ReportErrorCode =
  | "disabled"
  | "not_configured"
  | "rate_limited"
  | "timeout"
  | "too_large"
  | "upstream_error"
  | "invalid_response";

export class ReportInputError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ReportInputError";
    this.status = status;
  }
}

export class ReportError extends Error {
  readonly code: ReportErrorCode;
  readonly status?: number;

  constructor(code: ReportErrorCode, message: string, status?: number) {
    super(message);
    this.name = "ReportError";
    this.code = code;
    this.status = status;
  }
}

interface NormalizeContext {
  mode: ConsultationSource;
  segments: ReportSegmentInput[];
  generatedAt: string;
}

const PLACEHOLDERS = new Set([
  "",
  "-",
  "—",
  "n/a",
  "na",
  "none documented",
  "not available",
  "not documented",
  "not mentioned",
  "not stated",
  "null",
  "undefined",
  "unknown",
]);

const COMPLETENESS: readonly ReportCompleteness[] = [
  "complete",
  "partial",
  "limited",
];

export function reportConfigured(): boolean {
  return config.report.enabled && Boolean(config.report.apiKey);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || PLACEHOLDERS.has(text.toLowerCase())) return null;
  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

function readStringList(
  value: unknown,
  maxItems: number,
  itemMaxLength: number,
): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of source) {
    const text = cleanText(item, itemMaxLength);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maxItems) break;
  }

  return result;
}

function readEvidence(value: unknown, validIds: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || !validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= 100) break;
  }

  return result;
}

function normalizeRole(value: unknown): SpeakerRole | null {
  if (typeof value !== "string") return null;
  const role = value.trim().toLowerCase();
  if (!SPEAKER_ROLES.includes(role as SpeakerRole)) return null;
  return role === "unknown" ? null : (role as SpeakerRole);
}

function normalizeCompleteness(value: unknown): ReportCompleteness | null {
  if (typeof value !== "string") return null;
  const completeness = value.trim().toLowerCase();
  return COMPLETENESS.includes(completeness as ReportCompleteness)
    ? (completeness as ReportCompleteness)
    : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value * 10) / 10;
}

function uniqueStrings(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function buildMeta(context: NormalizeContext): ConsultationReport["meta"] {
  const starts = context.segments
    .map((segment) => segment.startTime)
    .filter((value): value is number => value !== null);
  const ends = context.segments
    .map((segment) => segment.endTime)
    .filter((value): value is number => value !== null);

  const durationSeconds =
    ends.length > 0
      ? Math.round(
          (Math.max(...ends) - (starts.length > 0 ? Math.min(...starts) : 0)) *
            10,
        ) / 10
      : null;

  const speakers = uniqueStrings(
    context.segments.map((segment) => segment.speaker),
  );
  const languages = uniqueStrings(
    context.segments.map((segment) => segment.language),
  );

  return {
    source: context.mode,
    generatedAt: context.generatedAt,
    durationSeconds,
    languages,
    speakerCount: speakers.length > 0 ? speakers.length : null,
    segmentCount: context.segments.length,
    completeness: "partial",
  };
}

function emptyReport(context: NormalizeContext): ConsultationReport {
  const meta = buildMeta(context);
  return {
    meta,
    summary: null,
    patient: { age: null, sex: null, identifiers: [] },
    chiefComplaint: { text: null, evidence: [] },
    subjective: {
      historyOfPresentIllness: null,
      symptoms: [],
      pastMedicalHistory: [],
      currentMedications: [],
      allergies: [],
      familyHistory: [],
      socialHistory: [],
      reviewOfSystems: [],
    },
    objective: { vitals: [], examinationFindings: [] },
    assessment: {
      impression: null,
      differential: [],
      statedBy: null,
      evidence: [],
    },
    plan: {
      investigations: [],
      medications: [],
      advice: [],
      followUp: null,
    },
    redFlags: [],
    gaps: [],
    warnings: [],
    disclaimer: REPORT_DISCLAIMER,
  };
}

function normalizeMedication(
  value: unknown,
  validIds: Set<string>,
): ReportMedication | null {
  if (!isRecord(value)) return null;
  const name = cleanText(value.name, 200);
  if (!name) return null;

  return {
    name,
    strength: cleanText(value.strength, 80),
    dose: cleanText(value.dose, 120),
    frequency: cleanText(value.frequency, 120),
    duration: cleanText(value.duration, 120),
    route: cleanText(value.route, 80),
    instructions: cleanText(value.instructions, 400),
    statedBy: normalizeRole(value.statedBy),
    evidence: readEvidence(value.evidence, validIds),
  };
}

function normalizeSymptom(
  value: unknown,
  validIds: Set<string>,
): ReportSymptom | null {
  if (!isRecord(value)) return null;
  const symptom = cleanText(value.symptom, 200);
  if (!symptom) return null;

  return {
    symptom,
    onset: cleanText(value.onset, 120),
    duration: cleanText(value.duration, 120),
    severity: cleanText(value.severity, 120),
    aggravatingFactors: cleanText(value.aggravatingFactors, 240),
    relievingFactors: cleanText(value.relievingFactors, 240),
    evidence: readEvidence(value.evidence, validIds),
  };
}

function normalizeVital(
  value: unknown,
  validIds: Set<string>,
): ReportVital | null {
  if (!isRecord(value)) return null;
  const name = cleanText(value.name, 120);
  if (!name) return null;

  return {
    name,
    value: cleanText(value.value, 80),
    unit: cleanText(value.unit, 40),
    evidence: readEvidence(value.evidence, validIds),
  };
}

function normalizeArray<T>(
  value: unknown,
  normalize: (item: unknown, validIds: Set<string>) => T | null,
  validIds: Set<string>,
  maxItems: number,
): T[] {
  if (!Array.isArray(value)) return [];
  const result: T[] = [];
  for (const item of value) {
    const normalized = normalize(item, validIds);
    if (!normalized) continue;
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

function deriveCompleteness(report: ConsultationReport): ReportCompleteness {
  let sections = 0;
  if (report.patient.age || report.patient.sex) sections += 1;
  if (report.chiefComplaint.text || report.summary) sections += 1;
  if (
    report.subjective.historyOfPresentIllness ||
    report.subjective.symptoms.length > 0
  ) {
    sections += 1;
  }
  if (
    report.subjective.pastMedicalHistory.length > 0 ||
    report.subjective.allergies.length > 0 ||
    report.subjective.currentMedications.length > 0 ||
    report.subjective.familyHistory.length > 0 ||
    report.subjective.socialHistory.length > 0 ||
    report.subjective.reviewOfSystems.length > 0
  ) {
    sections += 1;
  }
  if (
    report.objective.vitals.length > 0 ||
    report.objective.examinationFindings.length > 0
  ) {
    sections += 1;
  }
  if (
    report.assessment.impression ||
    report.assessment.differential.length > 0
  ) {
    sections += 1;
  }
  if (
    report.plan.investigations.length > 0 ||
    report.plan.medications.length > 0 ||
    report.plan.advice.length > 0 ||
    report.plan.followUp
  ) {
    sections += 1;
  }

  if (sections >= 6) return "complete";
  if (sections >= 3) return "partial";
  return "limited";
}

function hasClinicalContent(report: ConsultationReport): boolean {
  return Boolean(
    report.summary ||
      report.chiefComplaint.text ||
      report.subjective.historyOfPresentIllness ||
      report.subjective.symptoms.length > 0 ||
      report.subjective.pastMedicalHistory.length > 0 ||
      report.subjective.currentMedications.length > 0 ||
      report.subjective.allergies.length > 0 ||
      report.subjective.familyHistory.length > 0 ||
      report.subjective.socialHistory.length > 0 ||
      report.subjective.reviewOfSystems.length > 0 ||
      report.objective.vitals.length > 0 ||
      report.objective.examinationFindings.length > 0 ||
      report.assessment.impression ||
      report.assessment.differential.length > 0 ||
      report.plan.investigations.length > 0 ||
      report.plan.medications.length > 0 ||
      report.plan.advice.length > 0 ||
      report.plan.followUp ||
      report.redFlags.length > 0,
  );
}

/**
 * Normalizes the model output into the report shape. Missing or placeholder
 * values become null/empty; unknown fields are dropped and evidence ids are
 * restricted to ids that actually exist in the input.
 */
export function normalizeReport(
  raw: unknown,
  context: NormalizeContext,
): ConsultationReport {
  if (!isRecord(raw)) {
    throw new ReportError(
      "invalid_response",
      "The report service returned an unexpected response.",
    );
  }

  const validIds = new Set(context.segments.map((segment) => segment.id));
  const patient = isRecord(raw.patient) ? raw.patient : {};
  const chiefComplaint = isRecord(raw.chiefComplaint) ? raw.chiefComplaint : {};
  const subjective = isRecord(raw.subjective) ? raw.subjective : {};
  const objective = isRecord(raw.objective) ? raw.objective : {};
  const assessment = isRecord(raw.assessment) ? raw.assessment : {};
  const plan = isRecord(raw.plan) ? raw.plan : {};

  const report: ConsultationReport = {
    meta: buildMeta(context),
    summary: cleanText(raw.summary, 1600),
    patient: {
      age: cleanText(patient.age, 60),
      sex: cleanText(patient.sex, 60),
      identifiers: readStringList(patient.identifiers, 20, 160),
    },
    chiefComplaint: {
      text:
        cleanText(chiefComplaint.text, 600) ??
        cleanText(raw.chiefComplaint, 600),
      evidence: readEvidence(chiefComplaint.evidence, validIds),
    },
    subjective: {
      historyOfPresentIllness: cleanText(
        subjective.historyOfPresentIllness,
        5000,
      ),
      symptoms: normalizeArray(
        subjective.symptoms,
        normalizeSymptom,
        validIds,
        60,
      ),
      pastMedicalHistory: readStringList(
        subjective.pastMedicalHistory,
        40,
        500,
      ),
      currentMedications: normalizeArray(
        subjective.currentMedications,
        normalizeMedication,
        validIds,
        60,
      ),
      allergies: readStringList(subjective.allergies, 30, 300),
      familyHistory: readStringList(subjective.familyHistory, 30, 500),
      socialHistory: readStringList(subjective.socialHistory, 30, 500),
      reviewOfSystems: readStringList(subjective.reviewOfSystems, 40, 300),
    },
    objective: {
      vitals: normalizeArray(objective.vitals, normalizeVital, validIds, 40),
      examinationFindings: readStringList(
        objective.examinationFindings,
        40,
        500,
      ),
    },
    assessment: {
      impression: cleanText(assessment.impression, 2000),
      differential: readStringList(assessment.differential, 30, 300),
      statedBy: normalizeRole(assessment.statedBy),
      evidence: readEvidence(assessment.evidence, validIds),
    },
    plan: {
      investigations: readStringList(plan.investigations, 40, 400),
      medications: normalizeArray(
        plan.medications,
        normalizeMedication,
        validIds,
        60,
      ),
      advice: readStringList(plan.advice, 40, 500),
      followUp: cleanText(plan.followUp, 500),
    },
    redFlags: readStringList(raw.redFlags, 30, 400),
    gaps: readStringList(raw.gaps, 30, 400),
    warnings: readStringList(raw.warnings, 30, 400),
    disclaimer: REPORT_DISCLAIMER,
  };

  report.meta.completeness =
    normalizeCompleteness(raw.completeness) ?? deriveCompleteness(report);

  return report;
}

function mergeStrings(target: string[], source: string[]): void {
  const seen = new Set(target.map((item) => item.toLowerCase()));
  for (const item of source) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(item);
  }
}

function mergeItems<T>(
  target: T[],
  source: T[],
  keyOf: (item: T) => string,
): void {
  const seen = new Set(target.map(keyOf));
  for (const item of source) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(item);
  }
}

function medicationKey(medication: ReportMedication): string {
  return [
    medication.name,
    medication.strength ?? "",
    medication.dose ?? "",
    medication.frequency ?? "",
  ]
    .join("|")
    .toLowerCase();
}

function symptomKey(symptom: ReportSymptom): string {
  return [symptom.symptom, symptom.onset ?? ""].join("|").toLowerCase();
}

function vitalKey(vital: ReportVital): string {
  return [vital.name, vital.value ?? "", vital.unit ?? ""]
    .join("|")
    .toLowerCase();
}

/**
 * Merges reports produced from chunks of a long transcript. Deduplication is
 * conservative: identical items are collapsed, everything else is kept so a
 * clinician can review it.
 */
export function mergeReports(
  reports: ConsultationReport[],
  context: NormalizeContext,
): ConsultationReport {
  const merged = emptyReport(context);
  const warnings: string[] = [];

  for (const report of reports) {
    merged.summary = merged.summary ?? report.summary;

    merged.patient.age = merged.patient.age ?? report.patient.age;
    merged.patient.sex = merged.patient.sex ?? report.patient.sex;
    mergeStrings(merged.patient.identifiers, report.patient.identifiers);

    merged.chiefComplaint.text =
      merged.chiefComplaint.text ?? report.chiefComplaint.text;
    mergeStrings(merged.chiefComplaint.evidence, report.chiefComplaint.evidence);

    merged.subjective.historyOfPresentIllness =
      merged.subjective.historyOfPresentIllness ??
      report.subjective.historyOfPresentIllness;
    mergeItems(
      merged.subjective.symptoms,
      report.subjective.symptoms,
      symptomKey,
    );
    mergeStrings(
      merged.subjective.pastMedicalHistory,
      report.subjective.pastMedicalHistory,
    );
    mergeItems(
      merged.subjective.currentMedications,
      report.subjective.currentMedications,
      medicationKey,
    );
    mergeStrings(merged.subjective.allergies, report.subjective.allergies);
    mergeStrings(merged.subjective.familyHistory, report.subjective.familyHistory);
    mergeStrings(merged.subjective.socialHistory, report.subjective.socialHistory);
    mergeStrings(
      merged.subjective.reviewOfSystems,
      report.subjective.reviewOfSystems,
    );

    mergeItems(merged.objective.vitals, report.objective.vitals, vitalKey);
    mergeStrings(
      merged.objective.examinationFindings,
      report.objective.examinationFindings,
    );

    merged.assessment.impression =
      merged.assessment.impression ?? report.assessment.impression;
    mergeStrings(
      merged.assessment.differential,
      report.assessment.differential,
    );
    merged.assessment.statedBy =
      merged.assessment.statedBy ?? report.assessment.statedBy;
    mergeStrings(merged.assessment.evidence, report.assessment.evidence);

    mergeStrings(merged.plan.investigations, report.plan.investigations);
    mergeItems(merged.plan.medications, report.plan.medications, medicationKey);
    mergeStrings(merged.plan.advice, report.plan.advice);
    merged.plan.followUp = merged.plan.followUp ?? report.plan.followUp;

    mergeStrings(merged.redFlags, report.redFlags);
    mergeStrings(merged.gaps, report.gaps);
    mergeStrings(warnings, report.warnings);
  }

  if (context.segments.some((segment) => segment.speaker && !segment.role)) {
    warnings.push(
      "Speaker roles were not assigned; clinician/patient attribution may be incomplete.",
    );
  }
  if (reports.length > 1) {
    warnings.push(
      `The transcript was processed in ${reports.length} parts; review the merged report for duplicates or omitted context.`,
    );
  }
  if (!hasClinicalContent(merged)) {
    warnings.push("No clinical content was identified in the transcript.");
  }

  merged.warnings = uniqueStrings(warnings);
  merged.disclaimer = REPORT_DISCLAIMER;
  merged.meta.completeness =
    reports.length === 1
      ? reports[0].meta.completeness
      : deriveCompleteness(merged);

  return merged;
}

function parseRoleInput(value: unknown, label: string): SpeakerRole | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ReportInputError(`${label} must be a string when provided.`);
  }
  const role = value.trim().toLowerCase();
  if (!SPEAKER_ROLES.includes(role as SpeakerRole)) {
    throw new ReportInputError(
      `${label} must be one of: ${SPEAKER_ROLES.join(", ")}.`,
    );
  }
  return role as SpeakerRole;
}

/**
 * Validates `POST /api/report`. Returns only the fields the report service
 * needs, with trimmed text, unique ids and bounded lengths.
 */
export function validateReportRequest(body: unknown): ValidatedReportRequest {
  if (!isRecord(body)) {
    throw new ReportInputError("Request body must be a JSON object.");
  }

  const mode = body.mode === undefined ? "live" : body.mode;
  if (mode !== "live" && mode !== "batch") {
    throw new ReportInputError('`mode` must be "live" or "batch".');
  }

  if (!Array.isArray(body.segments)) {
    throw new ReportInputError("`segments` must be an array.");
  }
  if (body.segments.length === 0) {
    throw new ReportInputError(
      "`segments` must contain at least one segment.",
    );
  }
  if (body.segments.length > config.report.maxSegments) {
    throw new ReportInputError(
      `Too many segments in one request (maximum ${config.report.maxSegments}).`,
    );
  }

  const seen = new Set<string>();
  let totalChars = 0;

  const segments = body.segments.map((value, index) => {
    if (!isRecord(value)) {
      throw new ReportInputError(`segments[${index}] must be an object.`);
    }

    if (typeof value.id !== "string" || value.id.trim().length === 0) {
      throw new ReportInputError(
        `segments[${index}].id must be a non-empty string.`,
      );
    }
    const id = value.id.trim();
    if (id.length > 200) {
      throw new ReportInputError(`segments[${index}].id is too long.`);
    }
    if (seen.has(id)) {
      throw new ReportInputError(`segments[${index}].id is duplicated.`);
    }
    seen.add(id);

    if (typeof value.text !== "string" || value.text.trim().length === 0) {
      throw new ReportInputError(
        `segments[${index}].text must be a non-empty string.`,
      );
    }
    const text = value.text.trim();
    if (text.length > config.report.maxSegmentChars) {
      throw new ReportInputError(
        `segments[${index}].text is too long (maximum ${config.report.maxSegmentChars} characters).`,
      );
    }
    totalChars += text.length;

    const speaker =
      value.speaker === undefined || value.speaker === null
        ? null
        : typeof value.speaker === "string"
          ? cleanText(value.speaker, 80)
          : (() => {
              throw new ReportInputError(
                `segments[${index}].speaker must be a string when provided.`,
              );
            })();

    const language =
      value.language === undefined || value.language === null
        ? null
        : typeof value.language === "string"
          ? cleanText(value.language, 60)
          : (() => {
              throw new ReportInputError(
                `segments[${index}].language must be a string when provided.`,
              );
            })();

    const startTime =
      value.startTime === undefined || value.startTime === null
        ? null
        : readNumber(value.startTime);
    if (
      value.startTime !== undefined &&
      value.startTime !== null &&
      startTime === null
    ) {
      throw new ReportInputError(
        `segments[${index}].startTime must be a non-negative number.`,
      );
    }

    const endTime =
      value.endTime === undefined || value.endTime === null
        ? null
        : readNumber(value.endTime);
    if (
      value.endTime !== undefined &&
      value.endTime !== null &&
      endTime === null
    ) {
      throw new ReportInputError(
        `segments[${index}].endTime must be a non-negative number.`,
      );
    }

    return {
      id,
      text,
      speaker,
      role: parseRoleInput(value.role, `segments[${index}].role`),
      startTime,
      endTime,
      language,
    } satisfies ReportSegmentInput;
  });

  if (totalChars > config.report.maxInputChars) {
    throw new ReportInputError(
      `Transcript is too large for one report (maximum ${config.report.maxInputChars} characters).`,
      413,
    );
  }

  return { mode, segments };
}

function chunkSegments(
  segments: ReportSegmentInput[],
  maxChars: number,
): ReportSegmentInput[][] {
  const chunks: ReportSegmentInput[][] = [];
  let current: ReportSegmentInput[] = [];
  let currentChars = 0;

  for (const segment of segments) {
    if (
      current.length > 0 &&
      currentChars + segment.text.length > maxChars
    ) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(segment);
    currentChars += segment.text.length;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

const STRING = { type: "STRING" } as const;
const STRING_LIST = { type: "ARRAY", items: STRING } as const;
const EVIDENCE = { type: "ARRAY", items: STRING } as const;
const ROLE = {
  type: "STRING",
  enum: ["clinician", "patient", "other", "unknown"],
} as const;

const MEDICATION_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: STRING,
    strength: STRING,
    dose: STRING,
    frequency: STRING,
    duration: STRING,
    route: STRING,
    instructions: STRING,
    statedBy: ROLE,
    evidence: EVIDENCE,
  },
  required: [
    "name",
    "strength",
    "dose",
    "frequency",
    "duration",
    "route",
    "instructions",
    "statedBy",
    "evidence",
  ],
} as const;

const SYMPTOM_SCHEMA = {
  type: "OBJECT",
  properties: {
    symptom: STRING,
    onset: STRING,
    duration: STRING,
    severity: STRING,
    aggravatingFactors: STRING,
    relievingFactors: STRING,
    evidence: EVIDENCE,
  },
  required: [
    "symptom",
    "onset",
    "duration",
    "severity",
    "aggravatingFactors",
    "relievingFactors",
    "evidence",
  ],
} as const;

const VITAL_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: STRING,
    value: STRING,
    unit: STRING,
    evidence: EVIDENCE,
  },
  required: ["name", "value", "unit", "evidence"],
} as const;

const REPORT_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: STRING,
    patient: {
      type: "OBJECT",
      properties: {
        age: STRING,
        sex: STRING,
        identifiers: STRING_LIST,
      },
      required: ["age", "sex", "identifiers"],
    },
    chiefComplaint: {
      type: "OBJECT",
      properties: { text: STRING, evidence: EVIDENCE },
      required: ["text", "evidence"],
    },
    subjective: {
      type: "OBJECT",
      properties: {
        historyOfPresentIllness: STRING,
        symptoms: { type: "ARRAY", items: SYMPTOM_SCHEMA },
        pastMedicalHistory: STRING_LIST,
        currentMedications: { type: "ARRAY", items: MEDICATION_SCHEMA },
        allergies: STRING_LIST,
        familyHistory: STRING_LIST,
        socialHistory: STRING_LIST,
        reviewOfSystems: STRING_LIST,
      },
      required: [
        "historyOfPresentIllness",
        "symptoms",
        "pastMedicalHistory",
        "currentMedications",
        "allergies",
        "familyHistory",
        "socialHistory",
        "reviewOfSystems",
      ],
    },
    objective: {
      type: "OBJECT",
      properties: {
        vitals: { type: "ARRAY", items: VITAL_SCHEMA },
        examinationFindings: STRING_LIST,
      },
      required: ["vitals", "examinationFindings"],
    },
    assessment: {
      type: "OBJECT",
      properties: {
        impression: STRING,
        differential: STRING_LIST,
        statedBy: ROLE,
        evidence: EVIDENCE,
      },
      required: ["impression", "differential", "statedBy", "evidence"],
    },
    plan: {
      type: "OBJECT",
      properties: {
        investigations: STRING_LIST,
        medications: { type: "ARRAY", items: MEDICATION_SCHEMA },
        advice: STRING_LIST,
        followUp: STRING,
      },
      required: ["investigations", "medications", "advice", "followUp"],
    },
    redFlags: STRING_LIST,
    gaps: STRING_LIST,
    warnings: STRING_LIST,
    completeness: {
      type: "STRING",
      enum: ["complete", "partial", "limited"],
    },
  },
  required: [
    "summary",
    "patient",
    "chiefComplaint",
    "subjective",
    "objective",
    "assessment",
    "plan",
    "redFlags",
    "gaps",
    "warnings",
    "completeness",
  ],
} as const;

const SYSTEM_PROMPT = [
  "You are a clinical documentation assistant. Convert a consultation transcript into a structured report for clinician review.",
  "",
  "Rules:",
  "1. Extract only information explicitly present in the transcript. Never infer, diagnose, prescribe, calculate or fill gaps.",
  "2. If no assessment was stated by the clinician, leave assessment.impression empty and assessment.differential empty. Do not invent one.",
  "3. Preserve medicine names, strengths, doses, frequencies, durations and numbers exactly as spoken. Never change or calculate a dose.",
  "4. Use the speaker labels and roles provided. If a role is unknown, attribute the statement to that speaker label but do not call them doctor or patient.",
  "5. Put the exact supporting segment ids in each item's evidence array. Use only ids from the input and only when they directly support the item.",
  "6. Use an empty string for a missing text field and an empty array for a missing list. Never write \"not stated\", \"unknown\" or \"n/a\" in a field.",
  "7. currentMedications is what the patient already takes. plan.medications is what the clinician prescribes or advises in this consultation.",
  "8. redFlags contains only urgent symptoms or findings explicitly mentioned.",
  "9. gaps lists clinically expected information that was not discussed.",
  "10. Return only JSON matching the schema. Do not add commentary, headings or explanations.",
].join("\n");

function buildPrompt(
  segments: ReportSegmentInput[],
  mode: ConsultationSource,
): string {
  const speakerRoles = new Map<string, SpeakerRole>();
  for (const segment of segments) {
    if (segment.speaker && segment.role && !speakerRoles.has(segment.speaker)) {
      speakerRoles.set(segment.speaker, segment.role);
    }
  }

  const speakers = uniqueStrings(
    segments.map((segment) => segment.speaker),
  ).map((label) => ({
    label,
    role: speakerRoles.get(label) ?? "unknown",
  }));

  const payload = {
    source: mode,
    speakers,
    segments: segments.map((segment) => ({
      id: segment.id,
      speaker: segment.speaker ?? "Unattributed",
      role: segment.role ?? "unknown",
      time:
        segment.startTime !== null && segment.endTime !== null
          ? `${segment.startTime}s-${segment.endTime}s`
          : null,
      language: segment.language ?? "unknown",
      text: segment.text,
    })),
  };

  return `Consultation transcript:\n${JSON.stringify(payload)}`;
}

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
    throw new ReportError(
      "invalid_response",
      "The report service returned an unreadable response.",
    );
  }
}

function extractCandidateText(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const candidates = body.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const content = isRecord(candidates[0]) ? candidates[0].content : null;
  if (!isRecord(content) || !Array.isArray(content.parts)) return null;

  const text = content.parts
    .map((part) =>
      isRecord(part) && typeof part.text === "string" ? part.text : "",
    )
    .join("");

  return text.trim() ? text : null;
}

function upstreamMessage(status: number, body: unknown): string {
  if (isRecord(body)) {
    const error = body.error;
    if (isRecord(error) && typeof error.message === "string") {
      return error.message;
    }
  }
  return `Report service returned HTTP ${status}.`;
}

async function requestReport(
  segments: ReportSegmentInput[],
  mode: ConsultationSource,
): Promise<unknown> {
  const { apiKey, model, baseUrl, timeoutMs } = config.report;
  if (!reportConfigured()) {
    throw new ReportError(
      "not_configured",
      "Report generation is not configured on the server.",
      503,
    );
  }

  const requestBody = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: buildPrompt(segments, mode) }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: REPORT_SCHEMA,
      maxOutputTokens: config.report.maxOutputTokens,
    },
  };

  let lastError: ReportError | null = null;
  const attempts = Math.max(0, config.report.maxRetries) + 1;

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
      const aborted =
        (error as Error).name === "AbortError" ||
        (error as Error).name === "TimeoutError";
      lastError = new ReportError(
        aborted ? "timeout" : "upstream_error",
        aborted
          ? "Report generation took too long to respond."
          : "Could not reach the report service.",
      );
      if (aborted) throw lastError;
      continue;
    }

    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      if (response.status === 429) {
        throw new ReportError(
          "rate_limited",
          "The report service is rate limited. Try again shortly.",
          429,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new ReportError(
          "not_configured",
          "The report service rejected the server credentials.",
          503,
        );
      }

      lastError = new ReportError(
        "upstream_error",
        upstreamMessage(response.status, body),
        response.status,
      );
      if (response.status < 500) throw lastError;
      continue;
    }

    try {
      const text = extractCandidateText(body);
      if (!text) {
        throw new ReportError(
          "invalid_response",
          "The report service returned an empty response.",
        );
      }
      const parsed = extractJson(text);
      if (!isRecord(parsed)) {
        throw new ReportError(
          "invalid_response",
          "The report service returned an unexpected response.",
        );
      }
      return parsed;
    } catch (error) {
      lastError =
        error instanceof ReportError
          ? error
          : new ReportError(
              "invalid_response",
              "The report service returned an unexpected response.",
            );
    }
  }

  throw (
    lastError ??
    new ReportError("upstream_error", "Report generation failed.")
  );
}

/**
 * Generates a structured consultation report from validated segments.
 *
 * Long transcripts are split at segment boundaries and merged. Every chunk is
 * validated independently, so a malformed response cannot poison the whole
 * report.
 */
export async function generateConsultationReport(
  body: unknown,
): Promise<ReportServiceResult> {
  if (!config.report.enabled) {
    throw new ReportError(
      "disabled",
      "Report generation is disabled on the server.",
      503,
    );
  }

  const input = validateReportRequest(body);

  if (!reportConfigured()) {
    throw new ReportError(
      "not_configured",
      "Report generation is not configured on the server.",
      503,
    );
  }

  const generatedAt = new Date().toISOString();
  const chunks = chunkSegments(input.segments, config.report.chunkChars);

  try {
    const partials: ConsultationReport[] = [];
    for (const chunk of chunks) {
      const raw = await requestReport(chunk, input.mode);
      partials.push(
        normalizeReport(raw, {
          mode: input.mode,
          segments: chunk,
          generatedAt,
        }),
      );
    }

    const report = mergeReports(partials, {
      mode: input.mode,
      segments: input.segments,
      generatedAt,
    });

    logger.info("Consultation report generated", {
      segments: input.segments.length,
      chunks: chunks.length,
      completeness: report.meta.completeness,
      warnings: report.warnings.length,
    });

    return { model: config.report.model, generatedAt, report };
  } catch (error) {
    const reportError =
      error instanceof ReportError
        ? error
        : new ReportError("upstream_error", "Report generation failed.");
    logger.warn("Consultation report failed", {
      code: reportError.code,
      status: reportError.status,
      segments: input.segments.length,
      message: reportError.message,
    });
    throw reportError;
  }
}
