import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TranscriptSegment } from "./useAudioStreaming";
import { formatClock } from "../lib/format";
import type {
  ConsultationSummary,
  TranslationLanguage,
  TranslationResult,
} from "../lib/types";
import { speakerLabel } from "../lib/transcript";
import { isConsultationSummary, requestInsights } from "../services/aiService";

type AsyncStatus = "idle" | "loading" | "ready" | "error";

interface UseAiInsightsOptions {
  sourceKey: string;
  segments: TranscriptSegment[];
  clinicalLabels: boolean;
  fileName: string;
  language: string;
  targetLanguage: TranslationLanguage;
}

interface CombinedRun {
  fingerprint: string;
  targetLanguage: TranslationLanguage;
}

export function useAiInsights({
  sourceKey,
  segments,
  clinicalLabels,
  fileName,
  language,
  targetLanguage,
}: UseAiInsightsOptions) {
  const [translation, setTranslation] = useState<TranslationResult | null>(null);
  const [translationStatus, setTranslationStatus] = useState<AsyncStatus>("idle");
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationFingerprint, setTranslationFingerprint] = useState<string | null>(null);

  const [summary, setSummary] = useState<ConsultationSummary | null>(null);
  const [summaryModel, setSummaryModel] = useState<string | null>(null);
  const [summaryStatus, setSummaryStatus] = useState<AsyncStatus>("idle");
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryFingerprint, setSummaryFingerprint] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const sourceRef = useRef(sourceKey);
  const fingerprintRef = useRef("");
  // Remembers the transcript + language pair that already has a combined
  // summary/translation result, so the two buttons never trigger two calls.
  const lastRunRef = useRef<CombinedRun | null>(null);
  // Prevents a second click from starting a duplicate request while the first
  // combined request is still in flight.
  const inFlightRef = useRef<CombinedRun | null>(null);

  const fingerprint = useMemo(
    () =>
      segments
        .map((segment) => `${segment.key}:${segment.text.length}:${segment.text.slice(0, 24)}`)
        .join("|"),
    [segments],
  );
  fingerprintRef.current = fingerprint;

  const resetInsights = useCallback(() => {
    requestIdRef.current += 1;
    lastRunRef.current = null;
    inFlightRef.current = null;
    setTranslation(null);
    setTranslationStatus("idle");
    setTranslationError(null);
    setTranslationFingerprint(null);
    setSummary(null);
    setSummaryModel(null);
    setSummaryStatus("idle");
    setSummaryError(null);
    setSummaryFingerprint(null);
  }, []);

  // A new recording or upload starts with a clean AI panel.
  useEffect(() => {
    if (sourceRef.current === sourceKey) return;
    sourceRef.current = sourceKey;
    resetInsights();
  }, [sourceKey, resetInsights]);

  // Clearing the transcript should also clear derived AI output.
  useEffect(() => {
    if (segments.length === 0) resetInsights();
  }, [segments.length, resetInsights]);

  /**
   * Generates the summary and the translation together in one Gemini call.
   * Both the Translate and Summary buttons call this, so requesting the second
   * view reuses the result of the first instead of hitting Gemini again.
   */
  const runInsights = useCallback(
    async (languageToTranslate: TranslationLanguage) => {
      if (segments.length === 0) return;

      const requestFingerprint = fingerprintRef.current;
      const lastRun = lastRunRef.current;
      if (
        lastRun &&
        lastRun.fingerprint === requestFingerprint &&
        lastRun.targetLanguage === languageToTranslate
      ) {
        return;
      }

      const inFlight = inFlightRef.current;
      if (
        inFlight &&
        inFlight.fingerprint === requestFingerprint &&
        inFlight.targetLanguage === languageToTranslate
      ) {
        return;
      }

      const run: CombinedRun = {
        fingerprint: requestFingerprint,
        targetLanguage: languageToTranslate,
      };
      inFlightRef.current = run;

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setTranslationStatus("loading");
      setTranslationError(null);
      setSummaryStatus("loading");
      setSummaryError(null);

      try {
        const result = await requestInsights({
          fileName,
          language,
          targetLanguage: languageToTranslate,
          segments: segments.map((segment, index) => ({
            index,
            speaker: speakerLabel(segment, { clinicalLabels }),
            timestamp: formatClock((segment.startTime ?? 0) * 1000),
            text: segment.text,
          })),
        });

        if (requestIdRef.current !== requestId) return;
        if (!isConsultationSummary(result.summary)) {
          throw new Error("The AI service returned an unexpected format. Please try again.");
        }

        const byIndex = new Map(
          result.translation.segments.map((entry) => [entry.index, entry.text]),
        );
        setTranslation({
          segments: segments.map((segment, index) => ({
            key: segment.key || `segment-${index}`,
            text: byIndex.get(index) ?? segment.text,
          })),
          targetLanguage: result.translation.targetLanguage,
          model: result.model,
          generatedAt: new Date().toISOString(),
        });
        setTranslationFingerprint(requestFingerprint);
        setTranslationStatus("ready");

        setSummary(result.summary);
        setSummaryModel(result.model ?? null);
        setSummaryFingerprint(requestFingerprint);
        setSummaryStatus("ready");

        lastRunRef.current = {
          fingerprint: requestFingerprint,
          targetLanguage: languageToTranslate,
        };
      } catch (error) {
        if (requestIdRef.current !== requestId) return;
        const message =
          error instanceof Error ? error.message : "AI generation failed. Please try again.";
        setTranslationStatus("error");
        setTranslationError(message);
        setSummaryStatus("error");
        setSummaryError(message);
      } finally {
        if (inFlightRef.current === run) inFlightRef.current = null;
      }
    },
    [clinicalLabels, fileName, language, segments],
  );

  const translate = useCallback(
    (languageToTranslate: TranslationLanguage) => runInsights(languageToTranslate),
    [runInsights],
  );

  const generateSummary = useCallback(
    () => runInsights(targetLanguage),
    [runInsights, targetLanguage],
  );

  return {
    translation,
    translationStatus,
    translationError,
    isTranslationStale:
      translation !== null &&
      translationFingerprint !== null &&
      translationFingerprint !== fingerprint,
    summary,
    summaryModel,
    summaryStatus,
    summaryError,
    isSummaryStale:
      summary !== null && summaryFingerprint !== null && summaryFingerprint !== fingerprint,
    translate,
    generateSummary,
    resetInsights,
  };
}

export type AiInsightsController = ReturnType<typeof useAiInsights>;
