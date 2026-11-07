import { useCallback, useEffect, useRef, useState } from "react";
import { BatchInputError, validateBatchFile } from "../lib/batch";
import { describeLanguage } from "../lib/languages";
import {
  cancelDiarizationJob,
  createDiarizationJob,
  downloadDiarizationTranscript,
  getDiarizationFiles,
  getDiarizationJobStatus,
  startDiarizationJob,
} from "../services/transcriptionService";
import type { TranscriptSegment } from "./useAudioStreaming";

export type DiarizationState =
  | "idle"
  | "selected"
  | "uploading"
  | "created"
  | "starting"
  | "polling"
  | "downloading"
  | "complete"
  | "error";

interface DiarizeFileInfo {
  name: string;
  size: number;
  type: string;
}

const POLL_INTERVAL_MS = 10_000; // Gnani recommends >= 10s between polls
const MAX_POLL_ATTEMPTS = 180; // ~30 minutes max
/** Gnani Batch direct-upload limit. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Hook for Gnani Batch STT with speaker diarization.
 *
 * Flow: upload file → create job → start → poll status → fetch transcripts
 * → download segment-level results with speaker_id labels.
 *
 * The GNANI_API_KEY never reaches the browser; all Gnani calls are proxied
 * through the server at /api/stt/batch/diarize/*.
 */
export function useBatchDiarization() {
  const [state, setState] = useState<DiarizationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [fileInfo, setFileInfo] = useState<DiarizeFileInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [fullTranscript, setFullTranscript] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [speakerCount, setSpeakerCount] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [language, setLanguage] = useState<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);
  const pollAttemptsRef = useRef(0);
  const jobIdRef = useRef<string | null>(null);
  const cancelRef = useRef(false);
  const selectedFileRef = useRef<File | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const clearSegments = useCallback(() => {
    setSegments([]);
    setFullTranscript("");
    setSpeakerCount(0);
    setDurationMs(0);
    setLanguage(null);
  }, []);

  const fail = useCallback(
    (message: string) => {
      stopPolling();
      setError(message);
      setState("error");
    },
    [stopPolling],
  );

  const select = useCallback((file: File) => {
    stopPolling();
    cancelRef.current = false;
    setError(null);
    clearSegments();
    setProgress(0);
    setJobId(null);
    jobIdRef.current = null;

    try {
      if (file.size > MAX_FILE_BYTES) {
        throw new BatchInputError(
          "This file is larger than 10 MB. Choose a smaller file or compress it (e.g. MP3) first.",
        );
      }
      validateBatchFile(file);
    } catch (failure) {
      if (failure instanceof BatchInputError) {
        setError(failure.message);
        setState("error");
        return;
      }
      throw failure;
    }

    selectedFileRef.current = file;
    setFileInfo({
      name: file.name,
      size: file.size,
      type: file.type,
    });
    setState("selected");
  }, [clearSegments, stopPolling]);

  /** Starts the diarization flow on the previously selected file. */
  // generate is defined after run below (run must exist first).

  /**
   * Uploads the file and creates a diarization job on the server proxy.
   */
  const createJob = useCallback(
    async (file: File) => {
      setState("uploading");
      setProgress(10);

      const job = await createDiarizationJob(file);
      setJobId(job.job_id);
      jobIdRef.current = job.job_id;
      setProgress(25);
      setState("created");
      return job;
    },
    [],
  );

  const startJob = useCallback(async (jobId: string) => {
    setState("starting");
    const job = await startDiarizationJob(jobId);
    setProgress(40);
    setState("polling");
    return job;
  }, []);

  const pollStatus = useCallback(async (jobId: string) => {
    return getDiarizationJobStatus(jobId);
  }, []);

  const fetchFiles = useCallback(async (jobId: string) => {
    return getDiarizationFiles(jobId);
  }, []);

  const downloadTranscript = useCallback(async (url: string) => {
    return downloadDiarizationTranscript(url);
  }, []);

  const run = useCallback(
    async (file: File) => {
      select(file);

      try {
        const job = await createJob(file);
        await startJob(job.job_id);

        pollAttemptsRef.current = 0;
        pollTimerRef.current = window.setInterval(async () => {
          if (cancelRef.current) {
            stopPolling();
            return;
          }

          pollAttemptsRef.current += 1;
          if (pollAttemptsRef.current > MAX_POLL_ATTEMPTS) {
            stopPolling();
            fail("Diarization job timed out. Please try again.");
            return;
          }

          try {
            const status = await pollStatus(job.job_id);
            setProgress(50 + Math.min(40, (status.progress?.completed_files ?? 0) * 10));

            if (status.status === "COMPLETED" || status.status === "PARTIAL_FAILURE") {
              stopPolling();
              setState("downloading");
              setProgress(90);

              try {
                const files = await fetchFiles(job.job_id);
                const completed = files.filter((f) => f.transcript_url);

                if (completed.length === 0) {
                  fail("No transcripts were produced. Try another file.");
                  return;
                }

                // Download and merge all completed transcripts.
                const allSegments: TranscriptSegment[] = [];
                let fullText = "";
                let durationSeconds = 0;
                let detectedLanguage: string | null = null;
                const speakerIds = new Set<number | null>();

                for (const fileEntry of completed) {
                  const transcriptUrl = fileEntry.transcript_url;
                  if (!transcriptUrl) continue;
                  const transcript = await downloadTranscript(transcriptUrl);
                  fullText += (fullText ? "\n" : "") + transcript.full_transcript;
                  durationSeconds += transcript.duration_seconds || 0;
                  detectedLanguage =
                    detectedLanguage ??
                    transcript.language_detected ??
                    transcript.language_code ??
                    fileEntry.language_code ??
                    null;

                  for (const seg of transcript.segments) {
                    if (seg.text && seg.text.trim()) {
                      const text = seg.text.trim();
                      const speaker = seg.speaker_id ?? null;
                      if (speaker !== null) speakerIds.add(speaker);
                      allSegments.push({
                        key: `diarize:${fileEntry.original_path}:${seg.segment_id}`,
                        text,
                        language: describeLanguage(
                          seg.language_detected ?? detectedLanguage,
                        ),
                        segmentIndex: seg.segment_id,
                        speakerId: speaker,
                        startTime: seg.start_time,
                        endTime: seg.end_time,
                        receivedAt: Date.now(),
                      });
                    }
                  }
                }

                setSegments(allSegments);
                setFullTranscript(fullText);
                setSpeakerCount(speakerIds.size);
                setDurationMs(Math.round(durationSeconds * 1000));
                setLanguage(describeLanguage(detectedLanguage)?.name ?? null);
                setProgress(100);
                setState("complete");
              } catch (downloadError) {
                fail(
                  downloadError instanceof Error
                    ? downloadError.message
                    : "Failed to download transcripts.",
                );
              }
              return;
            }

            if (status.status === "FAILED" || status.status === "CANCELLED") {
              stopPolling();
              fail(
                `Diarization job ${status.status.toLowerCase()}. ${
                  (status as any).cancel_reason || ""
                }`.trim(),
              );
              return;
            }
          } catch (pollError) {
            // Polling errors are retried on the next interval; don't fail fast.
            console.warn("[diarize] poll error", pollError);
          }
        }, POLL_INTERVAL_MS);
      } catch (failure) {
        stopPolling();
        setError(
          failure instanceof Error ? failure.message : "Diarization failed. Please try again.",
        );
        setState("error");
      }
    },
    [createJob, startJob, pollStatus, fetchFiles, downloadTranscript, select, fail, stopPolling],
  );

  /** Starts the diarization flow on the previously selected file. */
  const generate = useCallback(() => {
    const file = selectedFileRef.current;
    if (!file) return;
    if (
      state === "uploading" ||
      state === "created" ||
      state === "starting" ||
      state === "polling" ||
      state === "downloading"
    ) {
      return;
    }
    void run(file);
  }, [run, state]);

  /** Stops polling and asks Gnani to cancel the running job (best effort). */
  const cancel = useCallback(() => {
    const id = jobIdRef.current;
    cancelRef.current = true;
    stopPolling();
    if (id) void cancelDiarizationJob(id);
    setError(null);
    setState("idle");
    setJobId(null);
    jobIdRef.current = null;
    clearSegments();
    setProgress(0);
  }, [stopPolling, clearSegments]);

  const reset = useCallback(() => {
    cancelRef.current = true;
    stopPolling();
    setError(null);
    clearSegments();
    setFileInfo(null);
    setProgress(0);
    setJobId(null);
    jobIdRef.current = null;
    setFullTranscript("");
    setSpeakerCount(0);
    setState("idle");
  }, [clearSegments, stopPolling]);

  useEffect(() => {
    return () => {
      cancelRef.current = true;
      stopPolling();
    };
  }, [stopPolling]);

  return {
    state,
    error,
    segments,
    fileInfo,
    progress,
    fullTranscript,
    jobId,
    speakerCount,
    durationMs,
    language,
    maxFileBytes: MAX_FILE_BYTES, // Gnani direct-upload limit
    select,
    generate,
    run,
    cancel,
    reset,
  };
}

export type BatchDiarizationController = ReturnType<typeof useBatchDiarization>;
