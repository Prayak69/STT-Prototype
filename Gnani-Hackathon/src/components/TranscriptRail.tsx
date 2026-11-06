import { useEffect, useRef } from "react";
import {
  AudioLines,
  FileAudio,
  Languages,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { useAiInsights } from "../hooks/useAiInsights";
import type { TranscriptSegment } from "../hooks/useAudioStreaming";
import type {
  AiStatus,
  AppSettings,
  RailTab,
  TranslationLanguage,
} from "../lib/types";
import type { TranscriptMeta } from "../lib/transcript";
import { DetailsView } from "./DetailsView";
import { SummaryView } from "./SummaryView";
import { Tabs, type TabItem } from "./Tabs";
import { TranscriptView } from "./TranscriptView";
import { TranslationView } from "./TranslationView";

type RailMode = "live" | "batch" | "saved";

interface TranscriptRailProps {
  sourceKey: string;
  segments: TranscriptSegment[];
  meta: TranscriptMeta;
  mode: RailMode;
  isProcessing: boolean;
  isRecording: boolean;
  sessionComplete: boolean;
  settings: AppSettings;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  onClear: () => void;
  canClear: boolean;
  aiStatus: AiStatus | null;
  tab: RailTab;
  onTabChange: (tab: RailTab) => void;
}

const TABS: Array<TabItem<RailTab>> = [
  { id: "transcript", label: "Transcript", icon: ScrollText },
  { id: "translation", label: "Translate", icon: Languages },
  { id: "summary", label: "Summary", icon: Sparkles },
  { id: "details", label: "Details", icon: FileAudio },
];

const STATUS_STYLES: Record<string, string> = {
  Completed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Complete: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Processing: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  Ready: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  Selected: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  Recording: "bg-rose-50 text-rose-700 ring-rose-200",
  Failed: "bg-rose-50 text-rose-700 ring-rose-200",
};

function statusStyle(status: string): string {
  return STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600 ring-slate-200";
}

export function TranscriptRail({
  sourceKey,
  segments,
  meta,
  mode,
  isProcessing,
  isRecording,
  sessionComplete,
  settings,
  onSettingsChange,
  onClear,
  canClear,
  aiStatus,
  tab,
  onTabChange,
}: TranscriptRailProps) {
  const insights = useAiInsights({
    sourceKey,
    segments,
    fileName: meta.fileName,
    language: meta.language,
    targetLanguage: settings.targetLanguage,
  });

  const autoRanRef = useRef<string | null>(null);
  const aiConfigured = aiStatus?.configured !== false;

  // Automatically produce the preferred translation once a live/uploaded
  // session finishes. Manual re-translation stays available at any time.
  useEffect(() => {
    if (!settings.autoTranslate || !sessionComplete) return;
    if (mode === "saved") return;
    if (segments.length === 0) return;
    if (autoRanRef.current === sourceKey) return;
    autoRanRef.current = sourceKey;
    void insights.translate(settings.targetLanguage);
  }, [
    insights,
    mode,
    segments.length,
    sessionComplete,
    settings.autoTranslate,
    settings.targetLanguage,
    sourceKey,
  ]);

  // The rail is narrow, so tab labels stay icon + text. Segment counts are
  // shown in the transcript footer instead of squeezing the labels.
  const tabs = TABS;

  const onTargetChange = (targetLanguage: TranslationLanguage) => {
    onSettingsChange({ targetLanguage });
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/40">
      <header className="border-b border-slate-100 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
              <AudioLines className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-tight text-slate-900">
                Session transcript
                {isRecording && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-rose-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500 recording-dot" />
                    Live
                  </span>
                )}
              </h2>
              <p className="truncate text-[10px] text-slate-400" title={meta.fileName}>
                {meta.fileName} · {meta.language}
              </p>
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 ring-inset ${statusStyle(meta.status)}`}
          >
            {meta.status}
          </span>
        </div>
      </header>

      <div className="border-b border-slate-100 px-3 py-2">
        <Tabs
          items={tabs}
          value={tab}
          onChange={onTabChange}
          label="Session transcript views"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "transcript" && (
          <TranscriptView
            segments={segments}
            meta={meta}
            mode={mode}
            isProcessing={isProcessing}
            canClear={canClear}
            onClear={onClear}
          />
        )}

        {tab === "translation" && (
          <TranslationView
            segments={segments}
            meta={meta}
            targetLanguage={settings.targetLanguage}
            onTargetChange={onTargetChange}
            translation={insights.translation}
            status={insights.translationStatus}
            error={insights.translationError}
            isStale={insights.isTranslationStale}
            onTranslate={(language) => {
              void insights.translate(language);
            }}
            aiConfigured={aiConfigured}
          />
        )}

        {tab === "summary" && (
          <SummaryView
            meta={meta}
            summary={insights.summary}
            model={insights.summaryModel}
            status={insights.summaryStatus}
            error={insights.summaryError}
            isStale={insights.isSummaryStale}
            onGenerate={() => {
              void insights.generateSummary();
            }}
            aiConfigured={aiConfigured}
            hasSegments={segments.length > 0}
          />
        )}

        {tab === "details" && (
          <DetailsView
            meta={meta}
            segments={segments}
            status={meta.status}
            sourceLabel={meta.sourceLabel}
            translated={insights.translation !== null}
            translationLanguage={insights.translation?.targetLanguage ?? settings.targetLanguage}
            summarized={insights.summary !== null}
            engine="Gnani Prisma v3.0"
            aiModel={aiStatus?.model ?? "Google Gemini"}
          />
        )}
      </div>
    </section>
  );
}
