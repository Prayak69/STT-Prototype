import {
  AudioLines,
  Clock3,
  FileAudio,
  Languages,
  ListChecks,
  ScrollText,
  Sparkles,
} from "lucide-react";
import type { TranscriptSegment } from "../hooks/useAudioStreaming";
import { formatDate, formatDuration } from "../lib/format";
import { translationLanguageLabel } from "../lib/settings";
import { countWords, detectLanguage, type TranscriptMeta } from "../lib/transcript";
import type { TranslationLanguage } from "../lib/types";

interface DetailsViewProps {
  meta: TranscriptMeta;
  segments: TranscriptSegment[];
  status: string;
  sourceLabel: string;
  translated: boolean;
  translationLanguage: TranslationLanguage;
  summarized: boolean;
  engine: string;
  aiModel: string;
}

function Row({
  icon: Icon,
  label,
  value,
  wide,
}: {
  icon: typeof FileAudio;
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 ${
        wide ? "sm:col-span-2" : ""
      }`}
    >
      <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <Icon className="h-3 w-3" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-1 truncate text-[12px] font-semibold text-slate-800" title={value}>
        {value}
      </dd>
    </div>
  );
}

export function DetailsView({
  meta,
  segments,
  status,
  sourceLabel,
  translated,
  translationLanguage,
  summarized,
  engine,
  aiModel,
}: DetailsViewProps) {
  const words = countWords(segments);
  const language = meta.language || detectLanguage(segments);

  return (
    <div
      className="transcript-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4"
      id="panel-details"
      role="tabpanel"
      aria-labelledby="tab-details"
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <FileAudio className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-800" title={meta.fileName}>
            {meta.fileName}
          </p>
          <p className="text-[10px] text-slate-400">{meta.status} · {formatDate(meta.createdAt)}</p>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Row icon={FileAudio} label="File name" value={meta.fileName} wide />
        <Row icon={Clock3} label="Audio duration" value={formatDuration(meta.durationMs)} />
        <Row icon={Languages} label="Language" value={language} />
        <Row icon={ListChecks} label="Processing status" value={status} />
        <Row icon={ScrollText} label="Transcript word count" value={`${words} words`} />
        <Row icon={AudioLines} label="Segments" value={String(segments.length)} />
        <Row icon={FileAudio} label="Source" value={sourceLabel} />
        <Row icon={AudioLines} label="Transcription engine" value={engine} wide />
        <Row icon={Sparkles} label="AI model" value={aiModel} wide />
        <Row
          icon={Languages}
          label="Translation"
          value={
            translated
              ? `Ready · ${translationLanguageLabel(translationLanguage)}`
              : "Not generated"
          }
        />
        <Row
          icon={Sparkles}
          label="Clinical summary"
          value={summarized ? "Ready" : "Not generated"}
        />
      </dl>

      <p className="mt-3 rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] leading-5 text-slate-400">
        Session metadata is shown exactly as provided by the transcription pipeline.
      </p>
    </div>
  );
}
