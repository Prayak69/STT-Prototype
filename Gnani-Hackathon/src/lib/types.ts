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
