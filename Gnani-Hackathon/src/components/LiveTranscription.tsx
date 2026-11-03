import { useEffect, useRef, useState } from "react";
import { ArrowDown, Loader2, ScrollText } from "lucide-react";
import type { TranscriptSegment } from "../hooks/useAudioStreaming";
import { formatClock } from "../lib/format";
import { toViewSegments } from "../lib/transcript";

type ListMode = "live" | "batch" | "saved";

interface TranscriptListProps {
  segments: TranscriptSegment[];
  isProcessing: boolean;
  mode: ListMode;
  clinicalLabels: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  processingLabel?: string;
  /** Optional translated text keyed by segment key. */
  textByKey?: Map<string, string> | null;
  showOriginal?: boolean;
}

const TONE_STYLES = {
  doctor: {
    article: "border-indigo-100/80 bg-indigo-50/40",
    badge: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  },
  patient: {
    article: "border-teal-100/80 bg-teal-50/35",
    badge: "bg-teal-100 text-teal-700 ring-teal-200",
  },
  speaker: {
    article: "border-slate-200/80 bg-slate-50/70",
    badge: "bg-slate-200 text-slate-700 ring-slate-300",
  },
} as const;

export function TranscriptList({
  segments,
  isProcessing,
  mode,
  clinicalLabels,
  emptyTitle,
  emptyDescription,
  processingLabel,
  textByKey = null,
  showOriginal = false,
}: TranscriptListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousCountRef = useRef(segments.length);
  const firstKeyRef = useRef(segments[0]?.key ?? "");
  const [stickToBottom, setStickToBottom] = useState(true);
  const [hasNewSegments, setHasNewSegments] = useState(false);

  const isLive = mode === "live" || mode === "batch";
  const viewSegments = toViewSegments(segments, { clinicalLabels });
  const hasSegments = viewSegments.length > 0;
  const isRecording = mode === "live";

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const firstKey = segments[0]?.key ?? "";

    if (!isLive) {
      if (firstKey !== firstKeyRef.current) {
        firstKeyRef.current = firstKey;
        element.scrollTop = 0;
      }
      previousCountRef.current = segments.length;
      return;
    }

    if (segments.length > previousCountRef.current) {
      if (stickToBottom) {
        element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
      } else {
        setHasNewSegments(true);
      }
    }

    previousCountRef.current = segments.length;
  }, [segments, stickToBottom, isLive]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    setStickToBottom(atBottom);
    if (atBottom) setHasNewSegments(false);
  };

  const scrollToBottom = () => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    setStickToBottom(true);
    setHasNewSegments(false);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Transcript"
        className="transcript-scroll min-h-[220px] flex-1 overflow-y-auto px-4 py-4"
      >
        {!hasSegments && (
          <div className="flex min-h-[200px] flex-col items-center justify-center px-4 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              {isProcessing ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <ScrollText className="h-5 w-5" aria-hidden="true" />
              )}
            </div>
            <p className="text-sm font-medium text-slate-600">
              {emptyTitle ??
                (mode === "saved"
                  ? "No transcript available"
                  : isRecording
                    ? "Listening for speech…"
                    : "Your transcript will appear here")}
            </p>
            <p className="mt-1 max-w-[30ch] text-xs leading-5 text-slate-400">
              {emptyDescription ??
                (mode === "saved"
                  ? "This record does not contain any transcript segments."
                  : isRecording
                    ? "Speak naturally. Each finished utterance appears here as soon as it is transcribed."
                    : "Start a recording or upload an audio file to begin.")}
            </p>
          </div>
        )}

        {hasSegments && (
          <div className="space-y-2.5">
            {viewSegments.map((segment, index) => {
              const rawSegment = segments[index];
              const key = rawSegment.key || segment.key;
              const text = textByKey?.get(key) ?? segment.text;
              const secondary = textByKey && showOriginal ? segment.text : undefined;
              const tone = TONE_STYLES[segment.tone];

              return (
                <article
                  key={key}
                  className={`rounded-xl border px-3 py-2.5 ${tone.article}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${tone.badge}`}
                    >
                      {segment.speaker}
                    </span>
                    <span className="text-[10px] font-medium tabular-nums text-slate-400">
                      {formatClock(segment.timeMs)}
                    </span>
                    {segment.language && (
                      <span className="ml-auto hidden truncate text-[10px] text-slate-400 sm:inline">
                        {segment.language}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-[14px] leading-6 text-slate-800">
                    {text}
                  </p>
                  {secondary && (
                    <p className="mt-2 border-t border-slate-200/70 pt-2 text-[11px] leading-5 text-slate-500">
                      <span className="font-semibold text-slate-400">Original: </span>
                      {secondary}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {isProcessing && hasSegments && (
          <div className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {processingLabel ?? (isLive ? "Processing speech…" : "Processing the file…")}
          </div>
        )}
      </div>

      {hasNewSegments && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          <ArrowDown className="h-3 w-3" aria-hidden="true" />
          New transcript
        </button>
      )}
    </div>
  );
}
