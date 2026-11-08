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

四位代理人，五個固定座位，第五席空著。點人，或用方向鍵、數字鍵 1–4，看手上的事、狀態與新鮮度。監督總覽只讀人數，沒有派工。

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

父層 Bot 的 POST 必須讀權杖檔，不要把密文寫進指令本身。完整命令見 `receiver/README-BOX.md`。GET 確認：

```powershell
curl.exe -sS "http://127.0.0.1:8792/api/self-report"
Start-Process "http://127.0.0.1:8792/?view=real"
```
