$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localDir = Join-Path $projectRoot '.local'
$pidFile = Join-Path $localDir 'desk.pid'
$stopRequest = Join-Path $localDir 'stop-request'

function Stop-Leftovers {
  # Only match Node processes that loaded this project's Prisma engine.
  $enginePath = Join-Path $projectRoot 'node_modules\.prisma\client\query_engine-windows.dll.node'
  foreach ($candidate in @(Get-Process -Name node -ErrorAction SilentlyContinue)) {
    $matchesProject = $false
    try { $matchesProject = @($candidate.Modules | Where-Object { $_.FileName -eq $enginePath }).Count -gt 0 } catch {}
    if ($matchesProject) { Stop-Process -Id $candidate.Id -ErrorAction Stop; Wait-Process -Id $candidate.Id -Timeout 10 -ErrorAction SilentlyContinue }
  }
  $pgCtl = Join-Path $projectRoot 'node_modules\@embedded-postgres\windows-x64\native\bin\pg_ctl.exe'
  $dataDir = Join-Path $localDir 'postgres'
  if ((Test-Path -LiteralPath $pgCtl) -and (Test-Path -LiteralPath (Join-Path $dataDir 'postmaster.pid'))) {
    & $pgCtl -D $dataDir -m fast -w stop
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop local PostgreSQL. Check its output above.' }
  }
}

if (-not (Test-Path -LiteralPath $localDir)) {
  Write-Host 'The local desk data folder does not exist. The desk is not running.'
  exit 0
}

if (-not (Test-Path -LiteralPath $pidFile)) {
  Stop-Leftovers
  Write-Host 'No tracked desk instance. Any detected project leftovers have been stopped.'
  exit 0
}

$deskProcessId = 0
try { $deskProcessId = [int](Get-Content -LiteralPath $pidFile -Raw).Trim() } catch {}
if ($deskProcessId -le 0 -or -not (Get-Process -Id $deskProcessId -ErrorAction SilentlyContinue)) {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  Write-Host 'The desk process is not running.'
  Stop-Leftovers
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
