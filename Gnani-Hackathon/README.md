# VoxNote — Clinical transcription on Gnani Prisma v3.0

Real-time and batch, multilingual **speech-to-text with automatic speaker diarization**, a persistent side transcript, Gemini-powered **clinical summaries and translation**, and downloadable records — powered by **Gnani Prisma v3.0**.

Two independent transcription pipelines, one clinical dashboard:

| | Realtime | Batch (uploaded file) |
| --- | --- | --- |
| Input | Microphone | Audio file (≤ 10 MB) |
| Endpoint | `WS /ws/stt/realtime` → Gnani realtime WebSocket | `POST /api/stt/batch/diarize` → Gnani Batch Jobs REST API |
| Output | Live transcript, language per utterance, **`Speaker N`** from the local pyannote sidecar | Full transcript + **`speaker_id` per segment** (diarized by Gnani) + timestamps |
| Latency | Sub-second per utterance | Minutes (async job, polled every 10 s) |
| Languages | Auto-detected (`indic-auto`) | Auto-detected (`indic-auto`) |

The transcript panel stays visible on the right on wide screens and opens as a slide-over elsewhere, so live speech never requires scrolling. **Both the Gnani and Gemini API keys never leave the server.**

---

## Quick start

**Requirements:** Node.js **20.19+** (or 22.12+), a microphone (for realtime), a Gnani API key, and optionally a Google Gemini key for summaries/translation.

1. Put your keys in `.env` in this folder (`Gnani-Hackathon/.env` — keep it out of version control). Include `HF_TOKEN` for the pyannote sidecar:

   ```env
   GNANI_API_KEY=your-gnani-api-key
   HF_TOKEN=your-hugging-face-token
   PORT=8787

   # Optional: clinical summaries and transcript translation
   GEMINI_API_KEY=your-gemini-api-key
   GEMINI_MODEL=gemini-3.6-flash
   GEMINI_FALLBACK_MODELS=gemini-3.8-flash,gemini-3.5-flash
   ```

   Without a Gemini key the app still runs; summaries and translation require the key.

2. Install and run:

   ```bash
   npm install
   npm run dev
   ```

3. Open **http://localhost:5173**

   The Vite dev server proxies `/api` and `/ws` to the backend on port `8787`.

### Production-style run

```bash
npm run build
npm start
```

Open **http://localhost:8787** — Express serves the built frontend and hosts both the WebSocket proxy and the REST proxy on the same origin.

> Do **not** open the HTML file directly (`file://`). `getUserMedia` requires a secure context: `localhost` or HTTPS.

### Realtime speaker labels (pyannote sidecar)

Gnani realtime returns text only — there is no `speaker_id` on the streaming
API. The app adds one locally with `pyannote/speaker-diarization-3.1`, without
touching the batch path (Gnani Batch already diarizes).

```
Browser ──PCM──► Node /ws/stt/realtime ──PCM──► Gnani (connected/transcript)
                            │
                            └── same PCM ──► diarizer_server.py (pyannote 3.1)
                                                  └── speaker timeline
```

The sidecar re-diarizes the trailing window every few seconds and returns a
stable `Speaker 1` / `Speaker 2` / `Speaker N` timeline with absolute timestamps. Node
labels each transcript by time; when a transcript arrives before its window is
covered, the label is sent a few seconds later as a `speaker_update`.

When recording stops, the proxy waits for the last transcript and then asks the
sidecar for one **final, wider pass** (up to 90 s of audio). That labels the tail
of the consultation — the part the rolling 18 s window had not covered yet — and
sends a closing `speaker_update` with `final: true` before the browser saves the
session. Without that pass, a final utterance could be stored with a bare
`Speaker` label.

1. Accept the conditions on Hugging Face for **both**
   [`pyannote/speaker-diarization-3.1`](https://huggingface.co/pyannote/speaker-diarization-3.1)
   and [`pyannote/segmentation-3.0`](https://huggingface.co/pyannote/segmentation-3.0).
2. Put your token in `.env` in this folder (alongside `GNANI_API_KEY`); the
   sidecar reads `HF_TOKEN` from it. It never reads the repository root.
3. Create a self-contained virtualenv for the sidecar:

   ```powershell
   cd Gnani-Hackathon
   python -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

4. Start the sidecar in its own terminal:

   ```powershell
   cd Gnani-Hackathon
   .\.venv\Scripts\python.exe diarizer_server.py
   ```

It listens on `ws://127.0.0.1:8790`. Options: `--num-speakers 0` (auto-detect, default; pass `2`, `3`, ... to force a count),
`--window 18`, `--hop 4`, or the `DIARIZER_*` variables in `.env`.

A GPU is strongly recommended. On CPU an 18 s window may take longer than the
4 s hop, so labels update more slowly — the sidecar never queues overlapping
passes. The final pass at stop can also take a few seconds on CPU; the UI waits
for it (with a timeout) before saving the session. Set `DIARIZATION_ENABLED=false`
to run realtime without labels. If the sidecar is not running, realtime
transcription still works; it simply shows no speaker badges.

---

## Feature tour

### 1. Realtime microphone transcription

- Click **Record Audio** → your mic streams to Gnani through the secure proxy.
- Each finished utterance appears with a **language badge** (Prisma detects the language per utterance — Indian English, Hindi, Tamil, Telugu, Bengali, Marathi, Gujarati, Kannada, Malayalam, Punjabi, including code-switching).
- With the pyannote sidecar running, each utterance also gets a green **Speaker N** badge. Labels can arrive a few seconds after the text (see [Realtime speaker labels](#realtime-speaker-labels-pyannote-sidecar)).
- Live waveform, recording timer, speech/processing indicators, connection status.
- **Stop** finalizes gracefully: trailing silence → `commit` → wait for the last transcript → close, so the final sentence is never lost.

### 2. Batch upload with speaker diarization

1. Click **Upload Audio** and choose a file → the app validates it and shows a **ready state**. Nothing is sent yet in this confirmed two-step flow.
2. Click **Generate Transcript** → the file uploads to *your* server, which creates a Gnani **Batch STT job** with `with_diarization: true`.
3. The panel tracks every stage — *Ready → Uploading → Starting job → Diarizing → Fetching transcripts → Complete* — with a progress bar. Status is polled every 10 s automatically.
4. When done, segments appear with green **Speaker N** badges and `start – end` timestamps. Cancel stops local polling **and** asks Gnani to cancel the running job (best effort).

**You upload once, click once.** Diarization is configured entirely on the backend — the frontend has no language, model or speaker options.

### 3. Persistent transcript panel

- A sticky side rail keeps the transcript in view while you record, upload, or review history.
- **Transcript / Translate / Summary / Details** tabs share one session context.
- Copy the whole transcript (with clipboard fallback for older browsers), confirm-to-clear, and export **TXT or JSON**.
- Empty/error states explain what happened ("No speech detected", "No transcript produced").
- Realtime and batch use **separate state**, so neither can clear or interrupt the other.

### 4. Gemini summaries and translation

- **Translate** the full transcript into English, Hindi, or Hinglish. Speaker labels, timestamps, and medication names are preserved; transcription and translation can be downloaded separately.
- **Generate summary** produces a structured clinical note: chief complaint, symptoms, history, medications, assessment, plan, follow-up, and red flags. Missing details are marked “Not stated”.
- Summaries and translations are generated server-side with Gemini, with model fallback and retry when the primary model is busy.
- Both are produced by a **single Gemini request** per transcript: the Translate and Summary tabs stay separate in the UI, but opening either one reuses the same combined result instead of calling the model twice.
- Detected speakers are always numbered **Speaker 1**, **Speaker 2**, **Speaker 3**, and so on (never role names such as Doctor/Patient).
- Summaries and translations are generated only from the session's own transcript.

### 5. Session history

- Finished live and upload sessions are saved into the current browser tab and listed with date, duration, language, and speaker count.
- History is in-memory only: refreshing the tab clears recorded sessions.

### 6. Downloads

| Content | Formats | Notes |
| --- | --- | --- |
| Transcript | TXT, JSON | Includes speaker labels and timestamps |
| Translation | TXT, JSON | Includes source text in JSON for auditing |
| Summary | TXT, JSON | Structured clinical sections and model name |

---

## Architecture

```
REALTIME (streaming, unchanged flow)
Browser                          Node server                        Gnani
───────                          ───────────                        ─────
getUserMedia
  → AudioContext
  → AudioWorklet ──PCM 1 KB──►  /ws/stt/realtime  ──+ x-api-key-id ──►  wss://api.vachana.ai/stt/v3/stream
    mono 16 kHz                                                  ◄── connected / speech_start /
    s16le, 32 ms                                                     processing / transcript (JSON)

BATCH + DIARIZATION (REST jobs)
Browser                          Node server                        Gnani
───────                          ───────────                        ─────
POST /api/stt/batch/diarize ──►  multipart forward ────────────►   POST /stt/v3/batch/jobs
   (original file bytes)             config: model prisma-v3.0     → 201 { job_id, CREATED }
                                     format transcribe
                                     with_diarization true
POST /:id/start ─────────────►  ─────────────────────────────►   POST /stt/v3/batch/jobs/:id/start
GET  /:id (every 10 s) ──────►  ───── polling ────────────────►  GET /stt/v3/batch/jobs/:id
GET  /:id/files ─────────────►  ─────────────────────────────►  GET .../files?status=COMPLETED
GET  /download?url=... ──────►  fetch transcript_url ─────────►  (presigned URL)
                                  ◄── segments[] with speaker_id ─

CLINICAL AI (optional, after transcription)
Browser                          Node server                        Google Gemini
───────                          ───────────                        ─────────────
POST /api/ai/analyze ─────────►  prompt + JSON schema ───────────►  generateContent
                                  (summary + translation, one call)  ◄── structured JSON
                                  ◄── normalized result
```

### What the server does for batch (all transparent to the user)

| Concern | Handling |
| --- | --- |
| Wrong file extensions | The real container is **sniffed from magic bytes** (`OggS`, `RIFF/WAVE`, `ID3`, `ftyp`, `fLaC`, `AMR`, EBML…) and the filename is normalized before upload — WhatsApp voice notes that masquerade as `.mpeg` are fixed automatically. |
| Gnani rate limits | Every Gnani REST call is wrapped in a retry: on **429** it retries up to **4 times** with backoff (honours `Retry-After`, otherwise 2 s → 4 s → 6 s → 8 s). Logged as `Gnani rate limited; retrying`. |
| Slow processing | Diarization is an async job; the frontend polls `/status` every **10 s** (Gnani's recommended minimum) for up to **30 minutes**. |
| Cancel | `Cancel` stops polling and calls Gnani's `/cancel` endpoint so the job stops server-side too. |
| Route safety | The literal `/download` route is registered **before** `/:jobId` routes so Express never parses `"download"` as a UUID. |
| Secrets | `x-api-key-id` is attached **only** on the server; the browser talks to your server, never to Gnani. |

### Realtime session tuning (server-side headers)

```
x-api-key-id:       GNANI_API_KEY   (from .env, never sent to the browser)
model:              prisma-v3.0
language_code:      indic-auto
x-sample-rate:      16000
format:             transcribe
x-min-silence-ms:   500
x-vad-threshold:    0.6
x-idle-timeout-sec: 300   ← keeps quiet sessions alive past Gnani's 60 s default
x-max-speech-s:     30    ← forces a transcript mid-monologue so results keep flowing
```

---

## Batch input requirements & limits

| Item | Value |
| --- | --- |
| Max file size | **10 MB** (Gnani's direct-upload limit) |
| Accepted extensions (browser picker) | `audio/*`, `.wav`, `.mp3`, `.m4a`, `.aac`, `.ogg`, `.oga`, `.opus`, `.flac`, `.webm`, `.mpeg`, `.mpga`, `.mp4` |
| Accepted by Gnani | `.aac .amr .flac .m4a .mp3 .mp4 .ogg .opus .wav .webm` — mismatched extensions are auto-corrected via magic-byte sniffing |
| Max speakers | Up to `num_speakers: 5` (Prisma v3.0 produces labels regardless; the flag only decides whether a diarization failure fails the file) |
| Max audio duration | 4 h per file (Gnani), but 10 MB usually binds first — use MP3/OGG for long recordings |
| Poll interval | 10 s; job polling gives up after ~30 minutes |
| `transcript_url` expiry | 1 h — refunded automatically by re-fetching files |

**Why 10 MB?** Gnani's Batch API caps direct multipart uploads at 10 MB; larger files need their presigned-upload flow (`POST /stt/v3/batch/v2/jobs`), not yet implemented here.

---

## Project structure

```
.
├── server/
│   ├── server.ts              # Express app: static hosting, health, Gnani batch routes, AI routes
│   ├── gnaniWebSocket.ts      # Realtime WS proxy
│   ├── gnaniBatch.ts          # Gnani Batch Jobs REST client: create/start/poll/files/download/cancel
│   ├── gemini.ts              # Gemini summaries/translation: prompts, schemas, fallback models
│   ├── config.ts              # .env loading, Gnani + Gemini constants
│   └── logger.ts              # Structured console logger
├── src/
│   ├── App.tsx                # Pages, session/history state, sticky rail + mobile drawer
│   ├── components/
│   │   ├── Sidebar.tsx, Header.tsx, DashboardPage.tsx, SettingsPage.tsx
│   │   ├── TranscriptRail.tsx     # Side transcript panel with AI tabs
│   │   ├── TranscriptView.tsx, TranslationView.tsx, SummaryView.tsx, DetailsView.tsx
│   │   ├── HistoryTable.tsx       # Session list and filters
│   │   ├── BatchPanel.tsx, RecordingPanel.tsx, StartActions.tsx
│   │   ├── LiveTranscription.tsx  # Shared segment list with speaker + time badges
│   │   └── AudioVisualizer.tsx, StatusBadge.tsx, ErrorBanner.tsx, Tabs.tsx
│   ├── hooks/
│   │   ├── useAudioStreaming.ts    # Realtime: capture → WS → segments (state machine)
│   │   ├── useBatchDiarization.ts  # Batch: select → generate → upload → poll → download
│   │   ├── useAiInsights.ts        # Summary/translation state and stale detection
│   │   ├── useAiStatus.ts          # Server AI configuration
│   │   └── useBatchProcessing.ts   # Legacy local-decode WS batch (unused by UI, kept for tests)
│   ├── lib/
│   │   ├── transcript.ts          # Speaker labels, TXT/JSON builders, copy/download helpers
│   │   ├── settings.ts            # Persisted UI preferences
│   │   ├── types.ts               # Session, settings, summary, translation types
│   │   ├── pcm.ts                 # Resampler, frame emitter, WS URL builder
│   │   ├── batch.ts               # File validation, decode, downmix, resample (legacy path)
│   │   └── languages.ts, format.ts, errors.ts
│   ├── services/
│   │   ├── transcriptionService.ts  # Batch diarization API client
│   │   └── aiService.ts             # /api/ai/* client
│   ├── public/
│   │   ├── pcm-processor.js       # AudioWorklet: mono 16 kHz s16le, 512-sample frames
│   │   └── favicon.svg
│   ├── scripts/
│   │   ├── build.mjs              # Cross-platform typecheck + build
│   │   └── test-batch-audio.ts, test-batch-proxy.ts   # Offline tests (no Gnani calls)
│   ├── main.tsx
│   └── index.css
├── .env                        # GNANI_API_KEY, GEMINI_API_KEY (git-ignored)
└── .env.example
```

---

## API endpoints

### Backend (this server)

| Method & path | Purpose |
| --- | --- |
| `GET /api/health` | `{ status, model, language, sampleRate, configured }` |
| `GET /api/ai/status` | `{ configured, provider, model }` — never returns the key |
| `POST /api/ai/analyze` | `{ fileName, language, targetLanguage, segments[] }` → structured summary **and** per-segment translations from a single Gemini call |
| `WS /ws/stt/realtime` | Realtime browser audio (binary 1,024-byte PCM frames) + JSON control frames |
| `WS /ws/stt/batch` *(legacy)* | Uploaded-file streaming via the realtime Gnani socket, with `batch_ack` flow control |
| `POST /api/stt/batch/diarize` | Multipart upload (`file`) → creates a diarization job → `{ job_id, status }` |
| `POST /api/stt/batch/diarize/:jobId/start` | Starts the created job (`202 STARTING`) |
| `GET /api/stt/batch/diarize/:jobId` | Job status: `CREATED/STARTING/QUEUED/IN_PROGRESS/COMPLETED/PARTIAL_FAILURE/FAILED/...` |
| `GET /api/stt/batch/diarize/:jobId/files` | Completed files + `transcript_url`s |
| `POST /api/stt/batch/diarize/:jobId/cancel` | Cancel the Gnani job |
| `GET /api/stt/batch/diarize/download?url=…` | Proxies the presigned `transcript_url` and returns segment JSON |

Realtime WS accepts only exact **1,024-byte binary** frames and `{"type":"commit"}` text frames; batch WS sessions also emit `{"type":"batch_ack","frames":N}` for the client's in-flight window. Everything else is dropped and logged.

### Transcript document (downloaded JSON)

```json
{
  "full_transcript": "hello how can i help you today i am calling about my order",
  "model": "prisma-v3.0",
  "language_code": "en-IN",
  "segments": [
    {
      "segment_id": 0,
      "start_time": 0.0,
      "end_time": 0.71,
      "text": "hello",
      "speaker_id": 1,
      "language_detected": null
    }
  ]
}
```

The UI renders one card per segment: language badge (when known), **Speaker N** badge, `start – end` time range, text.

---

## Offline tests

```bash
npm run test:batch
```

Runs the legacy-path suites **without calling Gnani**:

- **Batch audio preparation** — stereo→mono downmix + padding to whole 512-sample frames, 48 kHz→16 kHz resampling, rejected formats/sizes/durations, cancellation mid-decode.
- **Batch proxy relay** — spins a fake upstream WS to prove every frame is relayed **in order** with a trailing `commit`, and that the realtime path is unaffected.

Useful for verifying the shared plumbing (resampler, framing, pacing, flow control) without network or quota concerns.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | API (`tsx watch`, port 8787) + Vite frontend (port 5173), concurrently |
| `npm run build` | Typecheck frontend & server, then build to `dist/` |
| `npm start` | Serve `dist/` and all proxies on port 8787 |
| `npm run typecheck` | Typecheck both TypeScript projects |
| `npm run test:batch` | Offline suites for legacy audio conversion + proxy relay |
| `npm run preview` | Preview the Vite build |

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `GNANI_API_KEY` | — | **Required.** Gnani API key; verified at boot, server-side only |
| `GEMINI_API_KEY` | — | Optional. Google Gemini key for summaries and translation; server-side only |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Primary Gemini model |
| `GEMINI_FALLBACK_MODELS` | `gemini-3.8-flash,gemini-3.5-flash` | Comma-separated fallbacks when the primary model is busy or unavailable |
| `GEMINI_TIMEOUT_MS` | `90000` | Per-request timeout for Gemini calls |
| `PORT` | `8787` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `MAX_SESSIONS_PER_IP` | `2` | Concurrent realtime Gnani streams per client IP |
| `GNANI_STT_URL` | `wss://api.vachana.ai/stt/v3/stream` | Override the realtime upstream (its host is reused for batch REST calls) |
| `API_TARGET` (dev) | `http://localhost:8787` | Vite's proxy target for `/api` and `/ws` |

---

## Troubleshooting

| Symptom | Cause & fix |
| --- | --- |
| "Microphone access was blocked" / prompt never appears | Allow mic access in site settings; use `localhost` or HTTPS. Reload. |
| `401` / "API credentials rejected" | `GNANI_API_KEY` missing/invalid — check `.env`, restart. |
| `502` "Gnani batch… (400 INVALID_CONFIG) unsupported format" | Mixed-extension file; **rare now** — the server sniffs the magic bytes and renames before upload. If you still see it, the container is genuinely unusable by Gnani: re-encode to WAV/MP3. |
| `429 RATE_LIMITED` | Normal burst limiting. The server retries automatically (watch for `Gnani rate limited; retrying` logs). If it persists after 4 attempts, wait ~1 min and click Generate again. |
| Batch job stuck in `IN_PROGRESS` | Long files legitimately take minutes. Keep the tab open; polling continues. Cancel if needed. |
| `504` "Could not reach the transcription service" | Your server couldn't reach `api.vachana.ai` — check internet/proxy/firewall. |
| 422 "invalid character … `download`" | Should not occur (routes ordered correctly); means an old build is cached — rebuild (`npm run build`). |
| Translation/summary says "not configured" | `GEMINI_API_KEY` is missing — add it to `.env` and restart the server. |
| `429` / "experiencing high demand" from Gemini | The server tries `GEMINI_FALLBACK_MODELS` automatically. If all models are busy, wait a moment and click Translate/Regenerate again. |
| "This file is larger than 10 MB" | Batch direct upload is capped at 10 MB. Compress to MP3/OGG, trim, or split the recording. |
| Batch ends with `FAILED` / `START_FAILED` | Check the server log for the Gnani error body (`cancel_reason` is included in the UI). Silent audio fails with "Empty transcript after 3 retries". |
| Batch finishes with "No speech detected" | Processed fully but no utterances found — verify the file contains audible speech. |
| "Too many active recording sessions" | Realtime per-IP cap (`MAX_SESSIONS_PER_IP`, default 2). Stop another tab or wait a few seconds. |
| No transcript while speaking live | VAD emits per finished utterance: speak ≥ ~0.5 s then pause. Raise mic input level. |
| Last sentence missing (realtime) | The trailing-silence + `commit` finalize handles it; a network drop can still beat the timeout — retry. |
| Port already in use | Set `PORT=xxxx` in `.env` and mirror it in `API_TARGET` for the dev proxy. |

Server logs include session ids, frame counts, upstream close codes, rate-limit retries and Gnani error bodies — enough to debug without exposing audio content or credentials.

---

## Security & privacy

- **Key isolation:** `GNANI_API_KEY` and `GEMINI_API_KEY` are read from `.env` and attached **only** by the Node server. They never appear in the frontend bundle, browser dev-tools, or logs. `/api/ai/status` returns only the provider and model name.
- **Realtime:** raw 16 kHz PCM is relayed in memory only — nothing written to disk, nothing stored.
- **Batch:** the uploaded file lives in the server process memory (multer memory storage) only long enough to forward it to Gnani; transcripts are fetched, shaped, and discarded — never written to disk.
- **AI:** transcript segments are sent to Gemini only when the clinician explicitly requests a translation or summary (or when auto-translate finishes a session). Responses are treated as drafts.
- **Auth to Gnani / to browser:** the browser only ever talks to *your* server; jobs are keyed only by knowledge of that API surface.
- **Transcript lifetime:** transcripts, translations, and summaries live in the tab's memory; clear or close the tab and they're gone.
- **Exposure:** intended for local/private deployment. If you expose it publicly: terminate TLS, add your own auth + rate limiting in front, and keep both keys server-side.

---

## Scope & current limitations

- Gnani realtime has no speaker diarization (diarization is a Gnani Batch Jobs API feature). Realtime labels come from the local pyannote sidecar described above; batch labels come from Gnani.
- Batch direct upload is capped at **10 MB**; files needing more require Gnani's presigned-upload flow (not implemented).
- The legacy local-decode WebSocket batch path still exists (code + tests) but is not wired into the UI; the active batch path is the REST jobs flow above.
- **History:** sessions are kept in the browser tab only; there is no account system or database, and a refresh clears recorded sessions.
- **AI output:** summaries and translations are drafts for clinician review, not diagnoses. Gemini can be unavailable; fallback models and clear error states are provided.
- Language detection is automatic (`indic-auto`); realtime shows it per utterance, batch per segment (`language_detected`).
- Poll-based progress is coarse (job-level counters, not audio-level seek bars).

---

## Credits & references

- Powered by **Gnani Prisma v3.0** — Speech-to-Text for Indian languages.
- Batch API reference: <https://docs.gnani.ai/api/STTBatch/Introduction.md>
- Realtime WS reference: <https://docs.gnani.ai/api/STT/stt-websocket.md>
- Diarization use case: <https://docs.gnani.ai/api/use-cases/podcast-transcription.md>
- Gnani API dashboard: <https://app.gnani.ai/voice>
