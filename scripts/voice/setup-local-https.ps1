$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$toolRoot = Join-Path $repositoryRoot "tools\local"
$certificateRoot = Join-Path $repositoryRoot "certs\local"
$mkcert = Join-Path $toolRoot "mkcert.exe"

New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
New-Item -ItemType Directory -Force -Path $certificateRoot | Out-Null

if (-not (Test-Path -LiteralPath $mkcert)) {
  Write-Host "Downloading official mkcert v1.4.4 portable binary"
  & curl.exe `
    --fail `
    --location `
    --retry 5 `
    --output $mkcert `
    "https://dl.filippo.io/mkcert/v1.4.4?for=windows/amd64"
  if ($LASTEXITCODE -ne 0) {
    throw "mkcert download failed with curl exit code $LASTEXITCODE"
  }
}

$mkcertHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $mkcert).Hash.ToLowerInvariant()
Write-Host "mkcert SHA256: $mkcertHash"

Write-Host "Installing the local CA into the current user's trust store"
& $mkcert -install
if ($LASTEXITCODE -ne 0) {
  throw "mkcert -install failed with exit code $LASTEXITCODE"
}

$hostNames = [System.Collections.Generic.List[string]]::new()
$hostNames.Add("localhost")
$hostNames.Add("127.0.0.1")
$hostNames.Add("::1")
if ($env:COMPUTERNAME) {
  $hostNames.Add($env:COMPUTERNAME)
}

$addresses = [Net.Dns]::GetHostAddresses([Net.Dns]::GetHostName()) |
  Where-Object {
    $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and
    -not [Net.IPAddress]::IsLoopback($_)
  } |
  ForEach-Object { $_.IPAddressToString } |
  Sort-Object -Unique

foreach ($address in $addresses) {
  $hostNames.Add($address)
}

$certificatePath = Join-Path $certificateRoot "local-cert.pem"
$keyPath = Join-Path $certificateRoot "local-key.pem"
& $mkcert `
  -cert-file $certificatePath `
  -key-file $keyPath `
  $hostNames.ToArray()
if ($LASTEXITCODE -ne 0) {
  throw "Certificate generation failed with exit code $LASTEXITCODE"
}

$caRoot = (& $mkcert -CAROOT).Trim()
Write-Host "Certificate: $certificatePath"
Write-Host "Private key: $keyPath"
Write-Host "Local CA directory: $caRoot"
Write-Host "LAN addresses: $($addresses -join ', ')"
Write-Host "Install rootCA.pem from the local CA directory on each test phone and mark it trusted."
