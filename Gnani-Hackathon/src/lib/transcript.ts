import type { TranscriptSegment } from "../hooks/useAudioStreaming";
import { formatClock, formatDate, formatDuration } from "./format";
import type {
  ConsultationSummary,
  SessionRecord,
  TranslationLanguage,
  TranslationResult,
} from "./types";

export interface ViewSegment {
  key: string;
  text: string;
  timeMs: number;
  language?: string;
  /** Display label like "Speaker 1" when the segment is diarized. */
  speaker?: string;
}

export interface TranscriptMeta {
  fileName: string;
  language: string;
  durationMs: number;
  status: string;
  createdAt: string;
  sourceLabel: string;
}

export interface TranscriptOptions {
  clinicalLabels: boolean;
}

export function formatSegment(segment: TranscriptSegment): string {
  const time = formatClock((segment.startTime ?? 0) * 1000);
  return `[${time}] ${segment.text}`;
}

export function toViewSegments(
  segments: TranscriptSegment[],
): ViewSegment[] {
  return segments.map((segment, index) => ({
    key: segment.key || `segment-${index}`,
    text: segment.text,
    timeMs: Math.max(0, Math.round((segment.startTime ?? 0) * 1000)),
    language: segment.language?.name,
    speaker:
      segment.speakerId != null ? `Speaker ${segment.speakerId + 1}` : undefined,
  }));
}

export function countWords(segments: TranscriptSegment[]): number {
  return segments.reduce((total, segment) => {
    const words = segment.text.trim().split(/\s+/).filter(Boolean);
    return total + words.length;
  }, 0);
}

export function detectLanguage(segments: TranscriptSegment[]): string {
  const names = segments
    .map((segment) => segment.language?.name)
    .filter((name): name is string => Boolean(name) && name !== "Auto-detect");
  if (names.length === 0) return "Auto-detect";
  return names[0];
}

export function transcriptHeader(meta: TranscriptMeta): string[] {
  return [
    "VoxNote — Consultation transcript",
    `File: ${meta.fileName}`,
    `Language: ${meta.language}`,
    `Duration: ${formatDuration(meta.durationMs)}`,
    `Status: ${meta.status}`,
    `Source: ${meta.sourceLabel}`,
    `Created: ${formatDate(meta.createdAt)}`,
  ];
}

export function buildTranscriptText(
  segments: TranscriptSegment[],
  meta: TranscriptMeta,
): string {
  const lines = transcriptHeader(meta);
  lines.push("");
  if (segments.length === 0) {
    lines.push("(No transcript segments yet.)");
  } else {
    for (const segment of segments) {
      lines.push(formatSegment(segment));
    }
  }
  return lines.join("\n");
}

export function buildTranslationText(
  original: TranscriptSegment[],
  translation: TranslationResult,
  meta: TranscriptMeta,
  targetLabel: string,
): string {
  const byKey = new Map(translation.segments.map((entry) => [entry.key, entry.text]));
  const lines = [
    "VoxNote — Translated transcript",
    `File: ${meta.fileName}`,
    `Source language: ${meta.language}`,
    `Target language: ${targetLabel}`,
    `Duration: ${formatDuration(meta.durationMs)}`,
    `Created: ${formatDate(meta.createdAt)}`,
    translation.model ? `Model: ${translation.model}` : "",
  ].filter(Boolean);
  lines.push("");
  if (translation.segments.length === 0) {
    lines.push("(No translated segments yet.)");
  } else {
    original.forEach((segment, index) => {
      const key = segment.key || `segment-${index}`;
      const text = byKey.get(key) ?? segment.text;
      const time = formatClock((segment.startTime ?? 0) * 1000);
      lines.push(`[${time}] ${text}`);
    });
  }
  return lines.join("\n");
}

export function buildTranscriptJson(
  segments: TranscriptSegment[],
  meta: TranscriptMeta,
): string {
  return JSON.stringify(
    {
      product: "VoxNote",
      kind: "transcript",
      meta,
      segments: segments.map((segment, index) => ({
        index,
        text: segment.text,
        startSeconds: segment.startTime ?? 0,
        endSeconds: segment.endTime ?? null,
        language: segment.language?.name ?? null,
      })),
    },
    null,
    2,
  );
}

export function buildTranslationJson(
  original: TranscriptSegment[],
  translation: TranslationResult,
  meta: TranscriptMeta,
): string {
  const byKey = new Map(translation.segments.map((entry) => [entry.key, entry.text]));
  return JSON.stringify(
    {
      product: "VoxNote",
      kind: "translation",
      sourceLanguage: meta.language,
      targetLanguage: translation.targetLanguage,
      model: translation.model ?? null,
      generatedAt: translation.generatedAt,
      segments: original.map((segment, index) => ({
        text: byKey.get(segment.key || `segment-${index}`) ?? segment.text,
        sourceText: segment.text,
        startSeconds: segment.startTime ?? 0,
        language: segment.language?.name ?? null,
      })),
    },
    null,
    2,
  );
}

export function summaryToText(
  summary: ConsultationSummary,
  meta: TranscriptMeta,
): string {
  const list = (items: string[]) =>
    items.length > 0 ? items.map((item) => `  • ${item}`).join("\n") : "  • Not stated";
  const lines = [
    "VoxNote — Clinical summary",
    `File: ${meta.fileName}`,
    `Language: ${meta.language}`,
    `Duration: ${formatDuration(meta.durationMs)}`,
    `Created: ${formatDate(meta.createdAt)}`,
  ];
  lines.push(
    "",
    summary.headline,
    "",
    "CHIEF COMPLAINT",
    summary.chiefComplaint || "Not stated",
    "",
    "SYMPTOMS",
    list(summary.symptoms),
    "",
    "HISTORY",
    summary.history || "Not stated",
    "",
    "MEDICATIONS",
    list(summary.medications),
    "",
    "FLAGGED MEDICATIONS",
    summary.medicationFlags?.length
      ? summary.medicationFlags.map((item) => `  • ${item}`).join("\n")
      : "  • None",
    "",
    "ASSESSMENT",
    summary.assessment || "Not stated",
    "",
    "PLAN",
    list(summary.plan),
    "",
    "FOLLOW-UP",
    summary.followUp || "Not stated",
    "",
    "RED FLAGS",
    list(summary.redFlags),
  );
  return lines.join("\n");
}

export function summaryToJson(
  summary: ConsultationSummary,
  meta: TranscriptMeta,
  model?: string,
): string {
  return JSON.stringify(
    {
      product: "VoxNote",
      kind: "clinical-summary",
      meta,
      model: model ?? null,
      summary,
    },
    null,
    2,
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

export function downloadText(fileName: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function metaForRecord(record: SessionRecord): TranscriptMeta {
  return {
    fileName: record.fileName,
    language: record.language,
    durationMs: record.durationMs,
    status: record.status,
    createdAt: record.createdAt,
    sourceLabel: record.source === "upload" ? "Uploaded file" : "Live session",
  };
}

export function targetLanguageLabel(language: TranslationLanguage): string {
  switch (language) {
    case "hi":
      return "Hindi";
    case "hinglish":
      return "Hinglish";
    default:
      return "English";
  }
}
