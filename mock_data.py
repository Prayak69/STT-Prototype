# -*- coding: utf-8 -*-
"""
Mock data for the VoxNote transcription dashboard.
Replace this file with real API responses when integrating a backend.
"""

SAMPLE_TRANSCRIPT = [
    {
        "speaker": "Doctor",
        "timestamp": "00:00:02",
        "text": "Good morning, Mrs. Sharma. Please have a seat. What brings you in today?"
    },
    {
        "speaker": "Patient",
        "timestamp": "00:00:07",
        "text": "Good morning, Doctor. Actually, past 3-4 din se mujhe persistent chest heaviness aur mild shortness of breath lag raha hai, especially stair climb karte waqt."
    },
    {
        "speaker": "Doctor",
        "timestamp": "00:00:16",
        "text": "I understand. Does the discomfort radiate towards your left shoulder, neck, or jaw? Any profuse sweating?"
    },
    {
        "speaker": "Patient",
        "timestamp": "00:00:24",
        "text": "No doctor, neck ya shoulder mein pain nahi hai. Mostly central chest discomfort hai, and it settles down jab main thoda rest leti hoon."
    },
    {
        "speaker": "Doctor",
        "timestamp": "00:00:35",
        "text": "Understood. Any history of diabetes, hypertension, or high cholesterol in your family? Are you currently on any medication?"
    },
    {
        "speaker": "Patient",
        "timestamp": "00:00:43",
        "text": "Yes doctor, mild BP issues hain. I take Amlodipine 5mg once daily in the morning after breakfast."
    },
    {
        "speaker": "Doctor",
        "timestamp": "00:00:52",
        "text": "Alright. Let us immediately check your vitals, BP, and get a 12-lead ECG done right away. Please lie down on the examination couch."
    },
    {
        "speaker": "Patient",
        "timestamp": "00:01:02",
        "text": "Sure doctor, thank you."
    }
]

SAMPLE_DETAILS = {
    "file_name": "patient_consultation_01.mp3",
    "audio_duration": "1 min 12 sec",
    "language": "Hinglish (Hindi-English)",
    "speakers_detected": 2,
    "processing_status": "Completed",
    "word_count": 124,
    "confidence_score": "98.6%",
    "medical_specialty": "Cardiology / Internal Medicine",
    "sample_rate": "44.1 kHz",
    "channels": "Mono"
}

TRANSCRIPTION_HISTORY = [
    {
        "id": "rec_001",
        "file_name": "patient_consultation_01.mp3",
        "language": "Hinglish",
        "duration": "1:12",
        "date": "2026-10-24",
        "status": "Completed",
        "transcript": SAMPLE_TRANSCRIPT,
        "details": SAMPLE_DETAILS,
    },
    {
        "id": "rec_002",
        "file_name": "clinic_followup_hindi.wav",
        "language": "Hindi",
        "duration": "2:45",
        "date": "2026-10-23",
        "status": "Completed",
        "transcript": [
            {"speaker": "Doctor",  "timestamp": "00:00:03", "text": "नमस्ते रमेश जी, अब आपकी तबियत कैसी है? पिछली बार दी गई दवाइयों से कुछ आराम मिला?"},
            {"speaker": "Patient", "timestamp": "00:00:10", "text": "जी डॉक्टर साहब, बुखार तो अब बिल्कुल ठीक है, लेकिन कभी-कभी सिर में हल्का दर्द और कमजोरी महसूस होती है।"},
            {"speaker": "Doctor",  "timestamp": "00:00:18", "text": "खून की जांच की रिपोर्ट सामान्य आई है। कमजोरी के लिए मैं मल्टीविटामिन लिख रहा हूँ, और पानी पर्याप्त मात्रा में पिएं।"},
            {"speaker": "Patient", "timestamp": "00:00:26", "text": "जी डॉक्टर साहब, क्या मुझे खाने-पीने में कोई खास परहेज़ रखना होगा?"},
            {"speaker": "Doctor",  "timestamp": "00:00:32", "text": "बस तला-भुना और ज्यादा मसालेदार खाना कम करें, बाकी आप सामान्य पौष्टिक आहार ले सकते हैं।"}
        ],
        "details": {
            "file_name": "clinic_followup_hindi.wav",
            "audio_duration": "2 min 45 sec",
            "language": "Hindi (हिन्दी)",
            "speakers_detected": 2,
            "processing_status": "Completed",
            "word_count": 88,
            "confidence_score": "97.8%",
            "medical_specialty": "General Medicine",
            "sample_rate": "44.1 kHz",
            "channels": "Mono"
        },
    },
    {
        "id": "rec_003",
        "file_name": "pediatric_checkup_en.m4a",
        "language": "English",
        "duration": "3:15",
        "date": "2026-10-22",
        "status": "Completed",
        "transcript": [
            {"speaker": "Doctor",  "timestamp": "00:00:02", "text": "Good afternoon Mrs. Patel, how is little Aarav doing today?"},
            {"speaker": "Patient", "timestamp": "00:00:08", "text": "Hi Doctor, Aarav has had a mild fever and runny nose since yesterday night. He is irritable and not feeding well."},
            {"speaker": "Doctor",  "timestamp": "00:00:18", "text": "Let me take a gentle look at his throat and listen to his chest. Has there been any vomiting or cough?"},
            {"speaker": "Patient", "timestamp": "00:00:26", "text": "No vomiting, just a dry cough occasionally when he is sleeping."},
            {"speaker": "Doctor",  "timestamp": "00:00:34", "text": "His lungs sound completely clear. It looks like an early upper viral infection. We will manage with pediatric paracetamol and saline drops."}
        ],
        "details": {
            "file_name": "pediatric_checkup_en.m4a",
            "audio_duration": "3 min 15 sec",
            "language": "English (IN)",
            "speakers_detected": 2,
            "processing_status": "Completed",
            "word_count": 96,
            "confidence_score": "99.1%",
            "medical_specialty": "Pediatrics",
            "sample_rate": "48.0 kHz",
            "channels": "Stereo"
        },
    },
    {
        "id": "rec_004",
        "file_name": "ortho_rehab_review.mp3",
        "language": "English",
        "duration": "1:48",
        "date": "2026-10-20",
        "status": "Completed",
        "transcript": [
            {"speaker": "Doctor", "timestamp": "00:00:03", "text": "Good morning, Mr. Verma. How is the right knee progressing two weeks post physiotherapy?"},
            {"speaker": "Patient", "timestamp": "00:00:11", "text": "Much improved Doctor! The morning stiffness has decreased, though descending stairs still gives a dull ache."},
            {"speaker": "Doctor", "timestamp": "00:00:21", "text": "That is encouraging progress. Continue with the quadriceps sets and avoid deep squats for another fortnight."}
        ],
        "details": {
            "file_name": "ortho_rehab_review.mp3",
            "audio_duration": "1 min 48 sec",
            "language": "English",
            "speakers_detected": 2,
            "processing_status": "Completed",
            "word_count": 52,
            "confidence_score": "98.2%",
            "medical_specialty": "Orthopedics",
            "sample_rate": "44.1 kHz",
            "channels": "Mono"
        }
    }
]

ALLOWED_EXTENSIONS = ["mp3", "wav", "m4a"]
MAX_FILE_SIZE_MB = 25
