param(
    [switch]$PreloadDiarization
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv is required. Install it from https://docs.astral.sh/uv/getting-started/installation/"
}

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    uv venv --python 3.10 .venv
}

uv pip install --python ".venv\Scripts\python.exe" -r requirements.txt

$assets = Join-Path $Root "conformer_assets"
$required = @(
    "vocab.json",
    "language_masks.json",
    "encoder.onnx",
    "ctc_decoder.onnx",
    "rnnt_decoder.onnx",
    "joint_enc.onnx",
    "joint_pred.onnx",
    "joint_pre_net.onnx",
    "joint_post_net_hi.onnx"
)
$missing = $required | Where-Object { -not (Test-Path (Join-Path $assets $_)) }

if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "IndicConformer ONNX assets are missing from: $assets" -ForegroundColor Yellow
    Write-Host "Copy the ONNX runtime files from the indic-conformer repository into that folder:"
    Write-Host "  robocopy C:\indic-conformer-600m-multilingual\assets $assets /E /XF preprocessor.ts"
    Write-Host "Missing: $($missing -join ', ')"
} else {
    Write-Host ""
    Write-Host "IndicConformer ONNX assets are present." -ForegroundColor Green
}

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example. Add HF_TOKEN before using diarization." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Accept the pyannote model conditions at https://huggingface.co/pyannote/speaker-diarization-community-1"
Write-Host "  2. Put HF_TOKEN in .env"
Write-Host "  3. Run: .venv\Scripts\streamlit.exe run app.py"

if ($PreloadDiarization) {
    Write-Host ""
    Write-Host "Preloading the pyannote diarization pipeline..."
    & ".venv\Scripts\python.exe" -c "from diarization import get_diarizer; get_diarizer().preload(); print('pyannote pipeline ready')"
}
