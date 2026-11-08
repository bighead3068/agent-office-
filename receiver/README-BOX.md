# Agent Office 自報接收器（Windows 本機）

這是給 **DESKTOP 本機** 用的預先編譯包。不要 clone，也不要在這台機器上改原始碼。不要 `pip install`。不要改防火牆。

**示範樓層仍是模擬。** 真實分頁的固定文字是 **Bot自行回報・非平台原生**。它不是平台原生連線。在父層 Bot 用本機 Shell 送出回報之前，畫面上的未知 **不是** 已經看見真實機器人。

預設只聽 `127.0.0.1`。GET 沒有權杖，所以不要改成對網際網路開放。寫入權杖在啟動時產生，放在使用者目錄，不在這個壓縮檔裡，畫面上也不會出現。

## 啟動

解壓到桌面後，在 PowerShell：

```powershell
cd $env:USERPROFILE\Desktop\agent-office-self-report
powershell -ExecutionPolicy Bypass -File .\Start-AgentOffice.ps1
```

預設 Python：

`C:\Users\0\AppData\Local\Programs\Python\Python310\python.exe`

權杖檔（不要用 Get-Content 印出來）：

`%LOCALAPPDATA%\agent-office-self-report\token-auth.header`

視窗要保持開著。另開一個 PowerShell 做下面的 POST。重開接收器會換一把新權杖，狀態檔還在。

要改位址或埠才自己加參數，例如 `-BindHost 127.0.0.1 -Port 8792`。不要為了這個去開防火牆。

## 父層 Bot 的回報

同一個 `jobId` 先 `task.started`，做完再 `task.completed`。失敗則改送 `task.failed`，而且只能在還沒完成時送。不要把對話內容放進 JSON。`label` 即使寫了人名，也不會變成身分。身分是權杖綁定的這個 id：

`5be5c071-b5bd-4ed5-ba91-5c474954d171`

```powershell
$runtime = Join-Path $env:LOCALAPPDATA "agent-office-self-report"
$header = Join-Path $runtime "token-auth.header"
$utf8 = New-Object System.Text.UTF8Encoding $false
$start = Join-Path $env:TEMP "agent-office-start.json"
$done = Join-Path $env:TEMP "agent-office-complete.json"
$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
[System.IO.File]::WriteAllText($start, (@{
  eventId = "parent-start-1"
  type = "task.started"
  jobId = "parent-job-1"
  at = $now
  sourceId = "5be5c071-b5bd-4ed5-ba91-5c474954d171"
  agentId = "5be5c071-b5bd-4ed5-ba91-5c474954d171"
} | ConvertTo-Json -Compress), $utf8)
curl.exe -sS -X POST "http://127.0.0.1:8792/api/self-report" -H "@$header" -H "Content-Type: application/json" --data-binary "@$start"
curl.exe -sS "http://127.0.0.1:8792/api/self-report"
```

做一件很小的本機工作之後，用較新的 `at` 與新的 `eventId` 送完成：

```powershell
$later = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
[System.IO.File]::WriteAllText($done, (@{
  eventId = "parent-complete-1"
  type = "task.completed"
  jobId = "parent-job-1"
  at = $later
  sourceId = "5be5c071-b5bd-4ed5-ba91-5c474954d171"
  agentId = "5be5c071-b5bd-4ed5-ba91-5c474954d171"
} | ConvertTo-Json -Compress), $utf8)
curl.exe -sS -X POST "http://127.0.0.1:8792/api/self-report" -H "@$header" -H "Content-Type: application/json" --data-binary "@$done"
curl.exe -sS "http://127.0.0.1:8792/api/self-report"
Start-Process "http://127.0.0.1:8792/?view=real"
```

GET 裡 `partition` 應為 `real`，`effectiveStatus` 在完成後為 `completed`。`provenance.agentId` 必須是上面的 id。這才是父層回報的後端證據。雲端 VM 上的夾具畫面不是這個證據。

失敗改為 `"type":"task.failed"` 與另一個 `eventId`，而且不要和 `task.completed` 用在同一個已經結束的 job。
