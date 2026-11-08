# 代理人辦公室 · Agent Office v0.1

**SIMULATION ONLY.** 真實 Grok Bot 沒有連接。Real Grok Bot is **NOT** connected.

畫面上的代理人、任務與連線都是示範資料。這份程式不會登入、不會派工，也不會連到真實的 Grok Bot。模擬用的像素辦公室會一直顯示：**模擬資料・未連接真實 Agent**。

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

「真實資料」分頁只顯示「真實資料・未連接」。那一頁沒有示範人名、沒有模擬按鈕，人數都是 0。未知會分開寫資料過期和連線中斷。

人物外形跟著座位，不跟著姓名。示範人名只存在模擬資料裡。
