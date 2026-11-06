import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Download,
  FileJson,
  Languages,
  Loader2,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { TranscriptSegment } from "../hooks/useAudioStreaming";
import { safeFileStem } from "../lib/format";
import { TRANSLATION_LANGUAGES, translationLanguageLabel } from "../lib/settings";
import {
  buildTranslationJson,
  buildTranslationText,
  copyText,
  downloadText,
  type TranscriptMeta,
} from "../lib/transcript";
import type { TranslationLanguage, TranslationResult } from "../lib/types";
import { TranscriptList } from "./LiveTranscription";

type AsyncStatus = "idle" | "loading" | "ready" | "error";

interface TranslationViewProps {
  segments: TranscriptSegment[];
  meta: TranscriptMeta;
  targetLanguage: TranslationLanguage;
  onTargetChange: (language: TranslationLanguage) => void;
  translation: TranslationResult | null;
  status: AsyncStatus;
  error: string | null;
  isStale: boolean;
  onTranslate: (language: TranslationLanguage) => void;
  aiConfigured: boolean;
}

const actionButton =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-40";

export function TranslationView({
  segments,
  meta,
  targetLanguage,
  onTargetChange,
  translation,
  status,
  error,
  isStale,
  onTranslate,
  aiConfigured,
}: TranslationViewProps) {
  const [copied, setCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const selectedLabel = translationLanguageLabel(targetLanguage);
  const targetLabel = translation
    ? translationLanguageLabel(translation.targetLanguage)
    : selectedLabel;
  const targetArticle = /^[aeiou]/i.test(selectedLabel) ? "an" : "a";
  const showingOtherTarget =
    translation !== null && translation.targetLanguage !== targetLanguage;
  const textByKey = translation
    ? new Map(translation.segments.map((entry) => [entry.key, entry.text]))
    : null;
  const text = translation
    ? buildTranslationText(segments, translation, meta, targetLabel)
    : "";
  const stem = safeFileStem(meta.fileName);
  const isLoading = status === "loading";

  const handleCopy = async () => {
    if (!text || !(await copyText(text))) return;
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      id="panel-translation"
      role="tabpanel"
      aria-labelledby="tab-translation"
    >
      <div className="space-y-2.5 border-b border-slate-100 px-4 py-3">
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Translate to
            </span>
            <select
              value={targetLanguage}
              onChange={(event) =>
                onTargetChange(event.target.value as TranslationLanguage)
              }
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              {TRANSLATION_LANGUAGES.map((language) => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => onTranslate(targetLanguage)}
            disabled={segments.length === 0 || isLoading || !aiConfigured}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-600/20 transition-colors hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              aiConfigured
                ? `Translate to ${targetLabel}`
                : "Add GEMINI_API_KEY to the server .env file to enable translation"
            }
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {translation ? "Re-translate" : "Translate"}
          </button>
        </div>
        {!aiConfigured && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-5 text-amber-800">
            Translation is not configured on the server. Add GEMINI_API_KEY to the
            server .env file.
          </p>
        )}
      </div>

      {translation && (
        <div className="border-b border-slate-100 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopy}
              className={actionButton}
              aria-label={copied ? "Translation copied" : "Copy translation"}
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
                downloadText(`${stem}-translation-${translation.targetLanguage}.txt`, text)
              }
              className={actionButton}
              aria-label="Download translated transcript as text"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              TXT
            </button>
            <button
              type="button"
              onClick={() =>
                downloadText(
                  `${stem}-translation-${translation.targetLanguage}.json`,
                  buildTranslationJson(segments, translation, meta),
                  "application/json",
                )
              }
              className={actionButton}
              aria-label="Download translated transcript as JSON"
            >
              <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
              JSON
            </button>

            <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-[10px] font-medium text-slate-500">
              <input
                type="checkbox"
                checked={showOriginal}
                onChange={(event) => setShowOriginal(event.target.checked)}
                className="h-3 w-3 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Show original
            </label>
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400">
            <Languages className="h-3 w-3" aria-hidden="true" />
            {`${targetLabel} translation · ${translation.model ?? "Gemini"}`}
          </p>
          {showingOtherTarget && (
            <p className="mt-1 text-[10px] leading-4 text-amber-700">
              Showing {targetLabel}. Choose {selectedLabel} above and select Re-translate to
              switch.
            </p>
          )}
        </div>
      )}

      {isStale && (
        <div className="flex items-start gap-2 border-b border-amber-100 bg-amber-50/70 px-4 py-2.5">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-[11px] leading-5 text-amber-800">
            The transcript has changed since this translation. Re-translate to include the
            latest segments.
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

      {translation ? (
        <TranscriptList
          segments={segments}
          isProcessing={false}
          mode="saved"
          textByKey={textByKey}
          showOriginal={showOriginal}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Languages className="h-5 w-5" aria-hidden="true" />
            )}
          </div>
          <p className="text-sm font-medium text-slate-600">
            {isLoading
              ? `Translating to ${targetLabel}…`
              : segments.length === 0
                ? "No transcript to translate yet"
                : "Translate this consultation"}
          </p>
          <p className="mt-1 max-w-[32ch] text-xs leading-5 text-slate-400">
            {isLoading
              ? "Gemini keeps timestamps intact while translating each segment."
              : segments.length === 0
                ? "Start a recording or upload a file first."
                : `Create ${targetArticle} ${targetLabel} version of the transcript.`}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">
        <span>AI translation — verify clinical terms.</span>
        <span>{segments.length} segments</span>
      </div>
    </div>
  );
}
