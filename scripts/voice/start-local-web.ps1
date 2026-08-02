param(
  [ValidateRange(1, 65535)]
  [int]$Port = 5173,

  [string]$ListenAddress = "0.0.0.0"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$certificatePath = Join-Path $repositoryRoot "certs\local\local-cert.pem"
$keyPath = Join-Path $repositoryRoot "certs\local\local-key.pem"
$mkcert = Join-Path $repositoryRoot "tools\local\mkcert.exe"

if ((Test-Path $certificatePath) -and (Test-Path $keyPath)) {
  if (-not (Test-Path $mkcert)) {
    throw "Local HTTPS certificates exist, but tools/local/mkcert.exe is missing"
  }

  $caRoot = (& $mkcert -CAROOT).Trim()
  $caCertificate = Join-Path $caRoot "rootCA.pem"
  if (-not (Test-Path $caCertificate)) {
    throw "mkcert root CA was not found at $caCertificate"
  }
  $env:NODE_EXTRA_CA_CERTS = $caCertificate
}

& npm.cmd run dev --workspace "@ai-doudizhu/web" -- `
  --host $ListenAddress `
  --port $Port `
  --strictPort
if ($LASTEXITCODE -ne 0) {
  throw "Local HTTPS web server stopped with exit code $LASTEXITCODE"
}
