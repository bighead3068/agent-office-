# 舊路徑。真正的啟動器在倉庫根目錄，和 receiver 資料夾同一層。
$ErrorActionPreference = "Stop"
& (Join-Path (Split-Path -Parent $PSScriptRoot) "Start-AgentOffice.ps1") @args
