import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  FileJson,
  Loader2,
  Trash2,
} from "lucide-react";
import type { TranscriptSegment } from "../hooks/useAudioStreaming";
import { safeFileStem } from "../lib/format";
import {
  buildTranscriptJson,
  buildTranscriptText,
  copyText,
  countWords,
  downloadText,
  type TranscriptMeta,
} from "../lib/transcript";
import { TranscriptList } from "./LiveTranscription";

type ListMode = "live" | "batch" | "saved";

interface TranscriptViewProps {
  segments: TranscriptSegment[];
  meta: TranscriptMeta;
  mode: ListMode;
  isProcessing: boolean;
  clinicalLabels: boolean;
  canClear: boolean;
  onClear: () => void;
}

const actionButton =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-40";

export function TranscriptView({
  segments,
  meta,
  mode,
  isProcessing,
  clinicalLabels,
  canClear,
  onClear,
}: TranscriptViewProps) {
  const [copied, setCopied] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  useEffect(() => {
    setConfirmingClear(false);
  }, [meta.fileName]);

  const text = buildTranscriptText(segments, meta, { clinicalLabels });
  const words = countWords(segments);
  const stem = safeFileStem(meta.fileName);

  const handleCopy = async () => {
    if (!(await copyText(text))) return;
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" id="panel-transcript" role="tabpanel" aria-labelledby="tab-transcript">
      <div className="border-b border-slate-100 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            disabled={segments.length === 0}
            className={actionButton}
            aria-label={copied ? "Transcript copied" : "Copy transcript"}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() =>
              downloadText(`${stem}-transcript.txt`, text)
            }
            disabled={segments.length === 0}
            className={actionButton}
            aria-label="Download transcript as text"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            TXT
          </button>
          <button
            type="button"
            onClick={() =>
              downloadText(
                `${stem}-transcript.json`,
                buildTranscriptJson(segments, meta, { clinicalLabels }),
                "application/json",
              )
            }
            disabled={segments.length === 0}
            className={actionButton}
            aria-label="Download transcript as JSON"
          >
            <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
            JSON
          </button>

          <span className="ml-auto inline-flex items-center gap-1 text-[10px] tabular-nums text-slate-400">
            <span>{segments.length} segments</span>
            <span aria-hidden="true">·</span>
            <span>{words} words</span>
          </span>

          {canClear && (
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              disabled={segments.length === 0}
              className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] font-medium text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Clear transcript"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>

        {confirmingClear && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-100 bg-rose-50/70 px-2.5 py-2">
            <p className="text-[11px] font-medium text-rose-700">
              Clear this transcript? This cannot be undone.
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setConfirmingClear(false);
                }}
                className="rounded-md bg-rose-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-rose-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <TranscriptList
        segments={segments}
        isProcessing={isProcessing}
        mode={mode}
        clinicalLabels={clinicalLabels}
        emptyTitle={
          mode === "saved"
            ? "No transcript available"
            : mode === "batch"
              ? "Your file transcript will appear here"
              : undefined
        }
        emptyDescription={
          mode === "batch"
            ? "Upload an audio file and generate a transcript to review it here."
            : undefined
        }
        processingLabel={mode === "batch" ? "Transcribing the uploaded file…" : undefined}
      />

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">
        <span>
          {mode === "batch"
            ? "Speaker-separated transcript from the uploaded file"
            : mode === "saved"
              ? "Saved session snapshot"
              : "Language is detected per utterance"}
        </span>
        {isProcessing ? (
          <span className="inline-flex items-center gap-1 text-slate-500">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Processing
          </span>
        ) : (
          <span>Kept in this session</span>
        )}
      </div>
    </div>
  );
}
