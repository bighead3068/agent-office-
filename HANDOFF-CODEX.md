# Agent Office 交接說明（給 Codex）

更新時間：2026-11-11 20:10（台北時間）
分支：`cursor/agent-office-v02-5cf9`（PR #2，尚未合併，**未經 Linnn 明確同意不得合併**）
最新 commit：`1dd51c1`

## 專案是什麼
- 2D 像素辦公室，用來呈現多個 AI bot 的工作狀態。
- 每個 bot 有固定座位，狀態只來自 bot 自己的回報（self-report），不是平台原生監控。
- 主管視角是唯讀摘要；閒置彩蛋只在 bot 明確回報閒置時播放。
- 技術：前端 React + TypeScript + Vite，測試用 vitest；接收器是 Python 標準函式庫 + SQLite。

## 目錄重點
- `receiver/self_report_server.py`：接收器（HTTP、權杖驗證、SQLite、權限收緊 `restrict()`）。
- `receiver/register_agent.py`、`receiver/report_task.py`：bot 登記與回報工具。
- `receiver/test_self_report.py`：Python 測試（目前 29 項全過）。
- `Start-AgentOffice.ps1`：Windows 啟動器（必須維持 UTF-8 **含 BOM**，PowerShell 5.1 才能解析）。
- `packaging/agent-office-v0.2.zip`：Windows 打包檔。
- `src/`：前端；`?view=demo` 是示範模式，可切換三種討論過場方案。

## 本機執行（Windows，DESKTOP-P0CE320）
- Python：`C:\Users\USER\AppData\Local\Programs\Python\Python312\python.exe`
- 目前版本解壓在：`C:\Users\USER\AgentOffice\v02-1dd51c1`
- 執行資料夾：`%LOCALAPPDATA%\agent-office`（headers、office.sqlite3、register.key、記錄檔）
- 手動啟動（目前就是這樣跑的）：
  ```
  python receiver\self_report_server.py --port 8795 --runtime-dir "%LOCALAPPDATA%\agent-office" --static-dir dist
  ```
- 畫面：`http://127.0.0.1:8795/`（真實）與 `http://127.0.0.1:8795/?view=demo`（示範）
- 已登記座位：0 專案協調、1 開發助手、2 互動設計、3 測試與授權、4 像素美術、5 動畫開發。

## 回報協定
- `report_task.py --agent-id <id> --job-id <job> --status started|completed|failed --task "<說明>" --runtime-dir <dir> --url http://127.0.0.1:8795/api/self-report`
- 討論事件：`discuss-start` / `discuss-join` / `discuss-end`（對應 `discussion.started/joined/ended`）。
- 狀態超過 300 秒沒更新會變「未知」。
- 討論過場：方案 1 走到對方座位（預設）、方案 2 到休息區開會（多人會議）、方案 3 原地起身加虛線（備援）。「討論中」是「工作中」的子標籤。

## 目前待修（優先順序）
1. **啟動器健康檢查誤判逾時**（最優先）
   - 現象：`Start-AgentOffice.ps1` 啟動後，接收器其實已經在服務 `/api/state` 和 `/health`（直接 `Invoke-WebRequest http://127.0.0.1:8795/health` 回 200），但啟動器在約 175 行丟出「接收器沒有在期限內通過 /health。」，接著接收器就不在了。
   - 要查：健康檢查的 URL、逾時長度、是否受系統 Proxy 影響（PS 5.1 的 Invoke-WebRequest 會走系統 Proxy，建議 `-Proxy` 繞過或改用 `[Net.WebRequest]` 並設 `Proxy=$null`）、失敗時是否把接收器關掉。
   - 完成標準：在 PowerShell 5.1 連續執行兩次啟動器都成功、`/health` 200、瀏覽器自動開啟；補測試；`.ps1` 保持 BOM。
2. **記錄檔空 DACL**：已在 `1dd51c1` 修正（目錄改給 `(OI)(CI)(F)` 且先授權再移除繼承；啟動器讀記錄檔改用 FileShare.ReadWrite、失敗只警告）。實機已確認啟動器能讀到記錄檔。
3. 互動設計 bot 對 e5d44ba 的實測驗收結果尚未回來，回來後可能有 UI 修正。
4. 像素美術：風格 B「溫馨高細節」（32px tile、角色 32×48、顯示 x2），第一階段灰模預覽待 Linnn 確認；工作目錄 `C:\Users\USER\AgentOffice\art\`。

## 規則（務必遵守）
- 不得印出或外洩任何權杖、`headers/*.header`、`register.key` 內容。
- 每個 bot 只能用自己的身分回報，不可代替別人回報。
- 不改防火牆、不公開部署、不用付費主機、不改 repo 可見性。
- Repo 是公開的，推送前要掃描有無機密字串。
- 不合併 PR、不做破壞性 git 操作（force push、reset --hard 等），除非 Linnn 明確同意。
- 改 `.ps1` 一定保留 UTF-8 BOM。

## Codex 用法
- 執行檔：`%LOCALAPPDATA%\OpenAI\Codex\bin\5449c1f0f26f1f98\codex.exe`（不在 PATH）
- 難的任務：`-m gpt-6.1-sol -c model_reasoning_effort=medium`；簡單的：`-m gpt-6.1-terra -c model_reasoning_effort=medium`
- PowerShell 5.1 傳長提示容易被引號切斷，建議把提示寫成檔案再用 stdin 傳入：`Get-Content prompt.txt -Raw | codex exec --skip-git-repo-check ... -`
- 這台電腦目前沒有安裝 git；要直接推送需先安裝 git 並登入 GitHub。
