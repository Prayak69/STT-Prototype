# -*- coding: utf-8 -*-
"""
VoxNote — Clinical Audio Transcription
Doctor-Patient Consultation Intelligence (Live Transcription Prototype)
"""
from __future__ import annotations
import json
from datetime import datetime

import streamlit as st

from audio_io import format_duration
from transcription_service import transcribe
from conformer_engine import LANGUAGE_LABELS, assets_available
from diarization import diarization_status, is_diarization_configured
from translation import is_translation_configured, translate_turns
from warmup import start_warmup

start_warmup()

ALLOWED_EXTENSIONS = ["mp3", "wav", "m4a"]
MAX_FILE_SIZE_MB = 25

LANGUAGE_OPTIONS = list(LANGUAGE_LABELS.keys())
DEFAULT_LANGUAGE_LABEL = next(
    label for label, code in LANGUAGE_LABELS.items() if code == "hi"
)
DECODING_OPTIONS = {"RNNT (accurate)": "rnnt", "CTC (fast)": "ctc"}

# ---- Streamlit Page Configuration ----
st.set_page_config(
    page_title="VoxNote — Clinical Audio Transcription",
    page_icon="🎙️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---- Minimal Custom CSS ----
st.markdown("""
<style>
#MainMenu {visibility: hidden;}
footer {visibility: hidden;}
header {visibility: hidden;}

.stApp {
    background-color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #0f172a;
}

section[data-testid="stSidebar"] {
    background-color: #ffffff;
    border-right: 1px solid #e2e8f0;
    padding-top: 1.5rem;
}

.vx-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 1.5rem 1.75rem;
    margin-bottom: 1.25rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
}

.vx-card-header {
    font-size: 1.05rem;
    font-weight: 600;
    color: #0f172a;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.35rem;
}

.vx-card-sub {
    font-size: 0.85rem;
    color: #64748b;
    margin-bottom: 1rem;
    line-height: 1.45;
}

.live-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    background-color: #ecfdf5;
    border: 1px solid #d1fae5;
    border-left: 4px solid #10b981;
    border-radius: 8px;
    padding: 0.85rem 1rem;
    font-size: 0.83rem;
    color: #065f46;
    margin-bottom: 1rem;
    line-height: 1.45;
}

.speaker-bubble {
    display: flex;
    gap: 1.1rem;
    padding: 1rem 1.25rem;
    border-radius: 10px;
    margin-bottom: 0.75rem;
    background-color: #f8fafc;
    border: 1px solid #f1f5f9;
}

.speaker-col-meta {
    min-width: 90px;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
}

.speaker-badge-doctor {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.72rem;
    font-weight: 600;
    color: #4338ca;
    background: #eef2ff;
    border: 1px solid #e0e7ff;
    border-radius: 6px;
    padding: 0.2rem 0.55rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
}

.speaker-badge-patient {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.72rem;
    font-weight: 600;
    color: #0f766e;
    background: #f0fdfa;
    border: 1px solid #ccfbf1;
    border-radius: 6px;
    padding: 0.2rem 0.55rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
}

.speaker-badge-speaker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.72rem;
    font-weight: 600;
    color: #475569;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 0.2rem 0.55rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
}

.speaker-timestamp {
    font-size: 0.72rem;
    color: #94a3b8;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
}

.speaker-text {
    font-size: 0.92rem;
    line-height: 1.55;
    color: #1e293b;
    align-self: center;
    flex-grow: 1;
}

.status-chip {
    display: inline-block;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 600;
    background: #ecfdf5;
    color: #047857;
    border: 1px solid #d1fae5;
}

.lang-chip {
    display: inline-block;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 500;
    background: #f1f5f9;
    color: #475569;
}

.audio-meta-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 0.5rem 0.85rem;
    font-size: 0.82rem;
    color: #1e293b;
    margin-top: 0.5rem;
    margin-bottom: 0.75rem;
}

button[kind="primary"] {
    background-color: #4f46e5 !important;
    border-color: #4f46e5 !important;
    font-weight: 500 !important;
}

button[kind="secondary"] {
    border-color: #e2e8f0 !important;
    color: #334155 !important;
}
</style>
""", unsafe_allow_html=True)

# ---- Session State Initialization ----
if "transcript_result" not in st.session_state:
    st.session_state.transcript_result = None
if "transcript_history" not in st.session_state:
    st.session_state.transcript_history = []
if "uploader_reset_counter" not in st.session_state:
    st.session_state.uploader_reset_counter = 0
if "processing" not in st.session_state:
    st.session_state.processing = False

_assets_ready = assets_available()
_diar_status = diarization_status()
_asr_status_text = "Ready" if _assets_ready else "Assets missing"
if _diar_status["installed"] and _diar_status["token_configured"]:
    _diar_status_text = "Configured"
elif _diar_status["installed"]:
    _diar_status_text = "HF token required"
else:
    _diar_status_text = "Not installed"


def reset_transcription_view() -> None:
    st.session_state.transcript_result = None
    st.session_state.processing = False
    st.session_state.uploader_reset_counter += 1


# ---- Sidebar (branding + system status only) ----
with st.sidebar:
    st.markdown("""
        <div style="display:flex; align-items:center; gap:0.6rem; margin-bottom:1rem;">
            <div style="width:34px; height:34px; border-radius:8px; background:#4f46e5;
                 display:flex; align-items:center; justify-content:center; color:#fff; font-size:1.1rem;">
                 🎙️
            </div>
            <div>
                <div style="font-weight:700; font-size:1.1rem; color:#0f172a; letter-spacing:-0.02em;">VoxNote</div>
                <div style="font-size:0.72rem; color:#64748b; font-weight:500;">Clinical Audio Transcription</div>
            </div>
        </div>
    """, unsafe_allow_html=True)

    st.markdown("<hr style='margin:1rem 0; border:none; border-top:1px solid #e2e8f0;' />", unsafe_allow_html=True)

    st.markdown(f"""
        <div style="padding:0.75rem; background:#f8fafc; border:1px solid #f1f5f9; border-radius:8px;">
            <div style="font-size:0.72rem; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:0.04em;">System Status</div>
            <div style="font-size:0.75rem; color:#1e293b; margin-top:0.15rem;">● ASR: IndicConformer ONNX — {_asr_status_text}</div>
            <div style="font-size:0.75rem; color:#1e293b; margin-top:0.15rem;">● Diarization: pyannote.audio — {_diar_status_text}</div>
        </div>
    """, unsafe_allow_html=True)


# ==========================================
# MAIN VIEW: DASHBOARD
# ==========================================
# Header
col_hdr, col_action = st.columns([3, 1])
with col_hdr:
    st.markdown("<h2 style='font-weight:700; color:#0f172a; margin-bottom:0.2rem;'>Audio Transcription</h2>", unsafe_allow_html=True)
    st.markdown("<p style='color:#64748b; font-size:0.9rem; margin-top:0;'>Upload a consultation recording to generate a live transcript.</p>", unsafe_allow_html=True)
with col_action:
    st.button(
        "➕  New Transcription",
        type="primary",
        use_container_width=True,
        on_click=reset_transcription_view,
    )

st.markdown("<div style='margin-bottom:1rem;'></div>", unsafe_allow_html=True)

# ---- Upload Card ----
st.markdown("""
    <div class="vx-card">
        <div class="vx-card-header">
            <span>Upload Audio Recording</span>
            <span class="lang-chip">Doctor–Patient Audio</span>
        </div>
        <div class="vx-card-sub">
            Supported formats: <strong>MP3, WAV, M4A</strong> &nbsp;·&nbsp; Maximum file size: <strong>25 MB</strong>
        </div>
""", unsafe_allow_html=True)

uploaded_file = st.file_uploader(
    "Upload audio recording",
    type=ALLOWED_EXTENSIONS,
    label_visibility="collapsed",
    key=f"main_audio_uploader_{st.session_state.uploader_reset_counter}",
)

if uploaded_file is not None:
    file_size_mb = uploaded_file.size / (1024 * 1024)
    ext = uploaded_file.name.rsplit(".", 1)[-1].lower() if "." in uploaded_file.name else ""

    if ext not in ALLOWED_EXTENSIONS:
        st.error(f"❌ Unsupported format (.{ext}). Supported formats: {', '.join(ALLOWED_EXTENSIONS)}.")
    elif file_size_mb > MAX_FILE_SIZE_MB:
        st.error(f"❌ File too large ({file_size_mb:.1f} MB). Maximum allowed size is {MAX_FILE_SIZE_MB} MB.")
    else:
        st.markdown(f"""
            <div class="audio-meta-chip">
                <span>🎵</span>
                <strong>{uploaded_file.name}</strong>
                <span>·</span>
                <span class="lang-chip">{ext.upper()}</span>
                <span>·</span>
                <span>{file_size_mb:.2f} MB</span>
            </div>
        """, unsafe_allow_html=True)

        st.audio(uploaded_file)

        st.markdown(
            "<div style='font-size:0.8rem; font-weight:600; color:#475569; margin:0.75rem 0 0.35rem;'>Transcription settings</div>",
            unsafe_allow_html=True,
        )
        ctrl_lang, ctrl_mode, ctrl_spk = st.columns(3)
        with ctrl_lang:
            language_label = st.selectbox(
                "Language",
                LANGUAGE_OPTIONS,
                index=LANGUAGE_OPTIONS.index(DEFAULT_LANGUAGE_LABEL),
                key="asr_language",
            )
        with ctrl_mode:
            decoding_label = st.selectbox(
                "Decoding",
                list(DECODING_OPTIONS.keys()),
                index=0,
                key="asr_decoding",
            )
        with ctrl_spk:
            speaker_choice = st.selectbox(
                "Speakers",
                ["Auto-detect", "1", "2", "3", "4", "5", "6"],
                index=0,
                key="asr_speakers",
            )

        diarization_enabled = st.checkbox(
            "Label speakers with pyannote.audio",
            value=True,
            key="enable_diarization",
        )
        if diarization_enabled and not is_diarization_configured():
            st.caption(
                "⚠️ Speaker labeling needs HF_TOKEN in .env and access to the "
                "pyannote model on Hugging Face; transcription will still run "
                "with a single speaker label."
            )

        col_btn, col_spacer = st.columns([1, 2])
        with col_btn:
            if st.button("🚀  Generate Transcript", type="primary", use_container_width=True, disabled=st.session_state.processing):
                st.session_state.processing = True
                progress_bar = st.progress(0, text="Initializing transcription pipeline...")

                def on_progress(p: float, text: str):
                    progress_bar.progress(p, text=text)

                num_speakers = (
                    None
                    if speaker_choice == "Auto-detect"
                    else int(speaker_choice)
                )
                try:
                    res = transcribe(
                        uploaded_file.name,
                        uploaded_file.getvalue(),
                        progress_callback=on_progress,
                        language=LANGUAGE_LABELS[language_label],
                        decoding=DECODING_OPTIONS[decoding_label],
                        num_speakers=num_speakers,
                        enable_diarization=diarization_enabled,
                    )
                except Exception as exc:
                    st.session_state.processing = False
                    progress_bar.empty()
                    st.error(f"❌ Transcription failed: {exc}")
                else:
                    if is_translation_configured():
                        with st.spinner("Translating transcript to English..."):
                            try:
                                res["transcript_en"] = translate_turns(
                                    res["transcript"]
                                )
                            except Exception as exc:
                                st.warning(f"English translation failed: {exc}")
                    res["details"]["processed_at"] = datetime.now().strftime(
                        "%Y-%m-%d %H:%M"
                    )
                    st.session_state.transcript_history.insert(0, res)
                    st.session_state.transcript_result = res
                    st.session_state.processing = False
                    st.rerun()

st.markdown("</div>", unsafe_allow_html=True)

# ---- Transcription Result Card ----
current_result = st.session_state.transcript_result

if current_result:
    transcript = current_result.get("transcript", [])
    details = current_result.get("details", {})
    active_title = details.get("file_name", "Consultation Transcript")

    banner_html = f"""
        <div class="live-banner">
            <span style="font-size:1.1rem;">✅</span>
            <div>
                <strong>Live transcription</strong> — {details.get('asr_model', 'IndicConformer-600M-Multilingual (ONNX)')}
                &nbsp;·&nbsp; {details.get('decoding', 'RNNT')} decoding
                &nbsp;·&nbsp; Speakers: {details.get('diarization', 'pyannote.audio')}
            </div>
        </div>
    """

    st.markdown(f"""
        <div class="vx-card">
            <div class="vx-card-header">
                <span>📄 {active_title}</span>
                <span class="status-chip">{details.get('processing_status', 'Completed')}</span>
            </div>
            <div class="vx-card-sub">
                Language: <strong>{details.get('language', 'Hinglish')}</strong> &nbsp;·&nbsp;
                Duration: <strong>{details.get('audio_duration', '1m 12s')}</strong> &nbsp;·&nbsp;
                Specialty: <strong>{details.get('medical_specialty', 'General Medicine')}</strong>
            </div>

            {banner_html}
    """, unsafe_allow_html=True)

    if details.get("diarization_warning"):
        st.warning(details["diarization_warning"])

    tab_conv, tab_meta = st.tabs(["💬 Dialogue Transcript", "📋 File & Audio Details"])

    with tab_conv:
        transcript_en = current_result.get("transcript_en") or []

        if transcript_en:
            lang_choice = st.radio(
                "Transcript language",
                ["English", "Original"],
                horizontal=True,
                key="transcript_lang_choice",
            )
        else:
            lang_choice = "Original"

        active_transcript = (
            transcript_en if lang_choice == "English" else transcript
        )

        q_filter = st.text_input("Search in transcript turns...", placeholder="Filter by symptom, medicine, or word...", label_visibility="collapsed")

        filtered_turns = active_transcript
        if q_filter:
            q_lower = q_filter.lower()
            filtered_turns = [t for t in active_transcript if q_lower in t["text"].lower() or q_lower in t["speaker"].lower()]

        if not filtered_turns:
            st.info(f"No dialogue turns match '{q_filter}'.")
        else:
            for turn in filtered_turns:
                badge_cls = "speaker-badge-speaker"
                st.markdown(f"""
                    <div class="speaker-bubble">
                        <div class="speaker-col-meta">
                            <span class="{badge_cls}">{turn['speaker']}</span>
                            <span class="speaker-timestamp">⏱ {turn['timestamp']}</span>
                        </div>
                        <div class="speaker-text">“{turn['text']}”</div>
                    </div>
                """, unsafe_allow_html=True)

        st.markdown("<div style='margin-top:1.25rem;'></div>", unsafe_allow_html=True)

        plain_text = "\n\n".join([f"[{t['timestamp']}] {t['speaker']}: {t['text']}" for t in transcript])
        plain_text_en = (
            "\n\n".join(
                [f"[{t['timestamp']}] {t['speaker']}: {t['text']}" for t in transcript_en]
            )
            if transcript_en
            else ""
        )
        json_text = json.dumps(current_result, indent=2, ensure_ascii=False)

        if st.button("📋  Show Plaintext for Copy", use_container_width=True):
            st.code(plain_text_en or plain_text, language="markdown")
            st.caption("Press Ctrl+A → Ctrl+C to copy.")

        if transcript_en:
            col_orig, col_en, col_json = st.columns(3)
            with col_orig:
                st.download_button(
                    label="⬇️  Download Original (.txt)",
                    data=plain_text,
                    file_name=f"{active_title}_original.txt",
                    mime="text/plain",
                    use_container_width=True,
                )

            with col_en:
                st.download_button(
                    label="⬇️  Download English (.txt)",
                    data=plain_text_en,
                    file_name=f"{active_title}_english.txt",
                    mime="text/plain",
                    use_container_width=True,
                )

            with col_json:
                st.download_button(
                    label="⬇️  Download .json",
                    data=json_text,
                    file_name=f"{active_title}_transcript.json",
                    mime="application/json",
                    use_container_width=True,
                )
        else:
            col_orig, col_json = st.columns(2)
            with col_orig:
                st.download_button(
                    label="⬇️  Download .txt",
                    data=plain_text,
                    file_name=f"{active_title}_transcript.txt",
                    mime="text/plain",
                    use_container_width=True,
                )

            with col_json:
                st.download_button(
                    label="⬇️  Download .json",
                    data=json_text,
                    file_name=f"{active_title}_transcript.json",
                    mime="application/json",
                    use_container_width=True,
                )

    with tab_meta:
        st.markdown("""
            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:1.25rem; background:#f8fafc; border:1px solid #f1f5f9; border-radius:10px; padding:1.25rem;">
                <div>
                    <div style="font-size:0.75rem; color:#64748b; font-weight:500; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.25rem;">File Name</div>
                    <div style="font-size:0.95rem; color:#0f172a; font-weight:600;">{fname}</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:#64748b; font-weight:500; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.25rem;">Audio Duration</div>
                    <div style="font-size:0.95rem; color:#0f172a; font-weight:600;">{dur}</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:#64748b; font-weight:500; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.25rem;">Language</div>
                    <div style="font-size:0.95rem; color:#0f172a; font-weight:600;">{lang}</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:#64748b; font-weight:500; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.25rem;">Detected Speakers</div>
                    <div style="font-size:0.95rem; color:#0f172a; font-weight:600;">{spk} Speakers</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:#64748b; font-weight:500; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.25rem;">ASR Engine</div>
                    <div style="font-size:0.95rem; color:#0f172a; font-weight:600;">{asr}</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:#64748b; font-weight:500; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.25rem;">Decoding Mode</div>
                    <div style="font-size:0.95rem; color:#0f172a; font-weight:600;">{dec}</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:#64748b; font-weight:500; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.25rem;">Diarization Engine</div>
                    <div style="font-size:0.95rem; color:#0f172a; font-weight:600;">{diar}</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:#64748b; font-weight:500; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.25rem;">Model Confidence</div>
                    <div style="font-size:0.95rem; color:#0f172a; font-weight:600;">{conf}</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:#64748b; font-weight:500; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.25rem;">Word Count</div>
                    <div style="font-size:0.95rem; color:#0f172a; font-weight:600;">{wc} words</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:#64748b; font-weight:500; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.25rem;">Medical Specialty</div>
                    <div style="font-size:0.95rem; color:#0f172a; font-weight:600;">{spec}</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:#64748b; font-weight:500; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.25rem;">Audio Sample Rate</div>
                    <div style="font-size:0.95rem; color:#0f172a; font-weight:600;">{sr}</div>
                </div>
                <div>
                    <div style="font-size:0.75rem; color:#64748b; font-weight:500; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:0.25rem;">Channels</div>
                    <div style="font-size:0.95rem; color:#0f172a; font-weight:600;">{ch}</div>
                </div>
            </div>
        """.format(
            fname=details.get("file_name", "audio_recording"),
            dur=details.get("audio_duration", "—"),
            lang=details.get("language", "—"),
            spk=details.get("speakers_detected", 1),
            asr=details.get("asr_model", "IndicConformer-600M-Multilingual (ONNX)"),
            dec=details.get("decoding", "RNNT"),
            diar=details.get("diarization", "pyannote.audio"),
            conf=details.get("confidence_score", "N/A"),
            wc=details.get("word_count", "—"),
            spec=details.get("medical_specialty", "General Medicine"),
            sr=details.get("sample_rate", "—"),
            ch=details.get("channels", "—"),
        ), unsafe_allow_html=True)

    st.markdown("</div>", unsafe_allow_html=True)

# ---- Recent Transcriptions History ----
session_history = st.session_state.transcript_history
st.markdown("""
    <div class="vx-card">
        <div class="vx-card-header">
            <span>Recent Transcriptions</span>
            <span style="font-size:0.8rem; color:#64748b; font-weight:normal;">{count} in this session</span>
        </div>
        <div class="vx-card-sub">
            Transcriptions generated during this browser session.
        </div>
""".format(count=len(session_history)), unsafe_allow_html=True)

if not session_history:
    st.info(
        "No transcriptions yet. Upload an audio file above to generate the first transcript."
    )
else:
    language_values = sorted(
        {
            record.get("details", {}).get("language", "")
            for record in session_history
            if record.get("details", {}).get("language")
        }
    )
    col_srch, col_flt = st.columns([3, 1])
    with col_srch:
        hist_query = st.text_input(
            "Search history recordings...",
            placeholder="Search by file name or language...",
            label_visibility="collapsed",
        )
    with col_flt:
        lang_filter = st.selectbox(
            "Language Filter",
            ["All Languages", *language_values],
            label_visibility="collapsed",
        )

    filtered_hist = []
    for record in session_history:
        record_details = record.get("details", {})
        haystack = (
            f"{record_details.get('file_name', '')} "
            f"{record_details.get('language', '')}"
        ).lower()
        if hist_query and hist_query.lower() not in haystack:
            continue
        if (
            lang_filter != "All Languages"
            and lang_filter != record_details.get("language")
        ):
            continue
        filtered_hist.append(record)

    if not filtered_hist:
        st.info("No transcriptions match your search filter.")
    else:
        for index, rec in enumerate(filtered_hist):
            rec_details = rec.get("details", {})
            col_info, col_tag, col_act = st.columns([3, 2, 1])
            with col_info:
                st.markdown(f"""
                    <div>
                        <div style="font-weight:600; font-size:0.88rem; color:#1e293b;">📁 {rec_details.get('file_name', 'Recording')}</div>
                        <div style="font-size:0.76rem; color:#64748b; margin-top:0.15rem;">{rec_details.get('processed_at', '—')} · {rec_details.get('audio_duration', '—')}</div>
                    </div>
                """, unsafe_allow_html=True)
            with col_tag:
                st.markdown(f"""
                    <div style="padding-top:0.3rem;">
                        <span class="lang-chip">{rec_details.get('language', '—')}</span>
                        <span class="status-chip">{rec_details.get('processing_status', 'Completed')}</span>
                    </div>
                """, unsafe_allow_html=True)
            with col_act:
                def _open(rec=rec):
                    st.session_state.transcript_result = rec
                st.button(
                    "Open",
                    key=f"open_dash_{index}",
                    use_container_width=True,
                    on_click=_open,
                )

st.markdown("</div>", unsafe_allow_html=True)
