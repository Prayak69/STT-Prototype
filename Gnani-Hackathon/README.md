# VoxNote — Clinical transcription on Gnani Prisma v3.0

<<<<<<< HEAD
Real-time and batch, multilingual **speech-to-text with automatic speaker diarization**, in the browser, powered by **Gnani Prisma v3.0**.
=======
Real-time and batch, multilingual **speech-to-text**, a persistent side transcript, Gemini-powered **clinical summaries and translation**, and downloadable records — powered by **Gnani Prisma v3.0**.
>>>>>>> origin/main

Two independent pipelines, one app:

| | Realtime | Batch (uploaded file) |
| --- | --- | --- |
| Input | Microphone | Audio file (≤ 10 MB) |
| Endpoint | `WS /ws/stt/realtime` → Gnani realtime WebSocket | `POST /api/stt/batch` → Gnani Batch Jobs REST API |
| Output | Live transcript, language per utterance | Full transcript + timestamps |
| Latency | Sub-second per utterance | Minutes (async job, polled every 10 s) |
| Languages | Auto-detected (`indic-auto`) | Auto-detected (`indic-auto`) |

Raw transcripts stay untouched; the VoxNote workspace adds an optional **English translation** (Gemini) and an AI **summary** alongside them, plus a **structured consultation report** generated on demand from the finished transcript. No simulated text, no user accounts — and neither the **Gnani API key nor the Gemini key ever leaves the server**.

---

## Quick start

**Requirements:** Node.js **20.19+** (or 22.12+), a microphone (for realtime), and a Gnani API key.

<<<<<<< HEAD
1. Put your key in `.env` in this folder (`Gnani-Hackathon/.env` — keep it out of version control). Also put `HF_TOKEN` there for the pyannote sidecar, and a Gemini key if you want English translation and consultation reports:

   ```env
   GNANI_API_KEY=your-gnani-api-key
   HF_TOKEN=your-hugging-face-token
=======
1. Put your keys in `.env` in this folder (`Gnani-Hackathon/.env` — keep it out of version control):

   ```env
   GNANI_API_KEY=your-gnani-api-key
   PORT=8787

   # Optional: clinical summaries and transcript translation
>>>>>>> origin/main
   GEMINI_API_KEY=your-gemini-api-key
   GEMINI_MODEL=gemini-3.5-flash
   PORT=8787
   ```

   Translation and reports are optional. Without `GEMINI_API_KEY`, transcription works exactly as before and the Translate / Generate report controls stay disabled.

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

<<<<<<< HEAD
### Realtime speaker labels (pyannote sidecar)

Gnani realtime returns text only — there is no `speaker_id` on the streaming
API. The app adds one locally with `pyannote/speaker-diarization-3.1`, without
touching the batch path (Gnani Batch already diarizes).

```
Browser ──PCM──► Node /ws/stt/realtime ──PCM──► Gnani (connected/transcript)
                            │
                            └── same PCM ──► python/diarizer_server.py (pyannote 3.1)
                                                  └── speaker timeline
```

The sidecar re-diarizes the trailing window every few seconds and returns a
stable `Speaker 1` / `Speaker 2` timeline with absolute timestamps. Node
labels each transcript by time; when a transcript arrives before its window is
covered, the label is sent a few seconds later as a `speaker_update`.

1. Accept the conditions on Hugging Face for **both**
   [`pyannote/speaker-diarization-3.1`](https://huggingface.co/pyannote/speaker-diarization-3.1)
   and [`pyannote/segmentation-3.0`](https://huggingface.co/pyannote/segmentation-3.0).
2. Put your token in `.env` in this folder (alongside `GNANI_API_KEY`); the
   sidecar reads `HF_TOKEN` from it. It never reads the repository root.
3. Create a self-contained virtualenv for the sidecar:

   ```powershell
   cd Gnani-Hackathon
   python -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r python\requirements.txt
   ```

4. Start the sidecar in its own terminal:

   ```powershell
   cd Gnani-Hackathon
   .\.venv\Scripts\python.exe python\diarizer_server.py
   ```

It listens on `ws://127.0.0.1:8790`. Options: `--num-speakers 2` (default),
`--window 18`, `--hop 4`, or the `DIARIZER_*` variables in `.env`.

A GPU is strongly recommended. On CPU an 18 s window may take longer than the
4 s hop, so labels update more slowly — the sidecar never queues overlapping
passes. Set `DIARIZATION_ENABLED=false` to run realtime without labels. If the
sidecar is not running, realtime transcription still works; it simply shows no
speaker badges.

=======
>>>>>>> origin/main
---

## Feature tour

### 1. Realtime microphone transcription

- From the dashboard, click **Start recording** → your mic streams to Gnani through the secure proxy.
- Each finished utterance appears with a **language badge** (Prisma detects the language per utterance — Indian English, Hindi, Tamil, Telugu, Bengali, Marathi, Gujarati, Kannada, Malayalam, Punjabi, including code-switching).
- Live waveform, recording timer, speech/processing indicators, connection status.
- **Stop** finalizes gracefully: trailing silence → `commit` → wait for the last transcript → close, so the final sentence is never lost.

### 2. Batch upload

<<<<<<< HEAD
1. From the dashboard, click **Upload audio** and choose a file → the app validates it and shows a **ready state**. Nothing is sent yet in this confirmed two-step flow.
2. Click **Generate Transcript** → the file uploads to *your* server, which creates a Gnani **Batch STT job** with `with_diarization: true`.
3. The panel tracks every stage — *Ready → Uploading → Starting job → Diarizing → Fetching transcripts → Complete* — with a progress bar. Status is polled every 10 s automatically.
4. When done, segments appear with green **Speaker N** badges and `start – end` timestamps. Cancel stops local polling **and** asks Gnani to cancel the running job (best effort).
=======
1. Click **Upload Audio** and choose a file → the app validates it and shows a **ready state**. Nothing is sent yet in this confirmed two-step flow.
2. Click **Generate Transcript** → the file uploads to *your* server, which creates a Gnani **Batch STT job** (plain transcription, no speaker labels).
3. The panel tracks every stage — *Ready → Uploading → Starting job → Transcribing → Fetching transcript → Complete* — with a progress bar. Status is polled every 10 s automatically.
4. When done, segments appear with `start – end` timestamps and text. Cancel stops local polling **and** asks Gnani to cancel the running job (best effort).
>>>>>>> origin/main

**You upload once, click once.** Transcription is configured entirely on the backend — the frontend has no language, model or speaker options.

### 3. Transcript rail

The right-hand rail has five tabs and is shared by live sessions, uploads and
saved session records:

- **Transcript** — copy, download TXT/JSON, confirm-to-clear, per-segment speaker and time badges.
- **Translate** — Gemini translates the transcript into English, Hindi or Hinglish.
- **Summary** — a clinician-review summary (complaint, symptoms, history, medications, assessment, plan, follow-up, red flags).
- **Report** — the structured SOAP-style consultation draft. Assign speaker roles first (clinician / patient) so attribution is explicit; the model never guesses. Report items link back to the supporting transcript segments (source chips).
- **Details** — file, language, duration, speaker count and model metadata.

<<<<<<< HEAD
Empty/error states explain what happened ("No speech detected", "No transcript produced"). Realtime and batch use **separate state**, so neither can clear or interrupt the other. Every finished session is also listed in **Session history** under Transcriptions.
=======
- **Translate** the full transcript into English, Hindi, or Hinglish. Timestamps and medication names are preserved; transcription and translation can be downloaded separately.
- **Generate summary** produces a structured clinical note: chief complaint, symptoms, history, medications, assessment, plan, follow-up, and red flags. Missing details are marked “Not stated”.
- Summaries and translations are generated server-side with Gemini, with model fallback and retry when the primary model is busy.
- Both are produced by a **single Gemini request** per transcript: the Translate and Summary tabs stay separate in the UI, but opening either one reuses the same combined result instead of calling the model twice.
- Summaries and translations are generated only from the session's own transcript.

### 5. Session history

- Finished live and upload sessions are saved into the current browser tab and listed with date, duration, language, and status.
- History is in-memory only: refreshing the tab clears recorded sessions.

### 6. Downloads

| Content | Formats | Notes |
| --- | --- | --- |
| Transcript | TXT, JSON | Timestamps included |
| Translation | TXT, JSON | Includes source text in JSON for auditing |
| Summary | TXT, JSON | Structured clinical sections and model name |
>>>>>>> origin/main

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

BATCH (REST jobs)
Browser                          Node server                        Gnani
───────                          ───────────                        ─────
POST /api/stt/batch ──►  multipart forward ────────────►   POST /stt/v3/batch/jobs
   (original file bytes)         config: model prisma-v3.0      → 201 { job_id, CREATED }
                                  format transcribe
POST /:id/start ─────────────►  ─────────────────────────────►   POST /stt/v3/batch/jobs/:id/start
GET  /:id (every 10 s) ──────►  ───── polling ────────────────►  GET /stt/v3/batch/jobs/:id
GET  /:id/files ─────────────►  ─────────────────────────────►  GET .../files?status=COMPLETED
GET  /download?url=... ──────►  fetch transcript_url ─────────►  (presigned URL)
                                  ◄── segments[] ─

<<<<<<< HEAD
TRANSLATION (additive, both pipelines)
Browser                          Node server                        Gemini
───────                          ───────────                        ──────
POST /api/translate ─────────►  validate + chunk ───────────────►  generateContent
   { segments: [{id,text}] }      Gemini key stays here             responseSchema: JSON
                                  ◄── [{id, text}] ──────────────
   ◄── English text; raw `text` is never overwritten

CONSULTATION REPORT (on demand, both pipelines)
Browser                          Node server                        Gemini
───────                          ───────────                        ──────
POST /api/report ────────────►  validate + chunk ───────────────►  generateContent
   { mode, segments: [...] }      Gemini key stays here             responseSchema: report
                                  ◄── structured JSON ───────────
   ◄── draft report; evidence ids point back to transcript segments
=======
CLINICAL AI (optional, after transcription)
Browser                          Node server                        Google Gemini
───────                          ───────────                        ─────────────
POST /api/ai/analyze ─────────►  prompt + JSON schema ───────────►  generateContent
                                   (summary + translation, one call)  ◄── structured JSON
                                   ◄── normalized result
>>>>>>> origin/main
```

### What the server does for batch (all transparent to the user)

| Concern | Handling |
| --- | --- |
| Wrong file extensions | The real container is **sniffed from magic bytes** (`OggS`, `RIFF/WAVE`, `ID3`, `ftyp`, `fLaC`, `AMR`, EBML…) and the filename is normalized before upload — WhatsApp voice notes that masquerade as `.mpeg` are fixed automatically. |
| Gnani rate limits | Every Gnani REST call is wrapped in a retry: on **429** it retries up to **4 times** with backoff (honours `Retry-After`, otherwise 2 s → 4 s → 6 s → 8 s). Logged as `Gnani rate limited; retrying`. |
| Slow processing | Transcription is an async job; the frontend polls `/status` every **10 s** (Gnani's recommended minimum) for up to **30 minutes**. |
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
| Max audio duration | 4 h per file (Gnani), but 10 MB usually binds first — use MP3/OGG for long recordings |
| Poll interval | 10 s; job polling gives up after ~30 minutes |
| `transcript_url` expiry | 1 h — refunded automatically by re-fetching files |

**Why 10 MB?** Gnani's Batch API caps direct multipart uploads at 10 MB; larger files need their presigned-upload flow (`POST /stt/v3/batch/v2/jobs`), not yet implemented here.

---

## Project structure

```
.
<<<<<<< HEAD
├── frontend/                  # React + Vite app
│   ├── index.html
=======
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
│   │   ├── LiveTranscription.tsx  # Shared segment list with time badges
│   │   └── AudioVisualizer.tsx, StatusBadge.tsx, ErrorBanner.tsx, Tabs.tsx
│   ├── hooks/
│   │   ├── useAudioStreaming.ts    # Realtime: capture → WS → segments (state machine)
│   │   ├── useAiInsights.ts        # Summary/translation state and stale detection
│   │   ├── useAiStatus.ts          # Server AI configuration
│   │   └── useBatchProcessing.ts   # Legacy local-decode WS batch (unused by UI, kept for tests)
│   ├── lib/
│   │   ├── transcript.ts          # TXT/JSON builders, copy/download helpers
│   │   ├── settings.ts            # Persisted UI preferences
│   │   ├── types.ts               # Session, settings, summary, translation types
│   │   ├── pcm.ts                 # Resampler, frame emitter, WS URL builder
│   │   ├── batch.ts               # File validation, decode, downmix, resample (legacy path)
│   │   └── languages.ts, format.ts, errors.ts
│   ├── services/
│   │   ├── transcriptionService.ts  # Batch transcription API client
│   │   └── aiService.ts             # /api/ai/* client
>>>>>>> origin/main
│   ├── public/
│   │   ├── pcm-processor.js       # AudioWorklet: mono 16 kHz s16le, 512-sample frames
│   │   └── favicon.svg
│   ├── src/
│   │   ├── App.tsx                # One app state: realtime or batch (disjoint), wiring
│   │   ├── components/
│   │   │   ├── DashboardPage.tsx  # VoxNote home: record/upload cards, recent sessions
│   │   │   ├── Sidebar.tsx, Header.tsx, Tabs.tsx
│   │   │   ├── TranscriptRail.tsx # Transcript / Translate / Summary / Report / Details tabs
│   │   │   ├── TranscriptView.tsx, TranslationView.tsx, SummaryView.tsx, DetailsView.tsx
│   │   │   ├── HistoryTable.tsx, SettingsPage.tsx
│   │   │   ├── BatchPanel.tsx     # Two-step upload→Generate, stage pills, progress, cancel/retry
│   │   │   ├── LiveTranscription.tsx  # Shared transcript list; speaker badges + segment times
│   │   │   ├── ConsultationReport.tsx # SOAP-style report, role picker, evidence links, copy/JSON/print
│   │   │   ├── StartActions.tsx   # Record / Upload entry cards
│   │   │   ├── RecordingPanel.tsx, AudioVisualizer.tsx,
│   │   │   ├── StatusBadge.tsx, ErrorBanner.tsx
│   │   ├── hooks/
│   │   │   ├── useAudioStreaming.ts    # Realtime: capture → WS → segments (state machine)
│   │   │   ├── useBatchDiarization.ts  # Batch: select → generate → upload → poll → download
│   │   │   ├── useAiInsights.ts        # Gemini summary + translation for the rail
│   │   │   ├── useAiStatus.ts          # /api/ai/status availability
│   │   │   ├── useTranscriptTranslation.ts # Additive English translation for live + batch segments
│   │   │   ├── useConsultationReport.ts # On-demand report state, speaker roles, staleness
│   │   │   └── useBatchProcessing.ts   # Legacy local-decode WS batch (unused by UI, kept for tests)
│   │   ├── services/
│   │   │   ├── aiService.ts            # /api/ai/status + /api/ai/analyze client
│   │   │   └── transcriptionService.ts # Batched diarization REST client
│   │   ├── lib/
│   │   │   ├── pcm.ts                 # Resampler, frame emitter, WS URL builder
│   │   │   ├── batch.ts               # File validation, decode, downmix, resample (legacy path)
│   │   │   ├── report.ts              # Report types, Markdown export, speaker labels
│   │   │   └── languages.ts, format.ts, errors.ts, settings.ts, transcript.ts, types.ts
│   │   ├── main.tsx
│   │   └── index.css
│   ├── tsconfig.json
│   └── vite.config.ts
├── backend/                   # Node/Express + WebSocket proxy
│   ├── server.ts              # Express app: static hosting, /api/health, AI + batch + medicine + translate + report routes
│   ├── gemini.ts              # Gemini summary + translation for /api/ai/analyze
│   ├── gnaniWebSocket.ts      # Realtime WS proxy (+ legacy /ws/stt/batch streaming path)
│   ├── gnaniBatch.ts          # Gnani Batch Jobs REST client: create/start/poll/files/download/cancel,
│   │                          #   magic-byte extension sniffing, 429 retry wrapper
│   ├── diarization.ts         # Client for the local pyannote sidecar
│   ├── translation.ts         # Gemini-backed English translation, validation, retries
│   ├── consultationReport.ts  # Gemini structured report, schema validation, chunk merge
│   ├── reportTypes.ts         # Report contract, roles, evidence and completeness types
│   ├── pharmaDesk.ts          # PharmaDesk Medicine Reference API client (no credentials)
│   ├── medicineMatcher.ts     # Normalisation, aliases, strength/form checks, conservative ranking
│   ├── medicineTypes.ts       # Verified API schema + matcher/HTTP types
│   ├── config.ts              # .env loading, Gnani session constants
│   ├── logger.ts              # Structured JSON-ish console logger
│   └── tsconfig.server.json
├── python/                    # Local pyannote diarization sidecar
│   ├── diarizer_server.py     # WebSocket sidecar: rolling window → speaker timeline
│   ├── diarization.py         # pyannote pipeline wrapper
│   └── requirements.txt
├── scripts/
│   ├── build.mjs              # Cross-platform typecheck + build
│   ├── test-batch-audio.ts, test-batch-proxy.ts   # Offline tests (no Gnani calls)
│   ├── test-medicines.ts      # Mocked-API medicine client + matcher tests
│   ├── test-translation.ts    # Mocked Gemini translation validation + error tests
│   └── test-report.ts         # Mocked Gemini report validation, merge, and error tests
├── package.json               # Single npm project for frontend + backend
├── .env                       # GNANI_API_KEY, HF_TOKEN, GEMINI_API_KEY (git-ignored)
└── .env.example
```

---

## API endpoints

### Backend (this server)

| Method & path | Purpose |
| --- | --- |
| `GET /api/health` | `{ status, model, language, sampleRate, configured, translation: { configured, model, targetLanguage }, report: { configured, model }, ai: { configured, provider, model } }` |
| `WS /ws/stt/realtime` | Realtime browser audio (binary 1,024-byte PCM frames) + JSON control frames |
| `WS /ws/stt/batch` *(legacy)* | Uploaded-file streaming via the realtime Gnani socket, with `batch_ack` flow control |
<<<<<<< HEAD
| `POST /api/stt/batch/diarize` | Multipart upload (`file`) → creates a diarization job → `{ job_id, status }` |
| `POST /api/stt/batch/diarize/:jobId/start` | Starts the created job (`202 STARTING`) |
| `GET /api/stt/batch/diarize/:jobId` | Job status: `CREATED/STARTING/QUEUED/IN_PROGRESS/COMPLETED/PARTIAL_FAILURE/FAILED/...` |
| `GET /api/stt/batch/diarize/:jobId/files` | Completed files + `transcript_url`s |
| `POST /api/stt/batch/diarize/:jobId/cancel` | Cancel the Gnani job |
| `GET /api/stt/batch/diarize/download?url=…` | Proxies the presigned `transcript_url` and returns segment JSON |
| `POST /api/medicines/search` | Reference-only medicine match: `{ query, market?, limit? }` → ranked candidates; never edits a transcript or prescribes a dose |
| `GET /api/ai/status` | `{ configured, provider, model }` for the workspace summary/translation features |
| `POST /api/ai/analyze` | Gemini summary + translation in one call: `{ segments: [{ index, speaker, timestamp, text }], targetLanguage, language?, fileName? }` |
| `POST /api/translate` | Additive English translation: `{ segments: [{ id, text, language? }], targetLanguage? }` → `{ ok, translations, model, targetLanguage }`; the raw transcript is never modified |
| `POST /api/report` | Structured consultation report: `{ mode?, segments: [{ id, text, speaker?, role?, startTime?, endTime?, language? }] }` → `{ ok, report, model, generatedAt }`; every item carries evidence segment ids |
=======
| `POST /api/stt/batch` | Multipart upload (`file`) → creates a batch job → `{ job_id, status }` |
| `POST /api/stt/batch/:jobId/start` | Starts the created job (`202 STARTING`) |
| `GET /api/stt/batch/:jobId` | Job status: `CREATED/STARTING/QUEUED/IN_PROGRESS/COMPLETED/PARTIAL_FAILURE/FAILED/...` |
| `GET /api/stt/batch/:jobId/files` | Completed files + `transcript_url`s |
| `POST /api/stt/batch/:jobId/cancel` | Cancel the Gnani job |
| `GET /api/stt/batch/download?url=…` | Proxies the presigned `transcript_url` and returns segment JSON |
>>>>>>> origin/main

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
      "language_detected": null
    }
  ]
}
```

The UI renders one card per segment: language badge (when known), `start – end` time range, text.

### Medicine reference search

`POST /api/medicines/search` is an additive reference feature. It is independent
of the STT, WebSocket, audio and diarization paths, and it never changes the
conversation transcript. It can be used to verify medicines named in the
transcript or report; it is not required for either.

```json
{
  "query": "Dolo 650",
  "market": "IN",
  "limit": 10
}
```

`market` is optional (`IN`, `US`, `GB`, `EU`, `CA`, `AU`; default `IN`) and
`limit` is optional (`1..50`, default `10`).

The response returns **all** plausible candidates with a conservative status:

| Status | Meaning |
| --- | --- |
| `matched` | Deterministic exact product-name + strength match, with no alias/typo rewrite |
| `suggested` | One plausible candidate (alias, spelling correction, or fuzzy match); verify it |
| `ambiguous` | Multiple plausible candidates; choose explicitly |
| `unmatched` | No reliable match, or a strength/dosage-form mismatch was rejected |

Fuzzy similarity alone **never** produces `matched`. Each result includes
`canonicalName`, `genericName`, `genericComposition`, `strength`,
`manufacturer`, `confidence`, `matchStatus`, `strengthComparison`,
`dosageFormComparison`, `matchedFields` and the source record. There is no
separate brand field in the upstream search schema, so `brand` is `null` and
the product name is returned in `canonicalName`.

The endpoint also accepts Hindi/Devanagari text, Romanized spellings, spoken
strengths (`"six fifty"` → `650`) and a small curated set of Indian brand
aliases (for example `dolo` → paracetamol, `augmentin` → amoxicillin +
clavulanic acid). Aliases are search hints, not verified clinical equivalences.

**Dosage is never inferred.** `strength` and `route` in the response are
catalogue product metadata, not a prescribed dose, frequency or duration.
Those must come exclusively from the original doctor–patient conversation.

**Licensing:** PharmaDesk data is proprietary/all rights reserved and Indian
brand names are licensed for use inside PharmaDesk, not redistribution. This
integration displays results transiently, does not cache or persist them, and
does not expose the upstream URL or any credential to the browser. The
upstream service needs no API key.

### English translation

Gnani Prisma does **not** translate — its API docs explicitly list translation as
unsupported. Translation is therefore a separate, additive step after
transcription. It works for both pipelines because the frontend translates the
shared `TranscriptSegment` list.

```json
{
  "segments": [
    { "id": "seg-1", "text": "मुझे सिरदर्द है", "language": "Hindi" },
    { "id": "seg-2", "text": "Take one tablet after food." }
  ]
}
```

```json
{
  "ok": true,
  "targetLanguage": "English",
  "model": "gemini-3.5-flash",
  "translations": [
    { "id": "seg-1", "text": "I have a headache." },
    { "id": "seg-2", "text": "Take one tablet after food." }
  ]
}
```

- **Raw text is preserved.** The UI adds `translatedText` and a translation state
  to a copy of each segment; `text` is never overwritten.
- **Optional.** Without `GEMINI_API_KEY`, `translation.configured` is `false` and
  the Translate control is disabled. Transcription is unaffected.
- **Server-side key.** Only `GEMINI_API_KEY` is used, from `.env`; the browser
  posts segment text to this server and never sees the key.
- **Limits.** Up to 50 segments, 4,000 characters per segment and 24,000
  characters per request (configurable). The browser sends chunks of 20.
- **Privacy.** Only finished transcript *text* is sent to Gemini, and only while
  translation is enabled. Audio never leaves this server for translation.
- **Errors.** `400` invalid request, `429` upstream rate limit, `503` translation
  disabled/not configured, `502`/`504` upstream failure. Failed segments show a
  per-segment message and a Retry action.

### Structured consultation report

`POST /api/report` converts the finished transcript into a **SOAP-style draft**
for clinician review. It is generated on demand, never automatically, and the
raw transcript is not modified.

```json
{
  "mode": "batch",
  "segments": [
    {
      "id": "seg-1",
      "text": "I have had a headache and fever for two days.",
      "speaker": "Speaker 1",
      "role": "patient",
      "startTime": 0,
      "endTime": 4.2,
      "language": "Hindi"
    },
    {
      "id": "seg-2",
      "text": "Take one Paracetamol 650 mg tablet twice a day after food.",
      "speaker": "Speaker 2",
      "role": "clinician",
      "startTime": 4.2,
      "endTime": 10.1,
      "language": "Hindi"
    }
  ]
}
```

```json
{
  "ok": true,
  "model": "gemini-3.5-flash",
  "generatedAt": "2026-11-06T13:00:00.000Z",
  "report": {
    "meta": {
      "source": "batch",
      "durationSeconds": 10.1,
      "languages": ["Hindi"],
      "speakerCount": 2,
      "segmentCount": 2,
      "completeness": "complete"
    },
    "summary": "A patient with headache and fever for two days.",
    "patient": { "age": null, "sex": null, "identifiers": [] },
    "chiefComplaint": {
      "text": "Headache and fever for two days",
      "evidence": ["seg-1"]
    },
    "subjective": {
      "historyOfPresentIllness": "Two days of headache and fever.",
      "symptoms": [
        {
          "symptom": "Headache",
          "onset": "2 days ago",
          "duration": "2 days",
          "severity": null,
          "aggravatingFactors": null,
          "relievingFactors": null,
          "evidence": ["seg-1"]
        }
      ],
      "pastMedicalHistory": [],
      "currentMedications": [],
      "allergies": [],
      "familyHistory": [],
      "socialHistory": [],
      "reviewOfSystems": []
    },
    "objective": { "vitals": [], "examinationFindings": [] },
    "assessment": {
      "impression": null,
      "differential": [],
      "statedBy": null,
      "evidence": []
    },
    "plan": {
      "investigations": [],
      "medications": [
        {
          "name": "Paracetamol",
          "strength": "650 mg",
          "dose": "1 tablet",
          "frequency": "twice a day",
          "duration": null,
          "route": "oral",
          "instructions": "after food",
          "statedBy": "clinician",
          "evidence": ["seg-2"]
        }
      ],
      "advice": [],
      "followUp": null
    },
    "redFlags": [],
    "gaps": ["No allergy history documented"],
    "warnings": [],
    "disclaimer": "AI-generated consultation draft. Review against the original conversation before any clinical use. This is not a diagnosis, prescription or medical advice."
  }
}
```

- **Sections:** meta, summary, patient, chief complaint, subjective (HPI,
  symptoms, history, medications, allergies, family/social, ROS), objective
  (vitals, examination), assessment (impression, differential), plan
  (investigations, medications, advice, follow-up), red flags, gaps and review
  notes.
- **Speaker roles.** Diarization only tells us `Speaker N`. Assign **clinician /
  patient / other** in the UI before generating so attribution is explicit. If
  roles are not assigned, the report warns about it and never guesses.
- **Evidence.** Every symptom, medication, finding and assessment item
  carries the supporting segment ids. Source chips in the UI jump back to the
  transcript.
- **No invention.** The prompt and server validation require explicit content
  only: no inferred diagnoses, doses, frequencies or follow-up. Missing fields
  are `null` / `[]`, never fabricated.
- **Dose fidelity.** Medicine names, strengths, doses and numbers are preserved
  exactly as spoken. The endpoint never calculates or substitutes a dose.
- **English input.** The frontend sends the English translation when available,
  otherwise the raw segment text; Gemini can read Indic scripts directly.
- **Long transcripts.** Requests over `REPORT_CHUNK_CHARS` (60,000 chars) are
  split at segment boundaries, normalized per chunk, merged and deduplicated.
  The hard input cap is `REPORT_MAX_INPUT_CHARS` (200,000 chars → `413`).
- **Optional.** Without `GEMINI_API_KEY`, `report.configured` is `false` and the
  Generate report control is disabled. Transcription is unaffected.
- **Privacy.** Only finished transcript text is sent to Gemini, and only when
  the user clicks Generate. Audio is never sent to the report provider.
- **Errors.** `400` invalid request, `413` transcript too large, `429` upstream
  rate limit, `503` disabled/not configured, `502`/`504` upstream failure.
- **Not a medical device.** The report is a documentation aid. It must be
  reviewed against the original conversation before any clinical use.

---

## Offline tests

```bash
npm run test:batch
npm run test:medicines
npm run test:translation
npm run test:report
```

`test:batch` runs the legacy-path suites **without calling Gnani**:

- **Batch audio preparation** — stereo→mono downmix + padding to whole 512-sample frames, 48 kHz→16 kHz resampling, rejected formats/sizes/durations, cancellation mid-decode.
- **Batch proxy relay** — spins a fake upstream WS to prove every frame is relayed **in order** with a trailing `commit`, and that the realtime path is unaffected.

`test:medicines` runs fully mocked PharmaDesk responses (no live API calls):

- Verified query parameters, schema validation, 400 mapping, invalid-response rejection.
- 429 retry with `Retry-After`, exhausted rate limits, and timeouts.
- Normalisation of spoken strengths, Hindi/Devanagari text, spelling variants and aliases.
- Strength + dosage-form validation, exact-match vs suggestion vs ambiguity, and unmatched results.

`test:translation` runs fully mocked Gemini responses (no live API calls):

- Request validation: ids, duplicate ids, text/total limits, English-only target.
- Successful alignment by id, model/endpoint/header checks, JSON response mode.
- `429`, rejected credentials, missing-segment, empty-candidate and unreadable-response mapping.

`test:report` runs fully mocked Gemini responses (no live API calls):

- Request validation: mode, ids, duplicate ids, text/limit caps, speaker roles, timestamps, `413`.
- Normalization: placeholders → empty values, unknown fields dropped, evidence ids restricted to real segments, disclaimer enforced.
- Clinical fidelity: medicine strengths/doses/frequencies preserved; missing assessment stays empty.
- Chunked transcripts: split at segment boundaries, per-chunk validation, merge + dedupe, merge warnings.
- `429`, rejected credentials, malformed/empty responses and server-side key handling.

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
| `npm run test:medicines` | Mocked-API tests for the PharmaDesk client + medicine matcher |
| `npm run test:translation` | Mocked-Gemini tests for translation validation, alignment and error handling |
| `npm run test:report` | Mocked-Gemini tests for report validation, normalization, chunk merge and errors |
| `npm run preview` | Preview the Vite build |

### Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `GNANI_API_KEY` | — | **Required.** Gnani API key; verified at boot, server-side only |
| `GEMINI_API_KEY` | — | Optional. Enables English translation; server-side only |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Gemini model used for translation, reports and the workspace AI |
| `GEMINI_FALLBACK_MODELS` | `gemini-3.8-flash,gemini-3.5-flash` | Fallback models tried by `/api/ai/analyze` |
| `GEMINI_API_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` | Override the Gemini API base |
| `GEMINI_TIMEOUT_MS` | `90000` | Per-request timeout for workspace summary/translation |
| `TRANSLATION_ENABLED` | `true` | Set `false` to disable the translation endpoint even when a key is present |
| `TRANSLATION_TIMEOUT_MS` | `20000` | Per-request Gemini timeout |
| `TRANSLATION_MAX_RETRIES` | `1` | Retries for transient translation failures |
| `TRANSLATION_MAX_SEGMENTS` | `50` | Maximum segments per translation request |
| `TRANSLATION_MAX_SEGMENT_CHARS` | `4000` | Maximum characters per segment |
| `TRANSLATION_MAX_TOTAL_CHARS` | `24000` | Maximum characters per translation request |
| `REPORT_ENABLED` | `true` | Set `false` to disable the report endpoint even when a key is present |
| `REPORT_MODEL` | `GEMINI_MODEL` (`gemini-3.5-flash`) | Gemini model used for report extraction |
| `REPORT_TIMEOUT_MS` | `60000` | Per-request Gemini timeout for report generation |
| `REPORT_MAX_RETRIES` | `1` | Retries for transient report failures |
| `REPORT_MAX_SEGMENTS` | `400` | Maximum segments per report request |
| `REPORT_MAX_SEGMENT_CHARS` | `8000` | Maximum characters per segment |
| `REPORT_MAX_INPUT_CHARS` | `200000` | Hard input cap; larger requests return `413` |
| `REPORT_CHUNK_CHARS` | `60000` | Transcripts above this are processed in chunks and merged |
| `REPORT_MAX_OUTPUT_TOKENS` | `8192` | Maximum tokens for the structured JSON response |
| `PORT` | `8787` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `MAX_SESSIONS_PER_IP` | `2` | Concurrent realtime Gnani streams per client IP |
| `GNANI_STT_URL` | `wss://api.vachana.ai/stt/v3/stream` | Override the realtime upstream (its host is reused for batch REST calls) |
| `PHARMADESK_BASE_URL` | `https://pharmadesk.accron.in/api` | Server-side PharmaDesk API base; no credential is required |
| `PHARMADESK_TIMEOUT_MS` | `8000` | Per-request upstream timeout for medicine search |
| `PHARMADESK_MAX_RETRIES` | `2` | Retries for `429` responses, honouring `Retry-After` |
| `PHARMADESK_DEFAULT_LIMIT` | `10` | Default candidate limit for medicine search |
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
| "This file is larger than 10 MB" | Batch direct upload is capped at 10 MB. Compress to MP3/OGG, trim, or split the recording. |
| Batch ends with `FAILED` / `START_FAILED` | Check the server log for the Gnani error body (`cancel_reason` is included in the UI). Silent audio fails with "Empty transcript after 3 retries". |
| Batch finishes with "No speech detected" | Processed fully but no utterances found — verify the file contains audible speech. |
| "Too many active recording sessions" | Realtime per-IP cap (`MAX_SESSIONS_PER_IP`, default 2). Stop another tab or wait a few seconds. |
| Translate control is disabled | Add `GEMINI_API_KEY` to `.env`, restart, and check `/api/health` → `translation.configured`. |
| "English translation failed: …" | Upstream Gemini error/quota/timeout. Retry; check the server log for the `Translation failed` entry. |
| Generate report control is disabled | Add `GEMINI_API_KEY` to `.env`, restart, and check `/api/health` → `report.configured`. |
| "Report generation failed: …" | Upstream Gemini error/quota/timeout or invalid model output. Retry; check the server log for the `Consultation report failed` entry and its error `code`. |
| Report warnings mention speaker roles | Diarization only gives `Speaker N`. Assign clinician/patient roles in the report panel, then regenerate. |
| Assessment is empty | Correct behaviour: nothing was explicitly stated as an assessment. The report never invents a diagnosis. |
| No transcript while speaking live | VAD emits per finished utterance: speak ≥ ~0.5 s then pause. Raise mic input level. |
| Last sentence missing (realtime) | The trailing-silence + `commit` finalize handles it; a network drop can still beat the timeout — retry. |
| Port already in use | Set `PORT=xxxx` in `.env` and mirror it in `API_TARGET` for the dev proxy. |

Server logs include session ids, frame counts, upstream close codes, rate-limit retries and Gnani error bodies — enough to debug without exposing audio content or credentials.

---

## Security & privacy

- **Key isolation:** `GNANI_API_KEY` and `GEMINI_API_KEY` are read from `.env` and attached **only** by the Node server. They never appear in the frontend bundle, browser dev-tools, or logs.
- **Realtime:** raw 16 kHz PCM is relayed in memory only — nothing written to disk, nothing stored.
- **Batch:** the uploaded file lives in the server process memory (multer memory storage) only long enough to forward it to Gnani; transcripts are fetched, shaped, and discarded — never written to disk.
- **Translation:** only finished transcript text is sent to Gemini, and only when translation is enabled. Audio is never sent to the translation provider.
- **Reports:** only finished transcript text is sent to Gemini, and only when the user clicks Generate report. Audio is never sent, and reports are kept in the tab's memory only.
- **Auth to Gnani / to browser:** the browser only ever talks to *your* server; jobs are keyed only by knowledge of that API surface.
- **Transcript lifetime:** transcripts live in the tab's memory; clear or close the tab and they're gone.
- **Exposure:** intended for local/private deployment. If you expose it publicly: terminate TLS, add your own auth + rate limiting in front, and keep the Gnani key server-side.

---

## Scope & current limitations

<<<<<<< HEAD
- **Realtime diarization doesn't exist at Gnani** — diarization is a Gnani Batch Jobs API feature only, so it is wired to the batch path (that's exactly what we did).
=======
>>>>>>> origin/main
- Batch direct upload is capped at **10 MB**; files needing more require Gnani's presigned-upload flow (not implemented).
- The legacy local-decode WebSocket batch path still exists (code + tests) but is not wired into the UI; the active batch path is the REST jobs flow above.
- **Gnani Prisma does not translate** — English translation is a separate Gemini step and is optional; without `GEMINI_API_KEY` the app only transcribes.
- **The consultation report is a documentation aid, not a medical device.** It is generated on demand from transcript text and must be reviewed against the original conversation. It does not diagnose, prescribe, or replace clinician judgement.
- **Speaker roles are manual.** Diarization labels voices but cannot know who is the clinician; roles must be assigned in the UI.
- Long-document chunking is lossy at chunk boundaries: the report merges per-chunk drafts, so a clinician should re-read the merged output.
- No user accounts/auth, no persisted history.
- Language detection is automatic (`indic-auto`); realtime shows it per utterance, batch per segment (`language_detected`).
- Poll-based progress is coarse (job-level counters, not audio-level seek bars).

---

## Credits & references

- Powered by **Gnani Prisma v3.0** — Speech-to-Text for Indian languages.
- Batch API reference: <https://docs.gnani.ai/api/STTBatch/Introduction.md>
- Realtime WS reference: <https://docs.gnani.ai/api/STT/stt-websocket.md>
- Gnani API dashboard: <https://app.gnani.ai/voice>
