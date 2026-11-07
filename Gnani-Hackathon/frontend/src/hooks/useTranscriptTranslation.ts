import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SegmentTranslationState,
  TranscriptSegment,
} from "./useAudioStreaming";

/**
 * Shared English-translation controller for both transcript pipelines.
 *
 * Realtime and batch segments are translated through the same server route.
 * The raw `text` is never changed; a successful translation is exposed as
 * `translatedText` on a copy of the segment.
 */

interface TranslationEntry {
  state: SegmentTranslationState;
  text?: string;
  error?: string;
}

interface TranslationApiResponse {
  ok?: boolean;
  error?: string;
  translations?: Array<{ id: string; text: string }>;
}

interface HealthResponse {
  translation?: { configured?: boolean };
}

export interface TranscriptTranslationController {
  /** Segments with optional `translatedText` / `translationState` merged in. */
  segments: TranscriptSegment[];
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  /** null while the server availability check is still running. */
  configured: boolean | null;
  isTranslating: boolean;
  translatedCount: number;
  error: string | null;
  availabilityError: string | null;
  retry: () => void;
}

const DEBOUNCE_MS = 450;
/** Keep each Gemini request small so batches finish quickly. */
const CHUNK_SIZE = 20;

export function useTranscriptTranslation(
  segments: TranscriptSegment[],
): TranscriptTranslationController {
  const [enabled, setEnabledState] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, TranslationEntry>>({});
  const [error, setError] = useState<string | null>(null);

  const entriesRef = useRef<Record<string, TranslationEntry>>({});
  const segmentsRef = useRef(segments);
  const enabledRef = useRef(false);
  const configuredRef = useRef<boolean | null>(null);
  const pendingRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef(false);
  /** Bumped when the transcript is cleared or translation is switched off. */
  const generationRef = useRef(0);

  segmentsRef.current = segments;

  const commitEntries = useCallback(
    (
      update: (
        previous: Record<string, TranslationEntry>,
      ) => Record<string, TranslationEntry>,
    ) => {
      setEntries((previous) => {
        const next = update(previous);
        entriesRef.current = next;
        return next;
      });
    },
    [],
  );

  // Ask the server once whether translation is available, then default to on.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/health", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as HealthResponse;
      })
      .then((body) => {
        if (cancelled) return;
        const supported = body.translation?.configured === true;
        configuredRef.current = supported;
        setConfigured(supported);
        if (supported) {
          enabledRef.current = true;
          setEnabledState(true);
          setAvailabilityError(null);
        } else {
          setAvailabilityError("English translation is not configured on the server.");
        }
      })
      .catch(() => {
        if (cancelled) return;
        configuredRef.current = false;
        setConfigured(false);
        setAvailabilityError("Could not check whether English translation is available.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // A cleared transcript starts a fresh translation pass.
  useEffect(() => {
    if (segments.length !== 0) return;
    generationRef.current += 1;
    pendingRef.current.clear();
    inFlightRef.current = false;
    entriesRef.current = {};
    setEntries({});
    setError(null);
  }, [segments.length]);

  const setEnabled = useCallback(
    (next: boolean) => {
      enabledRef.current = next;
      setEnabledState(next);
      setError(null);

      if (next) return;

      // Stop pending work. Completed translations are kept so toggling back on
      // is instant for text that has already been translated.
      generationRef.current += 1;
      pendingRef.current.clear();
      inFlightRef.current = false;
      commitEntries((previous) => {
        const cleaned = { ...previous };
        for (const [key, entry] of Object.entries(cleaned)) {
          if (entry.state === "pending") delete cleaned[key];
        }
        return cleaned;
      });
    },
    [commitEntries],
  );

  const retry = useCallback(() => {
    setError(null);
    commitEntries((previous) => {
      const next = { ...previous };
      for (const [key, entry] of Object.entries(next)) {
        if (entry.state === "error") delete next[key];
      }
      return next;
    });
  }, [commitEntries]);

  const flush = useCallback(async () => {
    if (inFlightRef.current) return;
    if (!enabledRef.current || configuredRef.current !== true) return;

    const source = segmentsRef.current;
    if (source.length === 0) return;

    const candidates = source.filter((segment) => {
      if (!segment.text.trim()) return false;
      if (pendingRef.current.has(segment.key)) return false;
      return entriesRef.current[segment.key] === undefined;
    });
    if (candidates.length === 0) return;

    const chunk = candidates.slice(0, CHUNK_SIZE);
    const generation = generationRef.current;
    inFlightRef.current = true;
    setError(null);
    for (const segment of chunk) pendingRef.current.add(segment.key);
    commitEntries((previous) => {
      const next = { ...previous };
      for (const segment of chunk) next[segment.key] = { state: "pending" };
      return next;
    });

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          segments: chunk.map((segment) => ({
            id: segment.key,
            text: segment.text,
            ...(segment.language?.name ? { language: segment.language.name } : {}),
          })),
        }),
      });

      const body = (await response.json().catch(() => ({}))) as TranslationApiResponse;
      if (generation !== generationRef.current) return;

      if (!response.ok) {
        throw new Error(
          body.error || `Translation failed (HTTP ${response.status}).`,
        );
      }

      const byId = new Map<string, string>();
      for (const item of body.translations ?? []) {
        if (
          item &&
          typeof item.id === "string" &&
          typeof item.text === "string" &&
          item.text.trim()
        ) {
          byId.set(item.id, item.text.trim());
        }
      }

      commitEntries((previous) => {
        const next = { ...previous };
        for (const segment of chunk) {
          const translated = byId.get(segment.key);
          next[segment.key] = translated
            ? { state: "done", text: translated }
            : {
                state: "error",
                error: "No translation was returned for this segment.",
              };
        }
        return next;
      });
    } catch (failure) {
      if (generation !== generationRef.current) return;
      const message =
        failure instanceof Error ? failure.message : "Translation failed.";
      setError(message);
      commitEntries((previous) => {
        const next = { ...previous };
        for (const segment of chunk) {
          next[segment.key] = { state: "error", error: message };
        }
        return next;
      });
    } finally {
      for (const segment of chunk) pendingRef.current.delete(segment.key);
      inFlightRef.current = false;
    }
  }, [commitEntries]);

  // Debounce so a burst of batch segments is translated in a few requests,
  // while each realtime utterance still follows quickly.
  useEffect(() => {
    if (!enabled || configured !== true || segments.length === 0) return;
    const timer = window.setTimeout(() => {
      void flush();
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [segments, enabled, configured, entries, flush]);

  const translatedSegments = useMemo(() => {
    if (segments.length === 0) return segments;

    let changed = false;
    const next = segments.map((segment) => {
      const entry = entries[segment.key];
      if (!entry) return segment;
      changed = true;

      if (entry.state === "done" && entry.text) {
        return {
          ...segment,
          translatedText: entry.text,
          translationState: "done" as const,
          translationError: null,
        };
      }
      if (entry.state === "error") {
        return {
          ...segment,
          translatedText: null,
          translationState: "error" as const,
          translationError: entry.error ?? null,
        };
      }
      return {
        ...segment,
        translatedText: null,
        translationState: "pending" as const,
        translationError: null,
      };
    });

    return changed ? next : segments;
  }, [segments, entries]);

  const isTranslating = useMemo(
    () => Object.values(entries).some((entry) => entry.state === "pending"),
    [entries],
  );
  const translatedCount = useMemo(
    () => Object.values(entries).filter((entry) => entry.state === "done").length,
    [entries],
  );

  return {
    segments: translatedSegments,
    enabled,
    setEnabled,
    configured,
    isTranslating,
    translatedCount,
    error,
    availabilityError,
    retry,
  };
}
