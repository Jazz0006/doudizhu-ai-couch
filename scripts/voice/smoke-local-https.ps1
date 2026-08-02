$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$certificateRoot = Join-Path $repositoryRoot "certs\local"
$mkcert = Join-Path $repositoryRoot "tools\local\mkcert.exe"

$certificatePath = Join-Path $certificateRoot "local-cert.pem"
$keyPath = Join-Path $certificateRoot "local-key.pem"
$caRoot = (& $mkcert -CAROOT).Trim()
$env:NODE_EXTRA_CA_CERTS = Join-Path $caRoot "rootCA.pem"

& node `
  (Join-Path $PSScriptRoot "smoke-secure-session.mjs") `
  $certificatePath `
  $keyPath
if ($LASTEXITCODE -ne 0) {
  throw "Secure session smoke test failed with exit code $LASTEXITCODE"
}
