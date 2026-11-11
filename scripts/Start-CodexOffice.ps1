# v0.1 的 8794 Codex 啟動器已併入單一接收器。
$ErrorActionPreference = "Stop"
Write-Host "Codex 活動已併入 127.0.0.1:8795。改啟動 Start-AgentOffice.ps1。"
& (Join-Path (Split-Path -Parent $PSScriptRoot) "Start-AgentOffice.ps1") @args
