# One-click stage-2 acceptance run (Windows PowerShell 5.1+ / PowerShell 7).
# Usage (project root, MongoDB replica set already started with `npm.cmd run db:start`):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\acceptance.ps1
# Writes everything to .local\qa\acceptance-<timestamp>.log plus JSON reports.
# Development database: backup -> db:init (adds/updates validators and indexes only) -> read-only verify.
# All tests use the separate questionnaire_test database.

$ErrorActionPreference = "Stop"
# Handle native exit codes explicitly on both Windows PowerShell and PowerShell 7.
$PSNativeCommandUseErrorActionPreference = $false
$previousLocation = Get-Location
$previousColor = $env:FORCE_COLOR
$previousNoColor = $env:NO_COLOR
$previousReport = $env:PLAYWRIGHT_JSON_OUTPUT_NAME
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
try { chcp 65001 > $null } catch {}
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:FORCE_COLOR = "0"
$env:NO_COLOR = "1"

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$qa = Join-Path $root ".local\qa"
New-Item -ItemType Directory -Force $qa | Out-Null
$logPath = Join-Path $qa "acceptance-$ts.log"
$writer = New-Object System.IO.StreamWriter($logPath, $true, (New-Object System.Text.UTF8Encoding($false)))
$results = @()
$acceptanceFailed = $false

function Log([string]$line) {
  Write-Host $line
  $writer.WriteLine($line)
}

function Step([string]$name, [string]$command) {
  Log ""
  Log "===== [$name] $command ====="
  $start = Get-Date
  & cmd.exe /d /c "($command) 2>&1" | ForEach-Object { Log ("$_") }
  $code = $LASTEXITCODE
  $seconds = [int]((Get-Date) - $start).TotalSeconds
  Log "===== [$name] exit=$code (${seconds}s) ====="
  $writer.Flush()
  $script:results += [pscustomobject]@{ Step = $name; Exit = $code; Seconds = $seconds }
  if ($code -ne 0) {
    throw "Step '$name' failed (exit=$code); remaining steps were not run."
  }
}

try {
  Log "Stage 2 acceptance run $ts"
  Log "Project: $root"
  Step "env-node" "node -v && npm.cmd -v"
  Step "env-git" "git rev-parse --abbrev-ref HEAD && git rev-parse --short HEAD && git status --short"

  # Backup must succeed before validators/indexes in the development database change.
  Step "dev-backup" "npm.cmd run db:backup"
  Step "dev-init" "npm.cmd run db:init"
  Step "dev-verify" "npm.cmd run db:verify -- --baseline latest --out .local/qa/db-verify-dev-$ts.json"

  # Automated tests on questionnaire_test
  Step "unit-api" "npm.cmd test -- --reporter=default --reporter=json --outputFile.json=.local/qa/unit-api-$ts.json"
  Step "test-db-verify" "npm.cmd run db:verify -- --test --out .local/qa/db-verify-test-$ts.json"
  Step "build" "npm.cmd run build"
  Step "smoke" "npm.cmd run smoke"
  $env:PLAYWRIGHT_JSON_OUTPUT_NAME = ".local/qa/e2e-$ts.json"
  Step "e2e" "npm.cmd run test:e2e -- --reporter=list,json"
} catch {
  $script:acceptanceFailed = $true
  Log "STOP: $($_.Exception.Message)"
} finally {
  Log ""
  Log "===== SUMMARY ====="
  foreach ($r in $results) {
    $mark = if ($r.Exit -eq 0) { "PASS" } else { "FAIL" }
    Log ("{0}  {1,-16} exit={2}  {3}s" -f $mark, $r.Step, $r.Exit, $r.Seconds)
  }
  $failed = @($results | Where-Object { $_.Exit -ne 0 }).Count
  Log "Failed steps: $failed"
  Log "Log file: $logPath"
  $writer.Close()
  $env:FORCE_COLOR = $previousColor
  $env:NO_COLOR = $previousNoColor
  $env:PLAYWRIGHT_JSON_OUTPUT_NAME = $previousReport
  Set-Location $previousLocation
}
if ($acceptanceFailed -or $failed -gt 0) { exit 1 } else { exit 0 }
