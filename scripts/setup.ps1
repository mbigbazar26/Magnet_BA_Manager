$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
node scripts/init.mjs --init
if ($LASTEXITCODE -ne 0) {throw 'Unable to initialize configuration.'}
$lines = [IO.File]::ReadAllLines((Join-Path (Get-Location) '.env'))
foreach ($key in @('META_ACCESS_TOKEN','META_APP_SECRET')) {
 $inputSecret = Read-Host "$key (press Enter to keep existing value)" -AsSecureString
 if ($inputSecret.Length -gt 0) {
   $value = [Net.NetworkCredential]::new('', $inputSecret).Password
   if ($value -notmatch '^[A-Za-z0-9._|-]+$') {throw "Unexpected character in $key"}
   for ($i=0; $i -lt $lines.Length; $i++) {
     if ($lines[$i].StartsWith("$key=")) {$lines[$i]="$key=$value"}
   }
 }
}
[IO.File]::WriteAllLines((Join-Path (Get-Location) '.env'),$lines,[Text.UTF8Encoding]::new($false))
Write-Host 'Saved. Restart the desk to apply your settings.'
