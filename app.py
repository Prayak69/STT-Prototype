# -*- coding: utf-8 -*-
"""
VoxNote - Minimalist Audio Transcription Dashboard
Doctor-Patient Consultation Intelligence (Dummy Data Prototype)
"""
from __future__ import annotations
import json
import streamlit as st
from mock_data import (
    TRANSCRIPTION_HISTORY,
    ALLOWED_EXTENSIONS,
    MAX_FILE_SIZE_MB,
    SAMPLE_TRANSCRIPT,
    SAMPLE_DETAILS,
)
from transcription_service import transcribe

# ---- Streamlit Page Configuration ----
st.set_page_config(
    page_title="VoxNote — Clinical Audio Transcription",
    page_icon="🎙️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---- Custom Minimalist CSS ----
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

html, body, [class*="st-"] {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #0f172a;
}

/* Background & layout */
.stApp {
    background-color: #f8fafc;
}

/* Sidebar styling */
section[data-testid="stSidebar"] {
    background-color: #ffffff;
    border-right: 1px solid #e2e8f0;
    padding-top: 1.5rem;
}

section[data-testid="stSidebar"] div[data-testid="stVerticalBlock"] > div:first-child {
    padding-top: 0;
}

/* Card containers */
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
    margin-bottom: 1.15rem;
    line-height: 1.45;
}

/* Metric stat widgets */
.stat-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    margin-bottom: 1.25rem;
}

.stat-box {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 1.1rem 1.25rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}

.stat-label {
    font-size: 0.78rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #64748b;
    margin-bottom: 0.35rem;
}

.stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.1;
}

.stat-meta {
    font-size: 0.75rem;
    color: #10b981;
    margin-top: 0.35rem;
    display: flex;
    align-items: center;
    gap: 0.25rem;
}

/* Sample data disclaimer badge */
.sample-banner {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    background-color: #fffbeb;
    border: 1px solid #fef3c7;
    border-left: 4px solid #f59e0b;
    border-radius: 8px;
    padding: 0.85rem 1rem;
    font-size: 0.83rem;
    color: #92400e;
    margin-bottom: 1.25rem;
    line-height: 1.45;
}

/* Speaker transcript turns */
.speaker-bubble {
    display: flex;
    gap: 1.1rem;
    padding: 1.1rem 1.25rem;
    border-radius: 10px;
    margin-bottom: 0.75rem;
    background-color: #f8fafc;
    border: 1px solid #f1f5f9;
    transition: all 0.15s ease;
}

.speaker-bubble:hover {
    background-color: #ffffff;
    border-color: #e2e8f0;
    box-shadow: 0 2px 4px rgba(0,0,0,0.02);
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

/* Details grid */
.detail-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.25rem;
    background: #f8fafc;
    border: 1px solid #f1f5f9;
    border-radius: 10px;
    padding: 1.25rem;
}

.detail-item-title {
    font-size: 0.75rem;
    color: #64748b;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: 0.25rem;
}

.detail-item-val {
    font-size: 0.95rem;
    color: #0f172a;
    font-weight: 600;
}

/* History row */
.history-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.9rem 1.1rem;
    border-bottom: 1px solid #f1f5f9;
    transition: background-color 0.1s ease;
}

.history-row:hover {
    background-color: #f8fafc;
}

.history-filename {
    font-weight: 600;
    font-size: 0.88rem;
    color: #1e293b;
}

.history-sub {
    font-size: 0.76rem;
    color: #64748b;
    margin-top: 0.15rem;
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

/* Custom file info chip */
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

/* Buttons and adjustments */
button[kind="primary"] {
    background-color: #4f46e5 !important;
    border-color: #4f46e5 !important;
    font-weight: 500 !important;
}

button[kind="secondary"] {
    border-color: #e2e8f0 !important;
    color: #334155 !important;
}

/* Hide streamlit default top bar fluff */
#MainMenu {visibility: hidden;}
footer {visibility: hidden;}
header {visibility: hidden;}
</style>
""", unsafe_allow_html=True)

# ---- Session State Initialization ----
if "transcript_result" not in st.session_state:
    st.session_state.transcript_result = None
if "active_history" not in st.session_state:
    # Set default preview to the first consultation record
    st.session_state.active_history = {
        "transcript": TRANSCRIPTION_HISTORY[0]["transcript"],
        "details": TRANSCRIPTION_HISTORY[0]["details"],
    }
if "processing" not in st.session_state:
    st.session_state.processing = False


# ---- Sidebar Navigation & Profile ----
with st.sidebar:
    # Brand
    st.markdown("""
        <div style="display:flex; align-items:center; gap:0.6rem; margin-bottom:0.2rem;">
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

    # Navigation
    nav_selection = st.radio(
        "Navigation",
        options=["📊 Dashboard", "📋 Transcriptions", "⚙️ Settings"],
        index=0,
        label_visibility="collapsed",
    )

    st.markdown("<hr style='margin:1.25rem 0; border:none; border-top:1px solid #e2e8f0;' />", unsafe_allow_html=True)

    # Clinic Workspace info
    st.markdown("""
        <div style="padding:0.75rem; background:#f8fafc; border:1px solid #f1f5f9; border-radius:8px; margin-bottom:1.5rem;">
            <div style="font-size:0.72rem; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:0.04em;">Active Clinic</div>
            <div style="font-size:0.85rem; font-weight:600; color:#1e293b; margin-top:0.2rem;">MetroCare Multispecialty</div>
            <div style="font-size:0.75rem; color:#10b981; margin-top:0.15rem;">● STT Engine: Online (Mock)</div>
        </div>
    """, unsafe_allow_html=True)

    st.markdown("<div style='height: 180px;'></div>", unsafe_allow_html=True)

    # User Profile Section
    st.markdown("""
        <div style="display:flex; align-items:center; gap:0.75rem; padding:0.6rem 0.2rem; border-top:1px solid #e2e8f0;">
            <div style="width:36px; height:36px; border-radius:50%; background:#eef2ff;
                 display:flex; align-items:center; justify-content:center; font-weight:600;
                 color:#4f46e5; font-size:0.85rem; border:1px solid #c7d2fe;">
                 DR
            </div>
            <div style="flex-grow:1; min-width:0;">
                <div style="font-weight:600; font-size:0.86rem; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Dr. Rajesh Kumar</div>
                <div style="font-size:0.72rem; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">rajesh@metrocare.in</div>
            </div>
        </div>
    """, unsafe_allow_html=True)


# ==========================================
# VIEW 1: DASHBOARD
# ==========================================
if nav_selection == "📊 Dashboard":
    # Header
    col_hdr, col_action = st.columns([3, 1])
    with col_hdr:
        st.markdown("<h2 style='font-weight:700; color:#0f172a; margin-bottom:0.2rem;'>Audio Transcription</h2>", unsafe_allow_html=True)
        st.markdown("<p style='color:#64748b; font-size:0.9rem; margin-top:0;'>Upload clinical recordings or select existing consultations to review AI transcripts.</p>", unsafe_allow_html=True)
    with col_action:
        if st.button("➕  New Transcription", type="primary", use_container_width=True):
            st.session_state.transcript_result = None
            st.session_state.active_history = None
            st.session_state.processing = False
            st.rerun()

    st.markdown("<div style='margin-bottom:1rem;'></div>", unsafe_allow_html=True)

    # Metric Stats Cards
    st.markdown("""
        <div class="stat-grid">
            <div class="stat-box">
                <div class="stat-label">Total Recordings</div>
                <div class="stat-value">28</div>
                <div class="stat-meta">↑ 4 added this week</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Audio Processed</div>
                <div class="stat-value">5h 42m</div>
                <div class="stat-meta">Avg 2m 14s / call</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Avg Accuracy</div>
                <div class="stat-value">98.6%</div>
                <div class="stat-meta">Clinical benchmark</div>
            </div>
            <div class="stat-box">
                <div class="stat-label">Supported Languages</div>
                <div class="stat-value">Hinglish / EN</div>
                <div class="stat-meta">Devanagari enabled</div>
            </div>
        </div>
    """, unsafe_allow_html=True)

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
        key="main_audio_uploader",
    )

    if uploaded_file is not None:
        file_size_mb = uploaded_file.size / (1024 * 1024)
        ext = uploaded_file.name.rsplit(".", 1)[-1].lower() if "." in uploaded_file.name else ""

        if ext not in ALLOWED_EXTENSIONS:
            st.error(f"❌ Unsupported format (.{ext}). Supported formats: {', '.join(ALLOWED_EXTENSIONS)}.")
        elif file_size_mb > MAX_FILE_SIZE_MB:
            st.error(f"❌ File too large ({file_size_mb:.1f} MB). Maximum allowed size is {MAX_FILE_SIZE_MB} MB.")
        else:
            # File metadata chip & audio preview
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

            col_btn, col_spacer = st.columns([1, 2])
            with col_btn:
                if st.button("🚀  Generate Transcript", type="primary", use_container_width=True, disabled=st.session_state.processing):
                    st.session_state.processing = True
                    progress_bar = st.progress(0, text="Initializing transcription pipeline...")

                    def on_progress(p: float, text: str):
                        progress_bar.progress(p, text=text)

                    res = transcribe(uploaded_file.name, uploaded_file.getvalue(), progress_callback=on_progress)
                    st.session_state.transcript_result = res
                    st.session_state.active_history = None
                    st.session_state.processing = False
                    st.rerun()

    st.markdown("</div>", unsafe_allow_html=True)

    # ---- Transcription Result Card ----
    current_result = st.session_state.transcript_result or st.session_state.active_history

    if current_result:
        transcript = current_result.get("transcript", [])
        details = current_result.get("details", {})
        active_title = details.get("file_name", "Consultation Transcript")

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

                <div class="sample-banner">
                    <span style="font-size:1.1rem;">⚠️</span>
                    <div>
                        <strong>Sample Data Prototype</strong> — This transcript is predefined clinical dummy content for UI evaluation and was not processed through a live speech backend.
                    </div>
                </div>
        """, unsafe_allow_html=True)

        tab_conv, tab_soap, tab_meta = st.tabs(["💬 Dialogue Transcript", "🩺 Clinical SOAP Note", "📋 File & Audio Details"])

        with tab_conv:
            # Keyword filter inside transcript
            q_filter = st.text_input("Search in transcript turns...", placeholder="Filter by symptom, medicine, or word...", label_visibility="collapsed")

            filtered_turns = transcript
            if q_filter:
                q_lower = q_filter.lower()
                filtered_turns = [t for t in transcript if q_lower in t["text"].lower() or q_lower in t["speaker"].lower()]

            if not filtered_turns:
                st.info(f"No dialogue turns match '{q_filter}'.")
            else:
                for turn in filtered_turns:
                    badge_cls = "speaker-badge-doctor" if turn["speaker"] == "Doctor" else "speaker-badge-patient"
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

            # Export & Copy Actions
            plain_text = "\n\n".join([f"[{t['timestamp']}] {t['speaker']}: {t['text']}" for t in transcript])
            json_text = json.dumps(current_result, indent=2, ensure_ascii=False)

            col_copy, col_down_txt, col_down_json = st.columns([1, 1, 1])
            with col_copy:
                if st.button("📋  Show Plaintext for Copy", use_container_width=True):
                    st.code(plain_text, language="markdown")
                    st.caption("Press Ctrl+A → Ctrl+C to copy.")

            with col_down_txt:
                st.download_button(
                    label="⬇️  Download .txt",
                    data=plain_text,
                    file_name=f"{active_title}_transcript.txt",
                    mime="text/plain",
                    use_container_width=True,
                )

            with col_down_json:
                st.download_button(
                    label="⬇️  Download .json",
                    data=json_text,
                    file_name=f"{active_title}_transcript.json",
                    mime="application/json",
                    use_container_width=True,
                )

        with tab_soap:
            st.markdown("""
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:1.25rem;">
                    <div style="margin-bottom:1rem;">
                        <span style="font-weight:700; color:#4338ca; font-size:0.85rem; text-transform:uppercase;">S — Subjective</span>
                        <div style="font-size:0.9rem; color:#1e293b; margin-top:0.3rem; line-height:1.5;">
                            Patient reports exertional chest heaviness and mild breathlessness when climbing stairs over the past 3–4 days. Discomfort settles with rest. No radiation to neck, left shoulder, or jaw. Past medical history positive for mild hypertension.
                        </div>
                    </div>
                    <div style="margin-bottom:1rem;">
                        <span style="font-weight:700; color:#0f766e; font-size:0.85rem; text-transform:uppercase;">O — Objective</span>
                        <div style="font-size:0.9rem; color:#1e293b; margin-top:0.3rem; line-height:1.5;">
                            Current medication: Tab. Amlodipine 5mg OD post-breakfast. Vitals examination and 12-lead resting ECG scheduled immediately on couch.
                        </div>
                    </div>
                    <div style="margin-bottom:1rem;">
                        <span style="font-weight:700; color:#d97706; font-size:0.85rem; text-transform:uppercase;">A — Assessment</span>
                        <div style="font-size:0.9rem; color:#1e293b; margin-top:0.3rem; line-height:1.5;">
                            Exertional angina / ischemic heart disease to be ruled out vs. hypertensive cardiac follow-up.
                        </div>
                    </div>
                    <div>
                        <span style="font-weight:700; color:#dc2626; font-size:0.85rem; text-transform:uppercase;">P — Plan</span>
                        <div style="font-size:0.9rem; color:#1e293b; margin-top:0.3rem; line-height:1.5;">
                            1. Immediate 12-lead ECG.<br/>
                            2. Serum Troponin-I and lipid profile test.<br/>
                            3. Continue Amlodipine 5mg; review with ECG traces.
                        </div>
                    </div>
                </div>
            """, unsafe_allow_html=True)

        with tab_meta:
            st.markdown("""
                <div class="detail-grid">
                    <div>
                        <div class="detail-item-title">File Name</div>
                        <div class="detail-item-val">{fname}</div>
                    </div>
                    <div>
                        <div class="detail-item-title">Audio Duration</div>
                        <div class="detail-item-val">{dur}</div>
                    </div>
                    <div>
                        <div class="detail-item-title">Language Model</div>
                        <div class="detail-item-val">{lang}</div>
                    </div>
                    <div>
                        <div class="detail-item-title">Detected Speakers</div>
                        <div class="detail-item-val">{spk} Speakers</div>
                    </div>
                    <div>
                        <div class="detail-item-title">Model Confidence</div>
                        <div class="detail-item-val">{conf}</div>
                    </div>
                    <div>
                        <div class="detail-item-title">Word Count</div>
                        <div class="detail-item-val">{wc} words</div>
                    </div>
                    <div>
                        <div class="detail-item-title">Medical Specialty</div>
                        <div class="detail-item-val">{spec}</div>
                    </div>
                    <div>
                        <div class="detail-item-title">Audio Sample Rate</div>
                        <div class="detail-item-val">{sr}</div>
                    </div>
                    <div>
                        <div class="detail-item-title">Channels</div>
                        <div class="detail-item-val">{ch}</div>
                    </div>
                </div>
            """.format(
                fname=details.get("file_name", "audio_recording"),
                dur=details.get("audio_duration", "—"),
                lang=details.get("language", "Hinglish"),
                spk=details.get("speakers_detected", 2),
                conf=details.get("confidence_score", "98.6%"),
                wc=details.get("word_count", "—"),
                spec=details.get("medical_specialty", "General"),
                sr=details.get("sample_rate", "44.1 kHz"),
                ch=details.get("channels", "Mono"),
            ), unsafe_allow_html=True)

        st.markdown("</div>", unsafe_allow_html=True)

    # ---- Recent Transcriptions History ----
    st.markdown("""
        <div class="vx-card">
            <div class="vx-card-header">
                <span>Recent Transcriptions</span>
                <span style="font-size:0.8rem; color:#64748b; font-weight:normal;">Sample archive</span>
            </div>
            <div class="vx-card-sub">
                Quickly browse and inspect previous doctor-patient consultation recordings.
            </div>
    """, unsafe_allow_html=True)

    col_srch, col_flt = st.columns([3, 1])
    with col_srch:
        hist_query = st.text_input("Search history recordings...", placeholder="Search by file name or language...", label_visibility="collapsed")
    with col_flt:
        lang_filter = st.selectbox("Language Filter", ["All Languages", "Hinglish", "Hindi", "English"], label_visibility="collapsed")

    filtered_hist = TRANSCRIPTION_HISTORY
    if hist_query:
        hq = hist_query.lower()
        filtered_hist = [r for r in filtered_hist if hq in r["file_name"].lower() or hq in r["language"].lower()]

    if lang_filter != "All Languages":
        filtered_hist = [r for r in filtered_hist if lang_filter.lower() in r["language"].lower()]

    if not filtered_hist:
        st.info("No recorded consultations found matching your search filter.")
    else:
        for rec in filtered_hist:
            col_info, col_tag, col_act = st.columns([3, 2, 1])
            with col_info:
                st.markdown(f"""
                    <div>
                        <div class="history-filename">📁 {rec['file_name']}</div>
                        <div class="history-sub">Recorded on {rec['date']} · {rec['duration']}</div>
                    </div>
                """, unsafe_allow_html=True)
            with col_tag:
                st.markdown(f"""
                    <div style="padding-top:0.3rem;">
                        <span class="lang-chip">{rec['language']}</span>
                        <span class="status-chip">{rec['status']}</span>
                    </div>
                """, unsafe_allow_html=True)
            with col_act:
                if st.button("Open", key=f"open_dash_{rec['id']}", use_container_width=True):
                    st.session_state.active_history = {
                        "transcript": rec["transcript"],
                        "details": rec["details"],
                    }
                    st.session_state.transcript_result = None
                    st.rerun()

    st.markdown("</div>", unsafe_allow_html=True)


# ==========================================
# VIEW 2: TRANSCRIPTIONS LIBRARY
# ==========================================
elif nav_selection == "📋 Transcriptions":
    st.markdown("<h2 style='font-weight:700; color:#0f172a; margin-bottom:0.2rem;'>Transcriptions Library</h2>", unsafe_allow_html=True)
    st.markdown("<p style='color:#64748b; font-size:0.9rem; margin-top:0;'>Comprehensive archive of recorded patient encounters, speaker breakdowns, and export records.</p>", unsafe_allow_html=True)

    st.markdown("""
        <div class="vx-card">
            <div class="vx-card-header">
                <span>All Consultation Files</span>
                <span class="lang-chip">4 Records</span>
            </div>
    """, unsafe_allow_html=True)

    for item in TRANSCRIPTION_HISTORY:
        with st.expander(f"📁 {item['file_name']}  ({item['language']} · {item['duration']})", expanded=False):
            col_left, col_right = st.columns([3, 2])
            with col_left:
                st.markdown("**Transcript Preview:**")
                for t in item["transcript"][:3]:
                    st.markdown(f"**{t['speaker']}** ({t['timestamp']}): *{t['text']}*")
                if len(item["transcript"]) > 3:
                    st.caption(f"... and {len(item['transcript']) - 3} more turns.")
            with col_right:
                st.markdown("**Session Metadata:**")
                st.markdown(f"- **Specialty:** {item['details'].get('medical_specialty', 'Clinical')}")
                st.markdown(f"- **Accuracy:** {item['details'].get('confidence_score', '98.5%')}")
                st.markdown(f"- **Word Count:** {item['details'].get('word_count', 80)} words")
                if st.button("Load in Main Viewer", key=f"lib_view_{item['id']}"):
                    st.session_state.active_history = {
                        "transcript": item["transcript"],
                        "details": item["details"],
                    }
                    st.session_state.transcript_result = None
                    st.success("Loaded consultation into dashboard view!")

    st.markdown("</div>", unsafe_allow_html=True)


# ==========================================
# VIEW 3: SETTINGS
# ==========================================
elif nav_selection == "⚙️ Settings":
    st.markdown("<h2 style='font-weight:700; color:#0f172a; margin-bottom:0.2rem;'>System Settings</h2>", unsafe_allow_html=True)
    st.markdown("<p style='color:#64748b; font-size:0.9rem; margin-top:0;'>Configure speech recognition parameters, medical dictionaries, and export formats.</p>", unsafe_allow_html=True)

    st.markdown("""
        <div class="vx-card">
            <div class="vx-card-header">Speech Recognition Model</div>
            <div class="vx-card-sub">Fine-tune acoustic models and medical lexicon recognition.</div>
    """, unsafe_allow_html=True)

    c1, c2 = st.columns(2)
    with c1:
        st.selectbox("Primary Language / Dialect", ["Hinglish (Hindi + English colloquial)", "Hindi (Devanagari)", "English (Indian Accent)", "English (US)"])
        st.selectbox("Acoustic Model Tier", ["Clinical Conformer V3 (High Accuracy)", "Whisper Large V3 (Clinical Fine-tune)", "Lightweight Fast STT"])
    with c2:
        st.number_input("Max Expected Speakers", min_value=1, max_value=6, value=2)
        st.checkbox("Enable Automatic Speaker Diarization", value=True)
        st.checkbox("Auto-Punctuate & Format Medical Dosages", value=True)

    st.markdown("</div>", unsafe_allow_html=True)

    st.markdown("""
        <div class="vx-card">
            <div class="vx-card-header">Medical Vocabulary & Specialty Boosting</div>
            <div class="vx-card-sub">Prioritize domain-specific pharmaceutical, diagnostic, and anatomical terms.</div>
    """, unsafe_allow_html=True)

    st.multiselect(
        "Active Medical Specialties",
        ["Cardiology", "Internal Medicine", "Pediatrics", "Orthopedics", "Pharmacology (Brand Names)", "Pathology"],
        default=["Cardiology", "Internal Medicine", "Pharmacology (Brand Names)"]
    )
    st.text_area("Custom Medication / Doctor Phrasing Dictionary", value="Amlodipine, Metoprolol, ECG, Troponin-I, Paracetamol, CBC, SpO2", help="Comma-separated custom medical terminology")

    st.markdown("</div>", unsafe_allow_html=True)

    st.markdown("""
        <div class="vx-card">
            <div class="vx-card-header">Patient Confidentiality & Security</div>
            <div class="vx-card-sub">Data handling and privacy compliance parameters.</div>
    """, unsafe_allow_html=True)

    st.checkbox("Anonymize Patient PII in Exported Transcripts", value=True)
    st.checkbox("Auto-purge audio buffers after transcript generation", value=True)

    if st.button("Save Preferences", type="primary"):
        st.success("✅ Preferences saved successfully!")

    st.markdown("</div>", unsafe_allow_html=True)
