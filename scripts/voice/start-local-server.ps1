$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$env:HOST = "0.0.0.0"
$env:PORT = "3000"
$env:TLS_CERT_PATH = Join-Path $repositoryRoot "certs\local\local-cert.pem"
$env:TLS_KEY_PATH = Join-Path $repositoryRoot "certs\local\local-key.pem"

& node (Join-Path $repositoryRoot "apps\server\dist\cli.js")
if ($LASTEXITCODE -ne 0) {
  throw "Local HTTPS server stopped with exit code $LASTEXITCODE"
}
