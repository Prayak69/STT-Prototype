import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  CalendarClock,
  Check,
  ClipboardList,
  Copy,
  Download,
  FileJson,
  ListChecks,
  Loader2,
  Pill,
  Sparkles,
  Stethoscope,
  TriangleAlert,
} from "lucide-react";
import { safeFileStem } from "../lib/format";
import {
  copyText,
  downloadText,
  summaryToJson,
  summaryToText,
  type TranscriptMeta,
} from "../lib/transcript";
import type { ConsultationSummary } from "../lib/types";

type AsyncStatus = "idle" | "loading" | "ready" | "error";

interface SummaryViewProps {
  meta: TranscriptMeta;
  summary: ConsultationSummary | null;
  model: string | null;
  status: AsyncStatus;
  error: string | null;
  isStale: boolean;
  onGenerate: () => void;
  aiConfigured: boolean;
  hasSegments: boolean;
}

const actionButton =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-40";

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200/80 bg-white px-3 py-2.5">
      <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {title}
      </h3>
      <div className="mt-1.5 text-[12px] leading-5 text-slate-700">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-slate-400">Not stated</p>;
  }
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item} className="flex gap-1.5">
          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function SummaryView({
  meta,
  summary,
  model,
  status,
  error,
  isStale,
  onGenerate,
  aiConfigured,
  hasSegments,
}: SummaryViewProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const isLoading = status === "loading";

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const text = summary ? summaryToText(summary, meta) : "";
  const stem = safeFileStem(meta.fileName);

  const handleCopy = async () => {
    if (!text || !(await copyText(text))) return;
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      id="panel-summary"
      role="tabpanel"
      aria-labelledby="tab-summary"
    >
      <div className="border-b border-slate-100 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onGenerate}
            disabled={!hasSegments || isLoading || !aiConfigured}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm shadow-indigo-600/20 transition-colors hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              aiConfigured
                ? "Generate a clinical summary"
                : "Add GEMINI_API_KEY to the server .env file to enable summaries"
            }
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {summary ? "Regenerate" : "Generate summary"}
          </button>

          {summary && (
            <>
              <button type="button" onClick={handleCopy} className={actionButton}>
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => downloadText(`${stem}-summary.txt`, text)}
                className={actionButton}
                aria-label="Download summary as text"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                TXT
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadText(
                    `${stem}-summary.json`,
                    summaryToJson(summary, meta, model ?? undefined),
                    "application/json",
                  )
                }
                className={actionButton}
                aria-label="Download summary as JSON"
              >
                <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
                JSON
              </button>
            </>
          )}
        </div>
      </div>

      {!aiConfigured && (
        <div className="border-b border-amber-100 bg-amber-50/70 px-4 py-2.5">
          <p className="text-[11px] leading-5 text-amber-800">
            Summary generation is not configured. Add GEMINI_API_KEY to the server .env
            file.
          </p>
        </div>
      )}

      {isStale && (
        <div className="flex items-start gap-2 border-b border-amber-100 bg-amber-50/70 px-4 py-2.5">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-[11px] leading-5 text-amber-800">
            New transcript segments are available. Regenerate the summary to include them.
          </p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-rose-100 bg-rose-50/70 px-4 py-2.5"
        >
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden="true" />
          <p className="text-[11px] leading-5 text-rose-800">{error}</p>
        </div>
      )}

      {summary ? (
        <div className="transcript-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">
              Clinical snapshot
            </p>
            <p className="mt-1 text-[13px] font-semibold leading-5 text-slate-900">
              {summary.headline}
            </p>
            <p className="mt-1 text-[10px] text-slate-400">
              {`Generated with ${model ?? "Gemini"}`}
            </p>
          </div>

          <Section icon={ClipboardList} title="Chief complaint">
            <p>{summary.chiefComplaint}</p>
          </Section>

          <Section icon={Activity} title="Symptoms">
            <Bullets items={summary.symptoms} />
          </Section>

          <Section icon={Stethoscope} title="History">
            <p>{summary.history}</p>
          </Section>

          <Section icon={Pill} title="Medications">
            <Bullets items={summary.medications} />
          </Section>

          <Section icon={ListChecks} title="Assessment">
            <p>{summary.assessment}</p>
          </Section>

          <Section icon={ListChecks} title="Plan">
            <Bullets items={summary.plan} />
          </Section>

          <Section icon={CalendarClock} title="Follow-up">
            <p>{summary.followUp}</p>
          </Section>

          {summary.redFlags.length > 0 && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5">
              <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                Red flags to watch
              </h3>
              <div className="mt-1.5 text-[12px] leading-5 text-amber-900">
                <Bullets items={summary.redFlags} />
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            )}
          </div>
          <p className="text-sm font-medium text-slate-600">
            {isLoading
              ? "Drafting the clinical note…"
              : hasSegments
                ? "Turn this conversation into a clinical note"
                : "No transcript to summarize yet"}
          </p>
          <p className="mt-1 max-w-[34ch] text-xs leading-5 text-slate-400">
            {isLoading
              ? "Gemini is extracting the complaint, symptoms, history, medications, assessment, and plan."
              : hasSegments
                ? "Generate a structured summary for review. It uses only what was said in the transcript and marks missing details as “Not stated”."
                : "Start a recording or upload a file first."}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">
        <span>AI-generated draft — clinician review required.</span>
        <span>{meta.language}</span>
      </div>
    </div>
  );
}
