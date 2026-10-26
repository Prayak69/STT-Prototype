# VoxNote - Clinical Audio Transcription

Streamlit dashboard for doctor-patient consultation transcription with
**IndicConformer-600M-Multilingual (ONNX Runtime)** and **pyannote.audio**
speaker diarization.

## Architecture

| Stage | Engine |
|---|---|
| Speech-to-text | IndicConformer-600M-Multilingual, ONNX Runtime, CPU |
| Speaker labeling | pyannote.audio 4.x (`pyannote/speaker-diarization-community-1`) |
| Frontend | Streamlit (`app.py`) |

The Conformer ONNX assets are stored locally in `conformer_assets/`. Only the
Conformer files from `C:\indic-conformer-600m-multilingual` are used; the
`transcribe/` Indic-Transcribe model is intentionally excluded.

## Setup

Python 3.10 is required. The project uses `uv`.

```powershell
uv venv --python 3.10 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
```

Or run the setup script:

```powershell
.\setup.ps1
```

### pyannote access

Speaker labeling needs a Hugging Face token:

1. Accept the conditions at
   https://huggingface.co/pyannote/speaker-diarization-community-1
2. Create a token at https://huggingface.co/settings/tokens
3. Add it to `.env`:

```dotenv
HF_TOKEN=hf_...
PYANNOTE_MODEL=pyannote/speaker-diarization-community-1
```

Without a token, or if the token has not accepted the model conditions, the app
still transcribes but falls back to a single `Speaker 1` turn and shows a
warning. Once downloaded, the model weights are cached locally.

To preload the diarization model once:

```powershell
.venv\Scripts\python.exe -c "from diarization import get_diarizer; get_diarizer().preload()"
```

### Conformer assets

If `conformer_assets/` is empty, copy the ONNX runtime files from the local
model repository:

```powershell
robocopy C:\indic-conformer-600m-multilingual\assets .\conformer_assets /E /XF preprocessor.ts
```

The assets are intentionally gitignored because they are about 2.4 GB.

## Run

```powershell
.\run.ps1
```

or directly:

```powershell
.venv\Scripts\streamlit.exe run app.py
```

In the dashboard, upload an MP3/WAV/M4A file, choose the language and decoding
mode, then generate the transcript.

- **RNNT** is the default (slower but generally more accurate).
- **CTC** is faster and supports confidence estimation.

Speaker turns come from pyannote timestamps. Each turn is transcribed
separately, then adjacent turns from the same speaker are merged. The first
detected speaker is labeled `Doctor` by default (configurable to `Patient` in
the upload controls).

Generated transcripts are kept only in the current browser session. There is no
preloaded demo history; uploading `audio 13.mp3` produces a real transcript
from that file.

## Files

| File | Purpose |
|---|---|
| `app.py` | Streamlit UI and upload flow |
| `transcription_service.py` | ASR + diarization orchestration |
| `conformer_engine.py` | IndicConformer ONNX Runtime inference |
| `diarization.py` | pyannote.audio pipeline wrapper |
| `audio_io.py` | WAV/MP3/M4A decoding to 16 kHz mono |
| `conformer_assets/` | ONNX model, vocab, language masks (gitignored) |
| `setup.ps1` | Environment and asset verification script |
