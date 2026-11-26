$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localDir = Join-Path $projectRoot '.local'
$pidFile = Join-Path $localDir 'desk.pid'
$stopRequest = Join-Path $localDir 'stop-request'

if (-not (Test-Path -LiteralPath $localDir)) {
  Write-Host 'The local desk data folder does not exist. The desk is not running.'
  exit 0
}

if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Host 'This running desk was started before Stop Desk support was added.'
  Write-Host 'In its Start Desk terminal, press Ctrl+C once and wait for PostgreSQL to stop.'
  Write-Host 'Then start it again; future runs can be closed with Stop Desk.cmd.'
  exit 1
}

$deskProcessId = 0
try { $deskProcessId = [int](Get-Content -LiteralPath $pidFile -Raw).Trim() } catch {}
if ($deskProcessId -le 0 -or -not (Get-Process -Id $deskProcessId -ErrorAction SilentlyContinue)) {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host 'The desk process is not running.'
  $pgCtl = Join-Path $projectRoot 'node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe'
  $dataDir = Join-Path $localDir 'postgres'
  if ((Test-Path -LiteralPath $pgCtl) -and (Test-Path -LiteralPath (Join-Path $dataDir 'postmaster.pid'))) {
    & $pgCtl -D $dataDir -m fast -w stop
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host 'Stopped the leftover local PostgreSQL server.'
  }
  exit 0
}

[System.IO.File]::WriteAllText($stopRequest, 'stop')
Write-Host 'Stopping the messaging desk and its local PostgreSQL server...'
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  if (-not (Get-Process -Id $deskProcessId -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 500
}

if (Get-Process -Id $deskProcessId -ErrorAction SilentlyContinue) {
  Write-Error 'The desk did not stop within 30 seconds. Leave the data folder untouched and press Ctrl+C in the Start Desk terminal.'
  exit 1
}

Write-Host 'The messaging desk and PostgreSQL have stopped.'
