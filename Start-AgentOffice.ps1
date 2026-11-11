# Agent Office v0.2 launcher. Run this file from the folder that contains it.
# It does not ask for administrator rights and does not change system settings.
param(
  [int]$Port = 8795,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
if (-not $PSScriptRoot) { throw "無法判斷腳本所在資料夾。" }
$Root = $PSScriptRoot
$Server = Join-Path $Root "receiver\self_report_server.py"
if (-not (Test-Path -LiteralPath $Server)) {
  throw "找不到 receiver\self_report_server.py。請在解壓縮後的第一層執行 Start-AgentOffice.ps1，不要再進入子資料夾。"
}
if ($Port -in 8792, 8793, 8794) {
  throw "埠 $Port 是 v0.1 舊埠，這個版本不再服務。請用 8795。"
}

function Find-Python {
  $candidates = @()
  if ($env:PYTHON) { $candidates += $env:PYTHON }
  $candidates += @("py", "python", "python3")
  $localPython = Join-Path $env:LOCALAPPDATA "Programs\Python"
  if (Test-Path -LiteralPath $localPython) {
    Get-ChildItem -LiteralPath $localPython -Directory -Filter "Python3*" | Sort-Object Name -Descending | ForEach-Object {
      $candidates += (Join-Path $_.FullName "python.exe")
    }
  }
  foreach ($name in $candidates) {
    $exists = $false
    if ($name -like "*\*" -or $name -like "*/*") {
      $exists = Test-Path -LiteralPath $name
    } else {
      $exists = [bool](Get-Command $name -ErrorAction SilentlyContinue)
    }
    if (-not $exists) { continue }
    & $name -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"
    if ($LASTEXITCODE -eq 0) { return $name }
  }
  throw "找不到 Python 3.10 以上。請安裝 Python，或設定 PYTHON 指向 python.exe。不會自動安裝。"
}

function Get-RuntimeMarker([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if (Test-Path -LiteralPath $full) {
    $full = (Resolve-Path -LiteralPath $full).Path
  }
  $bytes = [Text.Encoding]::UTF8.GetBytes($full)
  $hash = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
  return ([BitConverter]::ToString($hash) -replace "-", "").ToLower().Substring(0, 16)
}

function Show-ReceiverLog([string]$Runtime) {
  foreach ($name in @("receiver.err.log", "receiver.out.log")) {
    $file = Join-Path $Runtime $name
    if (Test-Path -LiteralPath $file) {
      Write-Host "---- $name ----"
      Get-Content -LiteralPath $file -Tail 20 | Write-Host
    }
  }
}

function Get-OfficeHealth {
  try {
    $client = [Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(1)
    $json = $client.GetStringAsync("http://127.0.0.1:$Port/health").GetAwaiter().GetResult()
    $client.Dispose()
    return $json | ConvertFrom-Json
  } catch {
    return $null
  }
}

$Python = Find-Python
$Runtime = if ($env:OFFICE_RUNTIME_DIR) { $env:OFFICE_RUNTIME_DIR } else { Join-Path $env:LOCALAPPDATA "agent-office" }
$Static = Join-Path $Root "dist"
$Health = Get-OfficeHealth
if ($Health -and $Health.ok -eq $true -and $Health.service -eq "agent-office") {
  $marker = Get-RuntimeMarker $Runtime
  Write-Host "already_running=yes"
  Write-Host "ui=http://127.0.0.1:$Port/"
  Write-Host "runtime_dir=$Runtime"
  Write-Host "runtime_marker=$marker"
  Write-Host "note=did not start a second process"
  Write-Host "token_not_printed=yes"
  if (-not $Health.runtimeMarker -or $Health.runtimeMarker -ne $marker) {
    throw "已在跑的接收器使用另一個 runtime。沒有啟動第二個行程。"
  }
  if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port/" }
  return
}
if ($Health) {
  throw "埠 $Port 已被其他程式占用。Agent Office 不會自動換埠。"
}

if (-not (Test-Path -LiteralPath (Join-Path $Static "index.html"))) {
  $Npm = Get-Command npm -ErrorAction SilentlyContinue
  if (-not $Npm) { throw "沒有 dist\index.html，也找不到 npm。請在有 Node.js 的機器先執行 npm ci 與 npm run build。" }
  $node = (node -p "process.versions.node")
  if ([int]($node.Split(".")[0]) -lt 20) { throw "需要 Node.js 20 以上。" }
  Push-Location $Root
  try { npm run build } finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath (Join-Path $Static "index.html"))) {
  throw "還是沒有 dist\index.html。"
}

New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
$errLog = Join-Path $Runtime "receiver.err.log"
$outLog = Join-Path $Runtime "receiver.out.log"
$arguments = @(
  "-u", $Server,
  "--host", "127.0.0.1",
  "--port", "$Port",
  "--runtime-dir", $Runtime,
  "--static-dir", $Static
)
$process = Start-Process -FilePath $Python -ArgumentList $arguments -WorkingDirectory $Root -RedirectStandardError $errLog -RedirectStandardOutput $outLog -PassThru -WindowStyle Hidden
$ready = $false
for ($i = 0; $i -lt 50; $i++) {
  Start-Sleep -Milliseconds 200
  if ($process.HasExited) {
    Show-ReceiverLog $Runtime
    throw "接收器啟動失敗，結束碼 $($process.ExitCode)。"
  }
  $seen = Get-OfficeHealth
  if ($seen -and $seen.ok -eq $true -and $seen.service -eq "agent-office") { $ready = $true; break }
}
if (-not $ready) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  Show-ReceiverLog $Runtime
  throw "接收器沒有在期限內通過 /health。"
}
Write-Host "already_running=no"
Write-Host "ui=http://127.0.0.1:$Port/"
Write-Host "runtime_dir=$Runtime"
Write-Host "runtime_marker=$(Get-RuntimeMarker $Runtime)"
Write-Host "token_not_printed=yes"
Write-Host "get_auth=loopback-only-no-token"
if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$Port/" }
