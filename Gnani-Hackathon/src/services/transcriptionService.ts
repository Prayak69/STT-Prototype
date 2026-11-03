/**
 * Browser-side transcription service.
 *
 * All calls go through the local Express proxy. Audio and the Gnani API key
 * never leave the server. This module isolates transport details so the
 * realtime/batch hooks can be swapped for a different provider later.
 */

export interface DiarizationJob {
  job_id: string;
  status: string;
}

export interface DiarizationJobStatus {
  job_id: string;
  status: string;
  progress?: { completed_files: number; total_files: number };
  cancel_reason?: string;
}

export interface DiarizationFile {
  file_id: string;
  original_path: string;
  transcript_url: string | null;
  language_code?: string;
  duration_seconds?: number;
  status: string;
}

export interface DiarizationTranscript {
  full_transcript: string;
  language_code?: string;
  language_detected?: string;
  duration_seconds: number;
  segments: Array<{
    segment_id: number;
    start_time: number;
    end_time: number;
    text: string;
    speaker_id: number | null;
    language_detected: string | null;
  }>;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export async function createDiarizationJob(file: File): Promise<DiarizationJob> {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch("/api/stt/batch/diarize", {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to create the transcription job."));
  }

  return (await response.json()) as DiarizationJob;
}

export async function startDiarizationJob(jobId: string): Promise<DiarizationJob> {
  const response = await fetch(
    `/api/stt/batch/diarize/${encodeURIComponent(jobId)}/start`,
    { method: "POST" },
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to start the transcription job."));
  }

  return (await response.json()) as DiarizationJob;
}

export async function getDiarizationJobStatus(
  jobId: string,
): Promise<DiarizationJobStatus> {
  const response = await fetch(`/api/stt/batch/diarize/${encodeURIComponent(jobId)}`);

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to check the transcription job."));
  }

  return (await response.json()) as DiarizationJobStatus;
}

export async function getDiarizationFiles(jobId: string): Promise<DiarizationFile[]> {
  const response = await fetch(
    `/api/stt/batch/diarize/${encodeURIComponent(jobId)}/files?status=COMPLETED`,
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to fetch the transcript files."));
  }

  const body = (await response.json()) as { data: DiarizationFile[] };
  return body.data ?? [];
}

export async function downloadDiarizationTranscript(
  transcriptUrl: string,
): Promise<DiarizationTranscript> {
  const response = await fetch(
    `/api/stt/batch/diarize/download?url=${encodeURIComponent(transcriptUrl)}`,
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to download the transcript."));
  }

  return (await response.json()) as DiarizationTranscript;
}

export async function cancelDiarizationJob(jobId: string): Promise<void> {
  await fetch(`/api/stt/batch/diarize/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  }).catch(() => undefined);
}
