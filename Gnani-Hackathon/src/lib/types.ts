import type { TranscriptSegment } from "../hooks/useAudioStreaming";

export type PageKey = "dashboard" | "transcriptions" | "settings";

export type RailTab = "transcript" | "translation" | "summary" | "details";

export type TranslationLanguage = "en" | "hi" | "hinglish";

export type SessionSource = "live" | "upload";

export interface ConsultationSummary {
  headline: string;
  chiefComplaint: string;
  symptoms: string[];
  history: string;
  medications: string[];
  /** Medicines that sound like no real drug and could not be confidently corrected. */
  medicationFlags: string[];
  assessment: string;
  plan: string[];
  followUp: string;
  redFlags: string[];
}

export interface SessionRecord {
  id: string;
  fileName: string;
  language: string;
  durationMs: number;
  createdAt: string;
  status: "Completed" | "Processing" | "Failed";
  source: SessionSource;
  segments: TranscriptSegment[];
  summary?: ConsultationSummary;
  notes?: string;
}

export interface AppSettings {
  targetLanguage: TranslationLanguage;
  autoTranslate: boolean;
}

export interface AiStatus {
  configured: boolean;
  provider: string;
  model: string;
}

export interface AiInsightRequestSegment {
  index: number;
  timestamp: string;
  text: string;
  /** "Speaker 1" ... when the transcript is diarized. */
  speaker?: string;
}

export interface AiInsightRequestPayload {
  fileName: string;
  language: string;
  targetLanguage: TranslationLanguage;
  segments: AiInsightRequestSegment[];
}

export interface InsightsPayload {
  summary: ConsultationSummary;
  translation: {
    segments: Array<{ index: number; text: string }>;
    targetLanguage: TranslationLanguage;
  };
  model?: string;
  generatedAt?: string;
}

export interface TranslationSegmentResult {
  key: string;
  text: string;
}

export interface TranslationResult {
  segments: TranslationSegmentResult[];
  targetLanguage: TranslationLanguage;
  model?: string;
  generatedAt: string;
}
