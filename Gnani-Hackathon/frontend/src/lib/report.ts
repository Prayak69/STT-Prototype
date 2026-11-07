import type { TranscriptSegment } from "../hooks/useAudioStreaming";
import { formatDuration } from "./format";

/** Frontend mirror of the report shape returned by `POST /api/report`. */
export type ConsultationSource = "live" | "batch";
export type SpeakerRole = "clinician" | "patient" | "other" | "unknown";
export type ReportCompleteness = "complete" | "partial" | "limited";

export const SPEAKER_ROLES: readonly SpeakerRole[] = [
  "clinician",
  "patient",
  "other",
  "unknown",
];

export const SPEAKER_ROLE_LABELS: Record<SpeakerRole, string> = {
  clinician: "Clinician",
  patient: "Patient",
  other: "Other",
  unknown: "Not assigned",
};

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
  chiefComplaint: {
    text: string | null;
    evidence: string[];
  };
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

/** Speaker badge used by the transcript panel, e.g. "Speaker 1". */
export function segmentSpeakerLabel(segment: TranscriptSegment): string | null {
  return segment.speakerId !== undefined && segment.speakerId !== null
    ? `Speaker ${segment.speakerId}`
    : null;
}

function medicationLine(medication: ReportMedication): string {
  const details = [
    medication.strength,
    medication.dose,
    medication.frequency,
    medication.duration,
    medication.route,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  const instructions = medication.instructions
    ? ` — ${medication.instructions}`
    : "";
  const statedBy = medication.statedBy ? ` (${medication.statedBy})` : "";
  return `- **${medication.name}**${details ? ` — ${details}` : ""}${instructions}${statedBy}`;
}

function symptomLine(symptom: ReportSymptom): string {
  const details = [
    symptom.onset ? `onset: ${symptom.onset}` : null,
    symptom.duration ? `duration: ${symptom.duration}` : null,
    symptom.severity ? `severity: ${symptom.severity}` : null,
    symptom.aggravatingFactors
      ? `worse with: ${symptom.aggravatingFactors}`
      : null,
    symptom.relievingFactors
      ? `better with: ${symptom.relievingFactors}`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  return `- **${symptom.symptom}**${details ? ` — ${details}` : ""}`;
}

function bulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function section(title: string, body: string): string {
  return `## ${title}\n\n${body}`;
}

function subSection(title: string, body: string): string {
  return `### ${title}\n\n${body}`;
}

/** Human-readable Markdown export for copy/paste into a note. */
export function reportToMarkdown(report: ConsultationReport): string {
  const parts: string[] = ["# Consultation Report"];

  const meta = [
    `Generated: ${new Date(report.meta.generatedAt).toLocaleString()}`,
    `Source: ${report.meta.source === "batch" ? "Batch upload" : "Live session"}`,
    report.meta.durationSeconds !== null
      ? `Duration: ${formatDuration(report.meta.durationSeconds * 1000)}`
      : null,
    report.meta.languages.length > 0
      ? `Languages: ${report.meta.languages.join(", ")}`
      : null,
    report.meta.speakerCount !== null
      ? `Speakers: ${report.meta.speakerCount}`
      : null,
    `Completeness: ${report.meta.completeness}`,
  ].filter((value): value is string => Boolean(value));

  parts.push(meta.join("\n"));
  parts.push(`> ${report.disclaimer}`);

  if (report.summary) parts.push(section("Summary", report.summary));

  const patient = [
    report.patient.age ? `- Age: ${report.patient.age}` : null,
    report.patient.sex ? `- Sex: ${report.patient.sex}` : null,
    ...report.patient.identifiers.map((identifier) => `- ${identifier}`),
  ].filter((value): value is string => Boolean(value));

  if (patient.length > 0) parts.push(section("Patient", patient.join("\n")));

  parts.push(
    section(
      "Chief Complaint",
      report.chiefComplaint.text ?? "Not documented.",
    ),
  );

  const subjective: string[] = [];
  if (report.subjective.historyOfPresentIllness) {
    subjective.push(
      subSection(
        "History of Present Illness",
        report.subjective.historyOfPresentIllness,
      ),
    );
  }
  if (report.subjective.symptoms.length > 0) {
    subjective.push(
      subSection(
        "Symptoms",
        report.subjective.symptoms.map(symptomLine).join("\n"),
      ),
    );
  }
  if (report.subjective.pastMedicalHistory.length > 0) {
    subjective.push(
      subSection(
        "Past Medical History",
        bulletList(report.subjective.pastMedicalHistory),
      ),
    );
  }
  if (report.subjective.currentMedications.length > 0) {
    subjective.push(
      subSection(
        "Current Medications",
        report.subjective.currentMedications.map(medicationLine).join("\n"),
      ),
    );
  }
  if (report.subjective.allergies.length > 0) {
    subjective.push(
      subSection("Allergies", bulletList(report.subjective.allergies)),
    );
  }
  if (report.subjective.familyHistory.length > 0) {
    subjective.push(
      subSection("Family History", bulletList(report.subjective.familyHistory)),
    );
  }
  if (report.subjective.socialHistory.length > 0) {
    subjective.push(
      subSection("Social History", bulletList(report.subjective.socialHistory)),
    );
  }
  if (report.subjective.reviewOfSystems.length > 0) {
    subjective.push(
      subSection(
        "Review of Systems",
        bulletList(report.subjective.reviewOfSystems),
      ),
    );
  }
  parts.push(
    section(
      "Subjective",
      subjective.length > 0 ? subjective.join("\n\n") : "Not documented.",
    ),
  );

  const objective: string[] = [];
  if (report.objective.vitals.length > 0) {
    objective.push(
      subSection(
        "Vitals",
        report.objective.vitals
          .map((vital) => {
            const value = [vital.value, vital.unit]
              .filter((item): item is string => Boolean(item))
              .join(" ");
            return `- **${vital.name}**${value ? `: ${value}` : ""}`;
          })
          .join("\n"),
      ),
    );
  }
  if (report.objective.examinationFindings.length > 0) {
    objective.push(
      subSection(
        "Examination Findings",
        bulletList(report.objective.examinationFindings),
      ),
    );
  }
  parts.push(
    section(
      "Objective",
      objective.length > 0 ? objective.join("\n\n") : "Not documented.",
    ),
  );

  const assessment: string[] = [
    report.assessment.impression
      ? `**Impression:** ${report.assessment.impression}`
      : "**Impression:** Not documented.",
  ];
  if (report.assessment.differential.length > 0) {
    assessment.push(
      `**Differential:**\n${bulletList(report.assessment.differential)}`,
    );
  }
  parts.push(section("Assessment", assessment.join("\n\n")));

  const plan: string[] = [];
  if (report.plan.investigations.length > 0) {
    plan.push(
      subSection(
        "Investigations",
        bulletList(report.plan.investigations),
      ),
    );
  }
  if (report.plan.medications.length > 0) {
    plan.push(
      subSection(
        "Medications",
        report.plan.medications.map(medicationLine).join("\n"),
      ),
    );
  }
  if (report.plan.advice.length > 0) {
    plan.push(subSection("Advice", bulletList(report.plan.advice)));
  }
  if (report.plan.followUp) {
    plan.push(subSection("Follow-up", report.plan.followUp));
  }
  parts.push(
    section("Plan", plan.length > 0 ? plan.join("\n\n") : "Not documented."),
  );

  if (report.redFlags.length > 0) {
    parts.push(section("Red Flags", bulletList(report.redFlags)));
  }
  if (report.gaps.length > 0) {
    parts.push(section("Gaps", bulletList(report.gaps)));
  }
  if (report.warnings.length > 0) {
    parts.push(section("Warnings", bulletList(report.warnings)));
  }

  return `${parts.join("\n\n")}\n`;
}

export function reportFileName(report: ConsultationReport): string {
  const date = report.meta.generatedAt.slice(0, 10) || "report";
  return `consultation-report-${date}.json`;
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
