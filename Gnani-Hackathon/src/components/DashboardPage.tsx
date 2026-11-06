import { ArrowRight, AudioLines, Files, Mic, Sparkles, UploadCloud } from "lucide-react";
import type { AudioStreamingController } from "../hooks/useAudioStreaming";
import type { AiStatus, SessionRecord } from "../lib/types";
import { ErrorBanner } from "./ErrorBanner";
import { HistoryTable } from "./HistoryTable";
import { RecordingPanel } from "./RecordingPanel";
import { StartActions } from "./StartActions";

interface DashboardPageProps {
  audio: AudioStreamingController;
  sessions: SessionRecord[];
  activeId: string | null;
  onOpenRecord: (record: SessionRecord) => void;
  onRecord: () => void;
  onFile: (file: File) => void;
  onClearTranscript: () => void;
  onViewAll: () => void;
  aiStatus: AiStatus | null;
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Files;
  label: string;
  value: string;
  hint: string;
  tone: "indigo" | "emerald" | "amber";
}) {
  const tones = {
    indigo: "bg-indigo-50 text-indigo-600 ring-indigo-100",
    emerald: "bg-emerald-50 text-emerald-600 ring-emerald-100",
    amber: "bg-amber-50 text-amber-600 ring-amber-100",
  } as const;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white px-3.5 py-3 shadow-sm shadow-slate-200/40">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${tones[tone]}`}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      </div>
      <p className="mt-2 truncate text-lg font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-slate-400">{hint}</p>
    </div>
  );
}

export function DashboardPage({
  audio,
  sessions,
  activeId,
  onOpenRecord,
  onRecord,
  onFile,
  onClearTranscript,
  onViewAll,
  aiStatus,
}: DashboardPageProps) {
  const realtimeVisible = audio.state !== "idle" && audio.state !== "error";
  const showStartActions = audio.state === "idle" || audio.state === "error";

  const connectionLabel =
    audio.state === "recording"
      ? "Recording live"
      : audio.connection === "connected"
        ? "Realtime connected"
        : audio.state === "ready"
          ? "Microphone ready"
          : "Idle — start a session";

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-700 px-5 py-6 text-white shadow-sm shadow-indigo-600/20 sm:px-6 sm:py-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-16 h-52 w-52 rounded-full bg-white/10 blur-2xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-violet-400/20 blur-2xl"
        />
        <div className="relative max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ring-white/20">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            AI clinical documentation
          </span>
          <h2 className="mt-3 text-2xl font-semibold leading-tight tracking-tight sm:text-[28px]">
            Every consultation, documented.
          </h2>
          <p className="mt-2 max-w-xl text-[13px] leading-6 text-indigo-100 sm:text-sm">
            Record live or upload audio. VoxNote transcribes in real time, translates
            the conversation, and drafts a structured clinical note for review.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] font-medium text-indigo-100">
            <span className="inline-flex items-center gap-1.5">
              <Mic className="h-3 w-3" aria-hidden="true" />
              Live microphone
            </span>
            <span className="inline-flex items-center gap-1.5">
              <UploadCloud className="h-3 w-3" aria-hidden="true" />
              Batch upload
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Gemini summary + translation
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={Files}
          label="Workspace sessions"
          value={String(sessions.length)}
          hint="Sessions recorded in this tab"
          tone="indigo"
        />
        <StatCard
          icon={AudioLines}
          label="Live engine"
          value={connectionLabel}
          hint="Gnani Prisma v3.0 · auto language detection"
          tone="emerald"
        />
        <StatCard
          icon={Sparkles}
          label="AI assistant"
          value={aiStatus?.configured ? "Gemini ready" : "Not configured"}
          hint={aiStatus?.model ? aiStatus.model : "Summaries and translation"}
          tone="amber"
        />
      </div>

      {!showStartActions && audio.error && (
        <ErrorBanner
          message={audio.error}
          onDismiss={audio.dismissError}
          onRetry={showStartActions ? onRecord : undefined}
        />
      )}

      {showStartActions && (
        <StartActions onRecord={onRecord} onFile={onFile} busy={audio.state === "requesting"} />
      )}

      {!showStartActions && realtimeVisible && (
        <RecordingPanel
          state={audio.state}
          elapsedMs={audio.elapsedMs}
          analyser={audio.analyser}
          speechActive={audio.speechActive}
          isProcessing={audio.isProcessing}
          sessionSegments={audio.sessionSegments}
          onStart={audio.start}
          onStop={() => void audio.stop()}
          onNewSession={onRecord}
          onClose={() => {
            onClearTranscript();
            audio.reset();
          }}
        />
      )}

      <section>
        <div className="mb-2 flex items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-slate-900">
              Recent transcriptions
            </h2>
            <p className="text-[11px] text-slate-400">
              Open a session to review its transcript, translation, and summary.
            </p>
          </div>
          <button
            type="button"
            onClick={onViewAll}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            View all
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
        <HistoryTable
          sessions={sessions}
          activeId={activeId}
          onOpen={onOpenRecord}
          compact
          limit={4}
        />
      </section>
    </div>
  );
}
