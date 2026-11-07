/**
 * Types for the structured consultation report.
 *
 * The report is a derived artifact built from finished transcript segments. It
 * never replaces the raw transcript and every extracted item can point back to
 * the segment ids it came from.
 */

export type ConsultationSource = "live" | "batch";

export type SpeakerRole = "clinician" | "patient" | "other" | "unknown";

export const SPEAKER_ROLES: readonly SpeakerRole[] = [
  "clinician",
  "patient",
  "other",
  "unknown",
];

export type ReportCompleteness = "complete" | "partial" | "limited";

/** One validated segment accepted by `POST /api/report`. */
export interface ReportSegmentInput {
  id: string;
  text: string;
  speaker: string | null;
  role: SpeakerRole | null;
  startTime: number | null;
  endTime: number | null;
  language: string | null;
}

export interface ValidatedReportRequest {
  mode: ConsultationSource;
  segments: ReportSegmentInput[];
}

export interface ReportMedication {
  name: string;
  strength: string | null;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  route: string | null;
  instructions: string | null;
  statedBy: SpeakerRole | null;
  evidence: string[];
}

export interface ReportSymptom {
  symptom: string;
  onset: string | null;
  duration: string | null;
  severity: string | null;
  aggravatingFactors: string | null;
  relievingFactors: string | null;
  evidence: string[];
}

export interface ReportVital {
  name: string;
  value: string | null;
  unit: string | null;
  evidence: string[];
}

export interface ReportEvidenceSection {
  text: string | null;
  evidence: string[];
}

export interface ConsultationReport {
  meta: {
    source: ConsultationSource;
    generatedAt: string;
    durationSeconds: number | null;
    languages: string[];
    speakerCount: number | null;
    segmentCount: number;
    completeness: ReportCompleteness;
  };
  summary: string | null;
  patient: {
    age: string | null;
    sex: string | null;
    identifiers: string[];
  };
  chiefComplaint: ReportEvidenceSection;
  subjective: {
    historyOfPresentIllness: string | null;
    symptoms: ReportSymptom[];
    pastMedicalHistory: string[];
    currentMedications: ReportMedication[];
    allergies: string[];
    familyHistory: string[];
    socialHistory: string[];
    reviewOfSystems: string[];
  };
  objective: {
    vitals: ReportVital[];
    examinationFindings: string[];
  };
  assessment: {
    impression: string | null;
    differential: string[];
    statedBy: SpeakerRole | null;
    evidence: string[];
  };
  plan: {
    investigations: string[];
    medications: ReportMedication[];
    advice: string[];
    followUp: string | null;
  };
  redFlags: string[];
  gaps: string[];
  warnings: string[];
  disclaimer: string;
}

export interface ReportServiceResult {
  model: string;
  generatedAt: string;
  report: ConsultationReport;
}

export interface ReportHealth {
  configured: boolean;
  model: string;
}
