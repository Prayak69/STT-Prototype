# VoxNote - Audio Transcription Dashboard

A minimalist, modern Streamlit prototype for transcribing doctor-patient
audio conversations. **Uses dummy data only** - no real transcription
API is connected yet.

## Quick Start

```bash
pip install -r requirements.txt
streamlit run app.py
```

## Project Structure

| File | Purpose |
|---|---|
| `app.py` | Main Streamlit application (UI + interactions) |
| `mock_data.py` | Dummy transcripts, history records, and config |
| `transcription_service.py` | Placeholder service - swap with a real API later |
| `.streamlit/config.toml` | Streamlit theme / server settings |

## Future Integration

Replace the body of `transcription_service.transcribe()` with a real
speech-to-text API call (Google STT, Whisper, Deepgram, etc.).
All dummy data lives in `mock_data.py` for easy swap-out.
