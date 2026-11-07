import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  segmentSpeakerLabel,
  type ConsultationReport,
  type SpeakerRole,
} from "../lib/report";
import type { TranscriptSegment } from "./useAudioStreaming";

/**
 * On-demand structured consultation report for both transcript pipelines.
 *
 * The raw transcript is never modified. The hook sends a copy of the finished
 * segments to `POST /api/report` and keeps the returned report in memory.
 */

export type ConsultationReportState =
  | "idle"
  | "generating"
  | "ready"
  | "error";

interface ReportApiResponse {
  ok?: boolean;
  error?: string;
  report?: ConsultationReport;
}

interface HealthResponse {
  report?: { configured?: boolean };
}

export interface ConsultationReportController {
  report: ConsultationReport | null;
  state: ConsultationReportState;
  error: string | null;
  configured: boolean | null;
  availabilityError: string | null;
  speakers: string[];
  roles: Record<string, SpeakerRole>;
  setRole: (speaker: string, role: SpeakerRole) => void;
  /** True when the transcript changed after the report was generated. */
  isStale: boolean;
  generate: () => void;
  reset: () => void;
}

/** Stable content fingerprint used to detect transcript changes. */
function segmentSignature(segments: TranscriptSegment[]): string {
  let hash = 2166136261;
  for (const segment of segments) {
    const value = [
      segment.key,
      segment.text,
      segment.translatedText ?? "",
      segment.speakerId ?? "",
    ].join("\u0000");
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${segments.length}:${(hash >>> 0).toString(36)}`;
}

export function useConsultationReport(
  segments: TranscriptSegment[],
  mode: "live" | "batch",
): ConsultationReportController {
  const [report, setReport] = useState<ConsultationReport | null>(null);
  const [state, setState] = useState<ConsultationReportState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(
    null,
  );
  const [roles, setRoles] = useState<Record<string, SpeakerRole>>({});
  const [generatedSignature, setGeneratedSignature] = useState<string | null>(
    null,
  );

  const segmentsRef = useRef(segments);
  const signatureRef = useRef(segmentSignature(segments));
  const abortRef = useRef<AbortController | null>(null);

  segmentsRef.current = segments;
  signatureRef.current = segmentSignature(segments);
  const signature = signatureRef.current;

  // Check once whether the server has a report model configured.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/health", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as HealthResponse;
      })
      .then((body) => {
        if (cancelled) return;
        const supported = body.report?.configured === true;
        setConfigured(supported);
        setAvailabilityError(
          supported
            ? null
            : "Consultation reports are not configured on the server.",
        );
      })
      .catch(() => {
        if (cancelled) return;
        setConfigured(false);
        setAvailabilityError(
          "Could not check whether consultation reports are available.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // A cleared transcript must not leave an old report on screen.
  useEffect(() => {
    if (segments.length !== 0) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setReport(null);
    setState("idle");
    setError(null);
    setGeneratedSignature(null);
  }, [segments.length]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const speakers = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const segment of segments) {
      const label = segmentSpeakerLabel(segment);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      result.push(label);
    }
    return result;
  }, [segments]);

  // Drop role assignments for speakers that are no longer present.
  useEffect(() => {
    setRoles((previous) => {
      const next: Record<string, SpeakerRole> = {};
      let changed = false;
      for (const speaker of speakers) {
        if (previous[speaker]) next[speaker] = previous[speaker];
        else changed = true;
      }
      if (Object.keys(previous).length !== Object.keys(next).length) {
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [speakers]);

  const setRole = useCallback((speaker: string, role: SpeakerRole) => {
    setRoles((previous) => ({ ...previous, [speaker]: role }));
  }, []);

  const generate = useCallback(() => {
    if (configured === false) return;
    if (segmentsRef.current.length === 0) return;

    void (async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const requestSignature = signatureRef.current;
      setState("generating");
      setError(null);

      const source = segmentsRef.current;
      const payloadSegments = source
        .map((segment) => {
          const speaker = segmentSpeakerLabel(segment);
          const role = speaker ? roles[speaker] : undefined;
          const text = (segment.translatedText?.trim() || segment.text).trim();

          return {
            id: segment.key,
            text,
            ...(speaker ? { speaker } : {}),
            ...(role && role !== "unknown" ? { role } : {}),
            ...(segment.startTime !== undefined
              ? { startTime: segment.startTime }
              : {}),
            ...(segment.endTime !== undefined
              ? { endTime: segment.endTime }
              : {}),
            ...(segment.language?.name
              ? { language: segment.language.name }
              : {}),
          };
        })
        .filter((segment) => segment.text.length > 0);

      if (payloadSegments.length === 0) {
        setState(report ? "ready" : "idle");
        return;
      }

      try {
        const response = await fetch("/api/report", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ mode, segments: payloadSegments }),
          signal: controller.signal,
        });

        const body = (await response.json().catch(() => ({}))) as
          ReportApiResponse;

        if (controller.signal.aborted) return;

        if (!response.ok) {
          throw new Error(
            body.error || `Report generation failed (HTTP ${response.status}).`,
          );
        }
        if (!body.report) {
          throw new Error("The report service returned an empty report.");
        }

        setReport(body.report);
        setGeneratedSignature(requestSignature);
        setState("ready");
      } catch (failure) {
        if (controller.signal.aborted) return;
        const message =
          failure instanceof Error
            ? failure.message
            : "Report generation failed.";
        setError(message);
        setState("error");
      }
    })();
  }, [configured, mode, report, roles]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setReport(null);
    setState("idle");
    setError(null);
    setGeneratedSignature(null);
  }, []);

  return {
    report,
    state,
    error,
    configured,
    availabilityError,
    speakers,
    roles,
    setRole,
    isStale:
      report !== null &&
      generatedSignature !== null &&
      generatedSignature !== signature,
    generate,
    reset,
  };
}
