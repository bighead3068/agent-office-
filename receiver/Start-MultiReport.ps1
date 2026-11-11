# v0.1 的 8793 啟動器已停用。改走根目錄的單一接收器。
$ErrorActionPreference = "Stop"
Write-Host "8793 不再服務。改啟動 Start-AgentOffice.ps1（127.0.0.1:8795）。"
& (Join-Path (Split-Path -Parent $PSScriptRoot) "Start-AgentOffice.ps1") @args
