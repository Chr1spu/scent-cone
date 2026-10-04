<#
  Starts the Scentline server on this computer and puts it online through a free Cloudflare
  quick tunnel (no account needed), then publishes the address to the website.

    powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1

  -Port        local port for the server (default 8010)
  -NoPublish   don't commit frontend/public/server.json (the site keeps its old address)

  The tunnel address changes every time it starts; publishing makes the website follow it
  (Vercel redeploys in about a minute). Stop everything with scripts\stop-server.ps1.
#>
param(
  [int]$Port = 8010,
  [switch]$NoPublish
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$tools = Join-Path $root 'tools'
New-Item -ItemType Directory -Force $tools | Out-Null

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }

# ---------------------------------------------------------------- 1. Docker
Step 'Docker'
function Test-Docker {
  try { docker info --format '{{.ServerVersion}}' 2>$null | Out-Null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}
if (-not (Test-Docker)) {
  $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path $dd)) { throw 'Docker Desktop is not installed.' }
  Write-Host 'Starting Docker Desktop...'
  Start-Process $dd
  $deadline = (Get-Date).AddMinutes(3)
  while (-not (Test-Docker)) {
    if ((Get-Date) -gt $deadline) { throw 'Docker did not start within 3 minutes.' }
    Start-Sleep -Seconds 3
  }
}
Write-Host 'Docker is running.'

# ---------------------------------------------------------------- 2. Server
Step "Server on http://localhost:$Port"
$env:BACKEND_PORT = "$Port"
docker compose up -d --build   # rebuilds only what changed (WindNinja layers stay cached)
if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed.' }
$deadline = (Get-Date).AddMinutes(2)
while ($true) {
  try {
    $h = Invoke-RestMethod "http://localhost:$Port/api/health" -TimeoutSec 5
    if ($h.ok) { break }
  } catch { }
  if ((Get-Date) -gt $deadline) { throw 'The server did not answer on /api/health.' }
  Start-Sleep -Seconds 2
}
Write-Host "Server is up (WindNinja: $($h.windninja))."

# ---------------------------------------------------------------- 3. Tunnel
Step 'Cloudflare tunnel'
$cf = Join-Path $tools 'cloudflared.exe'
if (-not (Test-Path $cf)) {
  Write-Host 'Downloading cloudflared (official Cloudflare release)...'
  $url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $url -OutFile $cf -UseBasicParsing
}
$pidFile = Join-Path $tools 'cloudflared.pid'
if (Test-Path $pidFile) {
  $old = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($old) { Stop-Process -Id ([int]$old) -Force -ErrorAction SilentlyContinue }
  Remove-Item $pidFile -Force
}
$log = Join-Path $tools 'cloudflared.log'
if (Test-Path $log) { Remove-Item $log -Force }
$proc = Start-Process -FilePath $cf -ArgumentList @('tunnel', '--no-autoupdate', '--url', "http://localhost:$Port") `
  -RedirectStandardError $log -RedirectStandardOutput (Join-Path $tools 'cloudflared.out') -WindowStyle Hidden -PassThru
$proc.Id | Set-Content $pidFile

$public = $null
$deadline = (Get-Date).AddMinutes(1)
while (-not $public) {
  if ((Get-Date) -gt $deadline) { throw "No tunnel address appeared. See $log" }
  Start-Sleep -Seconds 1
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -First 1
    if ($m) { $public = $m.Matches[0].Value }
  }
}
Write-Host "Tunnel address: $public"

# the new hostname takes a few seconds to resolve everywhere
$deadline = (Get-Date).AddSeconds(90)
$reachable = $false
while (-not $reachable -and (Get-Date) -lt $deadline) {
  try { $r = Invoke-RestMethod "$public/api/health" -TimeoutSec 10; $reachable = [bool]$r.ok } catch { Start-Sleep -Seconds 3 }
}
if ($reachable) { Write-Host 'Reachable from the internet.' -ForegroundColor Green }
else { Write-Warning 'The tunnel is up but not reachable yet; it usually works within a minute.' }

# ---------------------------------------------------------------- 4. Publish
if (-not $NoPublish) {
  Step 'Publishing the address to the website'
  $json = Join-Path $root 'frontend\public\server.json'
  "{ `"api`": `"$public`" }" | Set-Content -Path $json -Encoding ascii
  git add -- frontend/public/server.json
  git commit -m "Server address: $public" -- frontend/public/server.json | Out-Null
  git push --quiet
  Write-Host 'Pushed. The website switches to this server after Vercel redeploys (about a minute).'
}

Write-Host "`nScentline server is online at $public" -ForegroundColor Green
Write-Host 'Leave this computer on. Stop with: powershell -ExecutionPolicy Bypass -File scripts\stop-server.ps1'
