/**
 * Browser-side transcription service.
 *
 * All calls go through the local Express proxy. Audio and the Gnani API key
 * never leave the server. This module isolates transport details so the
 * realtime/batch hooks can be swapped for a different provider later.
 */

export interface BatchJob {
  job_id: string;
  status: string;
}

export interface BatchJobStatus {
  job_id: string;
  status: string;
  progress?: { completed_files: number; total_files: number };
  cancel_reason?: string;
}

export interface BatchFile {
  file_id: string;
  original_path: string;
  transcript_url: string | null;
  language_code?: string;
  duration_seconds?: number;
  status: string;
}

export interface BatchTranscript {
  full_transcript: string;
  language_code?: string;
  language_detected?: string;
  duration_seconds: number;
  segments: Array<{
    segment_id: number;
    start_time: number;
    end_time: number;
    text: string;
    confidence: number | null;
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

export async function createBatchJob(file: File): Promise<BatchJob> {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch("/api/stt/batch", {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to create the transcription job."));
  }

  return (await response.json()) as BatchJob;
}

export async function startBatchJob(jobId: string): Promise<BatchJob> {
  const response = await fetch(
    `/api/stt/batch/${encodeURIComponent(jobId)}/start`,
    { method: "POST" },
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to start the transcription job."));
  }

  return (await response.json()) as BatchJob;
}

export async function getBatchJobStatus(
  jobId: string,
): Promise<BatchJobStatus> {
  const response = await fetch(`/api/stt/batch/${encodeURIComponent(jobId)}`);

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to check the transcription job."));
  }

  return (await response.json()) as BatchJobStatus;
}

export async function getBatchJobFiles(jobId: string): Promise<BatchFile[]> {
  const response = await fetch(
    `/api/stt/batch/${encodeURIComponent(jobId)}/files?status=COMPLETED`,
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to fetch the transcript files."));
  }

  const body = (await response.json()) as { data: BatchFile[] };
  return body.data ?? [];
}

export async function downloadBatchTranscript(
  transcriptUrl: string,
): Promise<BatchTranscript> {
  const response = await fetch(
    `/api/stt/batch/download?url=${encodeURIComponent(transcriptUrl)}`,
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to download the transcript."));
  }

  return (await response.json()) as BatchTranscript;
}

export async function cancelBatchJob(jobId: string): Promise<void> {
  await fetch(`/api/stt/batch/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  }).catch(() => undefined);
}
