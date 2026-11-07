import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Copy,
  Download,
  FileText,
  Loader2,
  Printer,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { ConsultationReportState } from "../hooks/useConsultationReport";
import type { TranscriptSegment } from "../hooks/useAudioStreaming";
import { formatDuration } from "../lib/format";
import {
  SPEAKER_ROLES,
  SPEAKER_ROLE_LABELS,
  copyText,
  reportFileName,
  reportToMarkdown,
  type ConsultationReport,
  type ReportCompleteness,
  type ReportMedication,
  type ReportSymptom,
  type ReportVital,
  type SpeakerRole,
} from "../lib/report";

interface ConsultationReportPanelProps {
  segments: TranscriptSegment[];
  report: ConsultationReport | null;
  state: ConsultationReportState;
  error: string | null;
  configured: boolean | null;
  availabilityError: string | null;
  speakers: string[];
  roles: Record<string, SpeakerRole>;
  isStale: boolean;
  onRoleChange: (speaker: string, role: SpeakerRole) => void;
  onGenerate: () => void;
  onReset: () => void;
  onJumpToSegment?: (id: string) => void;
}

const COMPLETENESS_STYLES: Record<ReportCompleteness, string> = {
  complete: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  partial: "bg-amber-50 text-amber-700 ring-amber-100",
  limited: "bg-rose-50 text-rose-700 ring-rose-100",
};

function jumpToSegment(id: string): void {
  const element = document.getElementById(`transcript-segment-${id}`);
  if (!element) return;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.classList.add("ring-2", "ring-indigo-300");
  window.setTimeout(() => {
    element.classList.remove("ring-2", "ring-indigo-300");
  }, 1600);
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-slate-100 px-4 py-4 sm:px-5">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {title}
      </h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </h4>
  );
}

function MetaChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
      {children}
    </span>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-400">Not documented.</p>;
  }
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function EvidenceLinks({
  ids,
  segments,
  onJump,
}: {
  ids: string[];
  segments: TranscriptSegment[];
  onJump?: (id: string) => void;
}) {
  if (ids.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">
        Source
      </span>
      {ids.map((id) => {
        const index = segments.findIndex((segment) => segment.key === id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => (onJump ? onJump(id) : jumpToSegment(id))}
            title="Jump to transcript segment"
            className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            {index >= 0 ? `#${index}` : id.slice(0, 6)}
          </button>
        );
      })}
    </div>
  );
}

function MedicationList({
  medications,
  segments,
  onJump,
}: {
  medications: ReportMedication[];
  segments: TranscriptSegment[];
  onJump?: (id: string) => void;
}) {
  if (medications.length === 0) {
    return <p className="text-sm text-slate-400">Not documented.</p>;
  }

  return (
    <ul className="space-y-2">
      {medications.map((medication, index) => {
        const details = [
          medication.strength,
          medication.dose,
          medication.frequency,
          medication.duration,
          medication.route,
        ]
          .filter((value): value is string => Boolean(value))
          .join(" · ");

        return (
          <li
            key={`${medication.name}-${index}`}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">
                {medication.name}
              </span>
              {medication.statedBy && (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                  {SPEAKER_ROLE_LABELS[medication.statedBy]}
                </span>
              )}
            </div>
            {details && (
              <p className="mt-0.5 text-xs leading-5 text-slate-500">
                {details}
              </p>
            )}
            {medication.instructions && (
              <p className="mt-0.5 text-xs leading-5 text-slate-500">
                {medication.instructions}
              </p>
            )}
            <EvidenceLinks
              ids={medication.evidence}
              segments={segments}
              onJump={onJump}
            />
          </li>
        );
      })}
    </ul>
  );
}

function SymptomList({
  symptoms,
  segments,
  onJump,
}: {
  symptoms: ReportSymptom[];
  segments: TranscriptSegment[];
  onJump?: (id: string) => void;
}) {
  if (symptoms.length === 0) {
    return <p className="text-sm text-slate-400">Not documented.</p>;
  }

  return (
    <ul className="space-y-2">
      {symptoms.map((symptom, index) => {
        const details = [
          symptom.onset ? `Onset: ${symptom.onset}` : null,
          symptom.duration ? `Duration: ${symptom.duration}` : null,
          symptom.severity ? `Severity: ${symptom.severity}` : null,
          symptom.aggravatingFactors
            ? `Worse with: ${symptom.aggravatingFactors}`
            : null,
          symptom.relievingFactors
            ? `Better with: ${symptom.relievingFactors}`
            : null,
        ]
          .filter((value): value is string => Boolean(value))
          .join(" · ");

        return (
          <li
            key={`${symptom.symptom}-${index}`}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2"
          >
            <p className="text-sm font-medium text-slate-800">
              {symptom.symptom}
            </p>
            {details && (
              <p className="mt-0.5 text-xs leading-5 text-slate-500">
                {details}
              </p>
            )}
            <EvidenceLinks
              ids={symptom.evidence}
              segments={segments}
              onJump={onJump}
            />
          </li>
        );
      })}
    </ul>
  );
}

function VitalList({
  vitals,
  segments,
  onJump,
}: {
  vitals: ReportVital[];
  segments: TranscriptSegment[];
  onJump?: (id: string) => void;
}) {
  if (vitals.length === 0) {
    return <p className="text-sm text-slate-400">Not documented.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {vitals.map((vital, index) => {
        const value = [vital.value, vital.unit]
          .filter((item): item is string => Boolean(item))
          .join(" ");
        return (
          <li key={`${vital.name}-${index}`}>
            <div className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="font-medium text-slate-800">{vital.name}</span>
              <span className="text-slate-600">{value || "Recorded"}</span>
            </div>
            <EvidenceLinks ids={vital.evidence} segments={segments} onJump={onJump} />
          </li>
        );
      })}
    </ul>
  );
}

function ReportBody({
  report,
  segments,
  onJump,
}: {
  report: ConsultationReport;
  segments: TranscriptSegment[];
  onJump?: (id: string) => void;
}) {
  const hasSubjective = Boolean(
    report.subjective.historyOfPresentIllness ||
      report.subjective.symptoms.length > 0 ||
      report.subjective.pastMedicalHistory.length > 0 ||
      report.subjective.currentMedications.length > 0 ||
      report.subjective.allergies.length > 0 ||
      report.subjective.familyHistory.length > 0 ||
      report.subjective.socialHistory.length > 0 ||
      report.subjective.reviewOfSystems.length > 0,
  );
  const hasObjective = Boolean(
    report.objective.vitals.length > 0 ||
      report.objective.examinationFindings.length > 0,
  );
  const hasPlan = Boolean(
    report.plan.investigations.length > 0 ||
      report.plan.medications.length > 0 ||
      report.plan.advice.length > 0 ||
      report.plan.followUp,
  );

  return (
    <div>
      <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <MetaChip>
            {report.meta.source === "batch" ? "Batch upload" : "Live session"}
          </MetaChip>
          {report.meta.durationSeconds !== null && (
            <MetaChip>
              {formatDuration(report.meta.durationSeconds * 1000)}
            </MetaChip>
          )}
          {report.meta.languages.map((language) => (
            <MetaChip key={language}>{language}</MetaChip>
          ))}
          {report.meta.speakerCount !== null && (
            <MetaChip>
              {report.meta.speakerCount}{" "}
              {report.meta.speakerCount === 1 ? "speaker" : "speakers"}
            </MetaChip>
          )}
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${COMPLETENESS_STYLES[report.meta.completeness]}`}
          >
            {report.meta.completeness}
          </span>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {report.disclaimer}
        </p>
      </div>

      {report.summary && (
        <Section title="Summary">
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {report.summary}
          </p>
        </Section>
      )}

      {(report.patient.age ||
        report.patient.sex ||
        report.patient.identifiers.length > 0) && (
        <Section title="Patient">
          <div className="flex flex-wrap gap-1.5">
            {report.patient.age && <MetaChip>Age: {report.patient.age}</MetaChip>}
            {report.patient.sex && <MetaChip>Sex: {report.patient.sex}</MetaChip>}
            {report.patient.identifiers.map((identifier) => (
              <MetaChip key={identifier}>{identifier}</MetaChip>
            ))}
          </div>
        </Section>
      )}

      <Section title="Chief Complaint">
        {report.chiefComplaint.text ? (
          <>
            <p className="text-sm leading-6 text-slate-800">
              {report.chiefComplaint.text}
            </p>
            <EvidenceLinks
              ids={report.chiefComplaint.evidence}
              segments={segments}
              onJump={onJump}
            />
          </>
        ) : (
          <p className="text-sm text-slate-400">Not documented.</p>
        )}
      </Section>

      <Section title="Subjective">
        {hasSubjective ? (
          <>
            {report.subjective.historyOfPresentIllness && (
              <div>
                <SubHeading>History of present illness</SubHeading>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {report.subjective.historyOfPresentIllness}
                </p>
              </div>
            )}

            {report.subjective.symptoms.length > 0 && (
              <div>
                <SubHeading>Symptoms</SubHeading>
                <div className="mt-1.5">
                  <SymptomList
                    symptoms={report.subjective.symptoms}
                    segments={segments}
                    onJump={onJump}
                  />
                </div>
              </div>
            )}

            {report.subjective.pastMedicalHistory.length > 0 && (
              <div>
                <SubHeading>Past medical history</SubHeading>
                <BulletList items={report.subjective.pastMedicalHistory} />
              </div>
            )}

            {report.subjective.currentMedications.length > 0 && (
              <div>
                <SubHeading>Current medications</SubHeading>
                <div className="mt-1.5">
                  <MedicationList
                    medications={report.subjective.currentMedications}
                    segments={segments}
                    onJump={onJump}
                  />
                </div>
              </div>
            )}

            {report.subjective.allergies.length > 0 && (
              <div>
                <SubHeading>Allergies</SubHeading>
                <BulletList items={report.subjective.allergies} />
              </div>
            )}

            {report.subjective.familyHistory.length > 0 && (
              <div>
                <SubHeading>Family history</SubHeading>
                <BulletList items={report.subjective.familyHistory} />
              </div>
            )}

            {report.subjective.socialHistory.length > 0 && (
              <div>
                <SubHeading>Social history</SubHeading>
                <BulletList items={report.subjective.socialHistory} />
              </div>
            )}

            {report.subjective.reviewOfSystems.length > 0 && (
              <div>
                <SubHeading>Review of systems</SubHeading>
                <BulletList items={report.subjective.reviewOfSystems} />
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-400">Not documented.</p>
        )}
      </Section>

      <Section title="Objective">
        {hasObjective ? (
          <>
            {report.objective.vitals.length > 0 && (
              <div>
                <SubHeading>Vitals</SubHeading>
                <div className="mt-1.5">
                  <VitalList
                    vitals={report.objective.vitals}
                    segments={segments}
                    onJump={onJump}
                  />
                </div>
              </div>
            )}
            {report.objective.examinationFindings.length > 0 && (
              <div>
                <SubHeading>Examination findings</SubHeading>
                <BulletList items={report.objective.examinationFindings} />
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-400">Not documented.</p>
        )}
      </Section>

      <Section title="Assessment">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm leading-6 text-slate-800">
            {report.assessment.impression ?? "Not documented."}
          </p>
          {report.assessment.statedBy && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              Stated by {SPEAKER_ROLE_LABELS[report.assessment.statedBy]}
            </span>
          )}
        </div>
        {report.assessment.differential.length > 0 && (
          <div>
            <SubHeading>Differential</SubHeading>
            <BulletList items={report.assessment.differential} />
          </div>
        )}
        <EvidenceLinks
          ids={report.assessment.evidence}
          segments={segments}
          onJump={onJump}
        />
      </Section>

      <Section title="Plan">
        {hasPlan ? (
          <>
            {report.plan.investigations.length > 0 && (
              <div>
                <SubHeading>Investigations</SubHeading>
                <BulletList items={report.plan.investigations} />
              </div>
            )}
            {report.plan.medications.length > 0 && (
              <div>
                <SubHeading>Medications</SubHeading>
                <div className="mt-1.5">
                  <MedicationList
                    medications={report.plan.medications}
                    segments={segments}
                    onJump={onJump}
                  />
                </div>
              </div>
            )}
            {report.plan.advice.length > 0 && (
              <div>
                <SubHeading>Advice</SubHeading>
                <BulletList items={report.plan.advice} />
              </div>
            )}
            {report.plan.followUp && (
              <div>
                <SubHeading>Follow-up</SubHeading>
                <p className="text-sm leading-6 text-slate-700">
                  {report.plan.followUp}
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-400">Not documented.</p>
        )}
      </Section>

      {report.redFlags.length > 0 && (
        <Section title="Red flags">
          <div className="rounded-lg border border-rose-100 bg-rose-50/70 px-3 py-2">
            <ul className="list-disc space-y-1 pl-4 text-sm leading-6 text-rose-800">
              {report.redFlags.map((flag, index) => (
                <li key={`${flag}-${index}`}>{flag}</li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      {report.gaps.length > 0 && (
        <Section title="Gaps">
          <div className="rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2">
            <ul className="list-disc space-y-1 pl-4 text-sm leading-6 text-amber-800">
              {report.gaps.map((gap, index) => (
                <li key={`${gap}-${index}`}>{gap}</li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      {report.warnings.length > 0 && (
        <Section title="Review notes">
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">
            {report.warnings.map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export function ConsultationReportPanel({
  segments,
  report,
  state,
  error,
  configured,
  availabilityError,
  speakers,
  roles,
  isStale,
  onRoleChange,
  onGenerate,
  onReset,
  onJumpToSegment,
}: ConsultationReportPanelProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const hasSegments = segments.length > 0;
  const isGenerating = state === "generating";
  const canGenerate = hasSegments && configured === true && !isGenerating;
  const buttonLabel = isGenerating
    ? "Generating…"
    : report
      ? "Regenerate"
      : "Generate report";

  const handleCopy = async () => {
    if (!report) return;
    const copiedOk = await copyText(reportToMarkdown(report));
    if (!copiedOk) return;
    setCopied(true);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = reportFileName(report);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="consultation-report overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <h2 className="text-sm font-semibold tracking-tight text-slate-900">
            Consultation Report
          </h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            AI draft
          </span>
        </div>

        <div className="no-print flex items-center gap-1">
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            title={
              configured === false
                ? (availabilityError ?? "Report generation is unavailable.")
                : !hasSegments
                  ? "Generate a transcript first."
                  : "Generate a structured consultation report"
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isGenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : report ? (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">{buttonLabel}</span>
          </button>

          {report && (
            <>
              <button
                type="button"
                onClick={() => void handleCopy()}
                aria-label={copied ? "Report copied" : "Copy report as Markdown"}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
                  copied
                    ? "text-emerald-600"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                }`}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span className="hidden sm:inline">
                  {copied ? "Copied" : "Copy"}
                </span>
              </button>

              <button
                type="button"
                onClick={handleDownload}
                aria-label="Download report as JSON"
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">JSON</span>
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                aria-label="Print report"
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Print</span>
              </button>

              <button
                type="button"
                onClick={onReset}
                aria-label="Clear report"
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Clear</span>
              </button>
            </>
          )}
        </div>
      </div>

      {speakers.length > 0 && (
        <div className="no-print border-b border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Speaker roles
            </span>
            <span className="text-[11px] text-slate-400">
              Used for attribution. The report never guesses.
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {speakers.map((speaker) => (
              <label
                key={speaker}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600"
              >
                <span className="font-medium">{speaker}</span>
                <select
                  value={roles[speaker] ?? "unknown"}
                  onChange={(event) =>
                    onRoleChange(speaker, event.target.value as SpeakerRole)
                  }
                  className="rounded border-0 bg-transparent p-0 text-[11px] font-medium text-slate-700 focus:outline-none"
                >
                  {SPEAKER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {SPEAKER_ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      {isGenerating && (
        <div className="no-print flex items-center gap-2 border-b border-indigo-100 bg-indigo-50/70 px-4 py-2.5 text-xs font-medium text-indigo-700 sm:px-5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Structuring the consultation… This can take a few seconds.
        </div>
      )}

      {report && isStale && !isGenerating && (
        <div className="no-print border-b border-amber-100 bg-amber-50/70 px-4 py-2.5 text-xs font-medium text-amber-800 sm:px-5">
          The transcript changed after this report was generated. Regenerate to
          include the latest segments.
        </div>
      )}

      {error && (
        <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 bg-rose-50/70 px-4 py-2.5 sm:px-5">
          <p className="text-xs font-medium text-rose-700">
            Report generation failed: {error}
          </p>
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className="rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-rose-700 ring-1 ring-inset ring-rose-200 transition-colors hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Retry
          </button>
        </div>
      )}

      {configured === false && availabilityError && (
        <div className="no-print border-b border-amber-100 bg-amber-50/70 px-4 py-2.5 text-xs font-medium text-amber-800 sm:px-5">
          {availabilityError} Add a Gemini key to the server environment to
          enable reports.
        </div>
      )}

      {report ? (
        <ReportBody
          report={report}
          segments={segments}
          onJump={onJumpToSegment}
        />
      ) : isGenerating ? (
        <div className="flex min-h-[180px] flex-col items-center justify-center px-4 py-8 text-center">
          <Loader2
            className="mb-3 h-6 w-6 animate-spin text-indigo-500"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-slate-600">
            Reading the transcript…
          </p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-slate-400">
            Extracting the complaint, history, findings, assessment and plan.
            Nothing is invented or prescribed.
          </p>
        </div>
      ) : (
        <div className="flex min-h-[180px] flex-col items-center justify-center px-4 py-8 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-slate-600">
            Turn the transcript into a structured report.
          </p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-slate-400">
            Generates a SOAP-style draft with evidence links back to the
            transcript. Review it before any clinical use.
          </p>
        </div>
      )}
    </section>
  );
}
