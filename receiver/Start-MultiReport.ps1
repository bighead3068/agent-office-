param(
  [string]$BindHost = "127.0.0.1",
  [int]$Port = 8793,
  [string]$Python = "C:\Users\0\AppData\Local\Programs\Python\Python310\python.exe"
)

$ErrorActionPreference = "Stop"
if ($Port -eq 8792) {
  throw "Port 8792 belongs to the existing receiver. Leave that process running and use 8793."
}
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path -LiteralPath $Python)) {
  throw "Python 3.10 was not found at $Python"
}
$Runtime = Join-Path $env:LOCALAPPDATA "agent-office-multi-report"
if ((Split-Path -Leaf $Runtime) -eq "agent-office-self-report") {
  throw "Refusing the existing runtime directory."
}
$Static = Join-Path $Root "dist"
& $Python (Join-Path $Root "receiver\self_report_server.py") `
  --host $BindHost `
  --port $Port `
  --runtime-dir $Runtime `
  --static-dir $Static `
  --ttl-ms 300000
