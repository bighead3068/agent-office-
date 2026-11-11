# 代理人辦公室 · Agent Office v0.1

**SIMULATION ONLY for the demo floor.** 示範樓層沒有連接真實 Grok Bot。Real Grok Bot is **NOT** connected there.

另外有一個本機自報接收器。它的畫面固定寫著 **Bot自行回報・非平台原生**。那不是平台原生連線。父層 Bot 還沒用本機 Shell 送出事件之前，未知狀態不是「已經看見真實機器人」。

示範資料會一直顯示：**模擬資料・未連接真實 Agent**。

## 執行

需要 Node.js 20 以上。

```bash
npm install
npm run dev
```

開發伺服器開在 <http://127.0.0.1:43123>。

```bash
npm test
npm run typecheck
npm run build
```

`npm run build` 產出 `dist/`。本機預覽打包結果：

```bash
npx serve dist
```

或：

```bash
npm run preview
```

## 直接開啟單檔

不裝依賴時，下載倉庫根目錄的 [`standalone.html`](./standalone.html)，用瀏覽器直接打開。檔案內已含腳本與樣式，不連外網，也不會連到真實 Grok Bot。

在 GitHub 打開該檔後，可用 Download 或 Raw 存到本機再打開。

## 這間辦公室

示範模式有四位代理人，五個固定座位，第五席空著。點人，或用方向鍵、數字鍵 1–4，看手上的事、狀態與新鮮度。監督總覽是唯讀的。

可以播放模擬、切換情境，或送出工作、等待、受阻、失敗、恢復、完成、明確閒置、心跳、斷線、重新連線、資料過期。失敗和受阻、等待是不同狀態。失敗之後可以恢復，或接一件新工作。失敗不會變成閒置，也不會出現打盹。

人物外形跟著座位，不跟著姓名。示範人名只存在模擬資料裡。`standalone.html` 只有示範，不會讀自報。

## 本機自報（不是平台連線）

接收器是 Python 3.10 標準庫。預設綁 `127.0.0.1:8792`，可用參數改，但不要為此修改防火牆，也不要把它當成可以放到網際網路上的服務。瀏覽器只同源讀取，寫入權杖不會進前端。回應不送萬用字元憑證 CORS。

權杖在啟動時產生，chmod 600（Windows 用 icacls 只留給目前使用者），放在執行目錄之外：

- Windows：`%LOCALAPPDATA%\agent-office-self-report\token-auth.header`
- 其他系統：`~/.local/share/agent-office-self-report/token-auth.header`

不要把權杖印出來，也不要提交。允許的來源與代理人 id 只有 `5be5c071-b5bd-4ed5-ba91-5c474954d171`。呼叫端自己寫的 label 不是身分。夾具使用另一把權杖與另一個 partition，預設關閉。開始是工作中，同一個 job 的完成或失敗是不同的結束狀態。沒有回報或超過 TTL 是未知，不會補心跳，也不會推成閒置。

開發機器：

```bash
npm run build
python3 receiver/self_report_server.py --host 127.0.0.1 --port 8792 --static-dir dist
```

Windows 桌面請用壓縮檔 `packaging/agent-office-self-report-box.zip`，不要在那台機器上 clone 或改碼。說明在 `receiver/README-BOX.md`。

```powershell
cd $env:USERPROFILE\Desktop\agent-office-self-report
powershell -ExecutionPolicy Bypass -File .\Start-AgentOffice.ps1
```

8792 上已經在跑的單來源接收器不要關，也不要覆寫它的 runtime。四個受信任來源用另一個包，埠 `127.0.0.1:8793`，runtime `%LOCALAPPDATA%\agent-office-multi-report`。說明在 `receiver/README-MULTI.md`。每個 bot 只讀自己的 header，父層不要代送。

```powershell
cd $env:USERPROFILE\Desktop\agent-office-multi-report
powershell -ExecutionPolicy Bypass -File .\Start-MultiReport.ps1
```

舊的單來源 GET 確認：

```powershell
curl.exe -sS "http://127.0.0.1:8792/api/self-report"
Start-Process "http://127.0.0.1:8792/?view=real"
```

## Codex 子代理看板

開啟 [Codex 子代理看板](http://127.0.0.1:8794/?view=codex)。點選席位可查看最近的任務、事件時間線和已知耗時。時間線使用接收器提供的最近 20 筆自報事件。回報過期後，席位會分開顯示目前狀態和上次已知結果。接收器短暫離線時，看板會保留最後一次成功讀到的畫面並標註時間。

動態辦公室會在瀏覽器記住工位安排。新子代理回報開始時會自動入座，滿席時可接替已離席或已結束任務的代理；忙碌的代理保留工位。曾有回報但已逾時的代理會顯示「離席」，席位詳情仍保留最後的任務和時間。新鮮的完工回報可觸發短暫的摸魚彩蛋，時間軸照常顯示任務結果。點選貓主管可查看座位概況。啟用系統減少動態效果時，辦公室會保留靜態提示。

第一次複製專案後先執行 `npm ci`。Windows 可在專案根目錄的 PowerShell 7 執行以下指令。啟動器會準備前端、檢查本機接收器並開啟看板。

```powershell
.\scripts\Start-CodexOffice.ps1
```

加 `-NoBrowser` 可只啟動接收器。也可以用 `npm ci`、`npm run build` 和 `python receiver/self_report_server.py --roster codex --static-dir dist` 手動啟動，需要 Python 3.10 以上。Windows 的應用程式控制政策若阻擋 Rollup 原生模組，可用 `node scripts/build-local.mjs` 產生靜態檔，將 `--static-dir` 改為 `.agent-office-runtime/codex-dist`。

### 派工與自行回報

打開看板的「產生派工提示詞」，輸入任務與驗收條件，按「複製提示詞」後貼到 Codex。新子代理在 `office-live` 工作階段用自己的代理 ID 和任務 ID 回報，畫面會自動安排工位。

請子代理用同一個代理 ID 和 job ID 回報開始與結束。以下是一筆本機動態回報的範例。

```powershell
$python = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$reportArgs = @(
  'receiver/report_activity.py', '--session-id', 'office-live',
  '--agent-id', ('agent-' + [guid]::NewGuid().ToString('N')),
  '--job-id', ('job-' + [guid]::NewGuid().ToString('N')),
  '--runtime-dir', (Join-Path $env:LOCALAPPDATA 'agent-office-codex-report'),
  '--url', 'http://127.0.0.1:8794/api/codex-activity'
)
& $python @reportArgs --status started --task '檢查 Codex 看板'
# 執行指派的工作，再回報 completed 或 failed。
& $python @reportArgs --status completed
```

原有四個固定席位與 `receiver/report_task.py` 仍可透過「自行回報」讀取和使用。動態派工的結果會出現在「動態辦公室」。

### Codex Hook 活動

在此專案的 Codex 對話中，透過輸入框的 **Review hooks** 或 **Settings → Hooks** 審查並信任專案設定。Windows Hook 需要能執行 `pwsh.exe`。開啟看板的「動態辦公室」後，可以按 Codex 對話切換，查看每位子代理的工位與啟動、結束事件。Hook 的結束事件表示該次子代理活動停止；明確的完成或失敗結果由自行回報提供。設定與信任流程見 [OpenAI Hooks 文件](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks)。

Hook 只送本機接收器所需的事件種類、對話 ID、回合 ID、子代理 ID 和類型。動態辦公室和固定席位使用各自的寫入權杖，資料存於 `%LOCALAPPDATA%\agent-office-codex-report`。請勿公開此本機服務或權杖。
