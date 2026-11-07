/**
 * Offline-ish diagnostic: talks directly to the Gnani Batch API (uses the
 * server config/.env) to find out why a diarized batch job fails.
 *
 * Run: npx tsx scripts/probe-diarize.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { config } from "../server/config";
import {
  buildBatchJobForm,
  createBatchJob,
  getBatchJobFiles,
  getBatchJobStatus,
  startBatchJob,
  downloadBatchTranscript,
} from "../server/gnaniBatch";

function restBase(): string {
  return config.stt.url
    .replace(/^wss:\/\//i, "https://")
    .replace(/^ws:\/\//i, "http://")
    .replace(/\/stt\/v3\/stream$/i, "");
}

/** Windows-SAPI speech WAV (has real speech content). */
function inputWavPath(): string {
  return process.env["PROBE_WAV"] ?? path.join(tmpdir(), "speech.wav");
}

function readWav(): Buffer {
  return readFileSync(inputWavPath());
}

async function main(): Promise<void> {
  const base = restBase();
  console.log("Batch REST base:", base, "| WAV:", inputWavPath());

  const form = buildBatchJobForm(
    { buffer: readWav(), name: "probe.wav", type: "audio/wav" },
    { languageCode: "indic-auto", withDiarization: true },
  );

  console.log("--- create (with_diarization: true) ---");
  const created = await createBatchJob(form);
  console.log(JSON.stringify(created, null, 2));

  console.log("--- start ---");
  console.log(JSON.stringify(await startBatchJob(created.job_id), null, 2));

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    const status = await getBatchJobStatus(created.job_id);
    console.log(`--- poll ${attempt + 1} ---`);
    console.log(JSON.stringify(status, null, 2));

    if (status.status === "COMPLETED" || status.status === "PARTIAL_FAILURE") {
      const files = await getBatchJobFiles(created.job_id);
      console.log("--- files ---");
      console.log(JSON.stringify(files, null, 2));
      const entry = files.find((f) => f.transcript_url);
      if (entry?.transcript_url) {
        const doc = await downloadBatchTranscript(entry.transcript_url);
        console.log("--- transcript (first 5 segments) ---");
        console.log(JSON.stringify(doc.segments.slice(0, 5), null, 2));
      }
      break;
    }
    if (status.status === "FAILED" || status.status === "CANCELLED") {
      // Pull per-file error messages so the failure reason is visible.
      try {
        const files = await getBatchJobFiles(created.job_id);
        console.log("--- failed file details ---");
        console.log(JSON.stringify(files, null, 2));
      } catch (detailError) {
        console.log("(could not fetch file details:", detailError, ")");
      }
      break;
    }
  }
}

main().catch((error) => {
  console.error("PROBE FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
