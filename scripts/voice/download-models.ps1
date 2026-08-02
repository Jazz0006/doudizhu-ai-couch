param(
  [ValidateSet("vad", "asr", "tts", "melo", "all")]
  [string]$Model = "all"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$voiceRoot = Join-Path $repositoryRoot "models\voice"
$downloadRoot = Join-Path $voiceRoot ".downloads"

New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null

function Download-File {
  param([string]$Url, [string]$Destination)

  if (Test-Path -LiteralPath $Destination) {
    Write-Host "Resuming or validating cached download: $Destination"
  } else {
    Write-Host "Downloading $Url"
  }

  & curl.exe --fail --location --retry 5 --retry-delay 2 --continue-at - --output $Destination $Url
  if ($LASTEXITCODE -ne 0) {
    throw "Download failed with curl exit code $LASTEXITCODE"
  }

  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Destination).Hash.ToLowerInvariant()
  Write-Host "SHA256 $hash  $Destination"
}

function Download-Vad {
  $targetDirectory = Join-Path $voiceRoot "vad"
  $targetFile = Join-Path $targetDirectory "silero_vad.onnx"
  New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
  Download-File `
    -Url "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx" `
    -Destination $targetFile
}

function Download-ArchiveModel {
  param(
    [string]$Url,
    [string]$ArchiveName,
    [string]$Category,
    [string]$ExtractedDirectory
  )

  $categoryRoot = Join-Path $voiceRoot $Category
  $targetDirectory = Join-Path $categoryRoot $ExtractedDirectory
  if (Test-Path -LiteralPath $targetDirectory) {
    Write-Host "Model already extracted: $targetDirectory"
    return
  }

  New-Item -ItemType Directory -Force -Path $categoryRoot | Out-Null
  $archivePath = Join-Path $downloadRoot $ArchiveName
  Download-File -Url $Url -Destination $archivePath
  Write-Host "Extracting $archivePath"
  tar -xf $archivePath -C $categoryRoot

  if (-not (Test-Path -LiteralPath $targetDirectory)) {
    throw "Archive did not create expected directory: $targetDirectory"
  }
}

if ($Model -eq "vad" -or $Model -eq "all") {
  Download-Vad
}

if ($Model -eq "asr" -or $Model -eq "all") {
  Download-ArchiveModel `
    -Url "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2" `
    -ArchiveName "sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2" `
    -Category "asr" `
    -ExtractedDirectory "sherpa-onnx-streaming-paraformer-bilingual-zh-en"
}

if ($Model -eq "tts" -or $Model -eq "all") {
  Download-ArchiveModel `
    -Url "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2" `
    -ArchiveName "kokoro-multi-lang-v1_1.tar.bz2" `
    -Category "tts" `
    -ExtractedDirectory "kokoro-multi-lang-v1_1"
}

if ($Model -eq "melo") {
  Download-ArchiveModel `
    -Url "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2" `
    -ArchiveName "vits-melo-tts-zh_en.tar.bz2" `
    -Category "tts" `
    -ExtractedDirectory "vits-melo-tts-zh_en"
}
