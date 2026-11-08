# 四來源自報升級包（不要覆蓋 8792）

已經在跑的單來源接收器不要關，也不要改它的資料夾。

- 舊程式：`C:\Users\0\Desktop\agent-office-self-report\agent-office-self-report`
- 舊 runtime：`%LOCALAPPDATA%\agent-office-self-report`
- 舊埠：`127.0.0.1:8792`
- 父層已經驗證過的 job：`parent-live-ba74e476-6c68-4702-a87e-031dc68b29c6`

這個新包請解到另一個資料夾，例如：

`C:\Users\0\Desktop\agent-office-multi-report`

它只聽 `127.0.0.1:8793`，runtime 是 `%LOCALAPPDATA%\agent-office-multi-report`。不要 pip install，不要改防火牆。GET 沒有權杖，所以不要對網際網路開放。

證據類型是 `bot-self-report`，畫面寫 **Bot自行回報・非平台原生**。這不是平台原生連線。四個座位在第一次真實回報之前都是未知。沒有回報或超過 TTL 時，有效狀態是未知，最後已知的工作和完成結果還留在詳情。預設 TTL 是 300 秒，只是這次短作業的設定，不是官方保證。接收器不會自己寫心跳或閒置。

## 啟動

```powershell
cd $env:USERPROFILE\Desktop\agent-office-multi-report
powershell -ExecutionPolicy Bypass -File .\Start-MultiReport.ps1
```

Python：`C:\Users\0\AppData\Local\Programs\Python\Python310\python.exe`

每個受信任來源各有一個 header，啟動後才產生，不會印出來：

- `%LOCALAPPDATA%\agent-office-multi-report\headers\5be5c071-b5bd-4ed5-ba91-5c474954d171.header` 專案／產品助手（協調）
- `%LOCALAPPDATA%\agent-office-multi-report\headers\7a961a88-8d6c-4afe-ada6-e28542084d0c.header` Agent Office 開發助手
- `%LOCALAPPDATA%\agent-office-multi-report\headers\892250dc-215a-4817-b9ae-64e538a22fe3.header` Agent Office 互動設計
- `%LOCALAPPDATA%\agent-office-multi-report\headers\cf8d7f4a-569c-48f8-86e0-a2d8b543c4e1.header` Agent Office 測試與授權

不要 Get-Content 這些檔案。權杖只對得上自己的 id；拿別人的 header 不能改身分。

看畫面：

```powershell
Start-Process "http://127.0.0.1:8793/?view=real"
curl.exe -sS "http://127.0.0.1:8793/api/self-report"
```

GET 的 `agents` 有四筆。最外層的舊欄位只對應協調那個來源，方便舊客戶端。

## 每個 bot 自己回報

父層不要替他們送。當事人用自己的 Shell，在接收器已經啟動之後：

```powershell
$py = "C:\Users\0\AppData\Local\Programs\Python\Python310\python.exe"
$cli = "$env:USERPROFILE\Desktop\agent-office-multi-report\receiver\report_task.py"
$runtime = Join-Path $env:LOCALAPPDATA "agent-office-multi-report"
& $py $cli --agent-id "7a961a88-8d6c-4afe-ada6-e28542084d0c" --job-id "dev-task-1" --status started --task "整理四個座位的自報" --runtime-dir $runtime --url "http://127.0.0.1:8793/api/self-report"
```

做完那件工作之後，換新的時間點再送完成。`--task` 最多 160 字，給人看得懂的中文，不要只放 job id。

```powershell
& $py $cli --agent-id "7a961a88-8d6c-4afe-ada6-e28542084d0c" --job-id "dev-task-1" --status completed --task "整理四個座位的自報" --runtime-dir $runtime --url "http://127.0.0.1:8793/api/self-report"
```

失敗把 `completed` 改成 `failed`。同一個 job 不能又完成又失敗。若 PowerShell 把中文切壞，改把標題寫進 UTF-8 檔再用 `--task-file`：

```powershell
$utf8 = New-Object System.Text.UTF8Encoding $false
$title = Join-Path $env:TEMP "agent-office-task.txt"
[System.IO.File]::WriteAllText($title, "整理四個座位的自報", $utf8)
& $py $cli --agent-id "7a961a88-8d6c-4afe-ada6-e28542084d0c" --job-id "dev-task-1" --status started --task-file $title --runtime-dir $runtime --url "http://127.0.0.1:8793/api/self-report"
```

指令只會印 `report_status` 和 `result`，不會印 header。成功是 `result=ok`。
