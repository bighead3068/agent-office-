param(
  [string]$BindHost = "127.0.0.1",
  [int]$Port = 8792,
  [string]$Python = "C:\Users\0\AppData\Local\Programs\Python\Python310\python.exe"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path -LiteralPath $Python)) {
  throw "Python 3.10 was not found at $Python"
}
$Runtime = Join-Path $env:LOCALAPPDATA "agent-office-self-report"
$Static = Join-Path $Root "dist"
& $Python (Join-Path $Root "receiver\self_report_server.py") `
  --host $BindHost `
  --port $Port `
  --runtime-dir $Runtime `
  --static-dir $Static
