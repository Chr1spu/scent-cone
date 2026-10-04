<#
  Stops the tunnel and the Scentline server started by start-server.ps1, and clears the
  published address so the website stops trying to reach it.

    powershell -ExecutionPolicy Bypass -File scripts\stop-server.ps1

  -KeepServer      leave the Docker server running (only close the tunnel)
  -KeepPublished   don't clear frontend/public/server.json
#>
param(
  [switch]$KeepServer,
  [switch]$KeepPublished
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$pidFile = Join-Path $root 'tools\cloudflared.pid'

if (Test-Path $pidFile) {
  $id = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($id) { Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue }
  Remove-Item $pidFile -Force
  Write-Host 'Tunnel closed.'
} else {
  Write-Host 'No tunnel was running.'
}

if (-not $KeepServer) {
  docker compose stop
  Write-Host 'Server stopped.'
}

if (-not $KeepPublished) {
  $json = Join-Path $root 'frontend\public\server.json'
  '{ "api": "" }' | Set-Content -Path $json -Encoding ascii
  git add -- frontend/public/server.json
  git commit -m 'Server offline' -- frontend/public/server.json | Out-Null
  git push --quiet
  Write-Host 'Website address cleared (the site falls back to the demo for new areas).'
}
