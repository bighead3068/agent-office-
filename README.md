# 代理人辦公室 · Agent Office v0.2

預設畫面是**已登記的真實 bot**。進門三秒可以分出誰在工作、誰受阻、誰做完、誰未知。示範資料只在網址加上 `?view=demo` 時出現，而且不會寫進真實接收器。

這一版只有一個本機接收器，聽 `127.0.0.1:8795`。v0.1 的 `8792`、`8793`、`8794` **不再服務**，程式拒絕綁定這些埠，也不會自動改去別的埠。

## 狀態是什麼意思

| 畫面上的字 | 意思 |
| --- | --- |
| 工作中 | 這個 bot 回報了開始或進度。 |
| 等待中 | 明確回報正在等。 |
| 受阻 | 明確回報被卡住。 |
| 失敗 | 這件工作失敗。失敗不會被畫成受阻。 |
| 已完成 | 這件工作做完，旁邊會有完成時間。完成不會自己變成閒置。 |
| 未知 | 還沒回報，或回報已超過 TTL。未知不是閒置。 |
| 明確閒置 | 只有對方真的送出 `task.idle` 才會出現。心跳不能證明閒置。 |

過期時，有效狀態變成**未知**，座位上會標**過期**，上次已知的狀態和任務標題還留著。

**完成和失敗也會過期。** 規則是：`現在 - lastReportAt <= ttlMs` 仍算新鮮（剛好等於 TTL 也算新鮮）；再超過就是未知。預設 TTL 是 300 秒，所以到期前 1 秒仍是新鮮，到期後 1 秒是未知。

主管摘要的五格順序固定為：卡住、進行中、等待、完成、未知。卡住＝受阻＋失敗，泡泡仍分開寫「受阻」和「失敗」。下一列是閒置與離線。這七格加總等於人數。過期與未入座是重疊標記，不重複加進總數。需要注意只列受阻 > 失敗 > 等待，不含進行中，同一狀態再依座位編號，最多 4 列。右側摘要自己不捲動。三倍尺寸只在視窗至少 1400×900 時使用。

## 怎麼啟動

需要 Node.js 20 以上、Python 3.10 以上。接收器只綁 `127.0.0.1`，不需要系統管理員，也不會改防火牆。

```bash
npm ci
npm run office
```

啟動器會檢查 Python、Node、依賴和埠，建置頁面，等 `/health` 回覆，然後打開：

<http://127.0.0.1:8795/>

再執行一次不會開第二個行程。它只會告訴你已經在跑，並印出網址與 runtime 路徑。權杖不會印出來。

Windows 用解壓縮後那一層的 PowerShell：

```powershell
if (-not (Test-Path -LiteralPath .\receiver\self_report_server.py)) { throw "請在解壓縮後的第一層執行，不要再進一層資料夾。" }
powershell -ExecutionPolicy Bypass -File .\Start-AgentOffice.ps1
```

`Start-AgentOffice.ps1` 裡也有同樣的 `Test-Path`。壓縮檔的檔案就在 zip 根目錄，沒有再包一層 `agent-office/`。

這份說明在 Linux 上寫過並跑過 `npm run office` 的檢查流程。**沒有在真實 Windows 上執行過 `Start-AgentOffice.ps1`。** 腳本沒有向 Windows 要管理員權限，也沒有改系統設定；若你的電腦擋了 `Start-Process` 或 Python 不在 PATH，請依錯誤訊息安裝 Python 3.10 或設定 `PYTHON`。

## 怎麼加一個 bot

Runtime 在 git 外面：

- Windows：`%LOCALAPPDATA%\agent-office`
- 其他系統：`$XDG_DATA_HOME/agent-office`，沒設的話是 `~/.local/share/agent-office`

權杖只寫在 `headers/<agent-id>.header`，權限只給目前的使用者。註冊時只印這個檔案路徑和一條不含權杖的回報命令。

```bash
npm run office:register -- --agent-id bot-alpha --display-name "阿法"
```

或：

```bash
python3 receiver/register_agent.py --agent-id bot-alpha --display-name "阿法" --runtime-dir "$HOME/.local/share/agent-office"
```

同一個 agent id 再註冊會失敗，不會悄悄換掉身分。要換權杖才加 `--rotate`，而且顯示名稱必須和原來一樣。

接著用它印出的命令回報。`report_task.py` 仍接受原來的參數：`--agent-id --job-id --status --task --task-file --runtime-dir --url`，輸出仍是 `report_status` 和 `result`。

```bash
python3 receiver/report_task.py \
  --agent-id bot-alpha \
  --job-id job-1 \
  --status started \
  --task "整理文件" \
  --runtime-dir "$HOME/.local/share/agent-office" \
  --url http://127.0.0.1:8795/api/self-report
```

同一個 bot、同一件工作、同一個狀態再送一次會去重，不會改 `lastReportAt`。同一個 event id 但標題不同會被拒絕，不會覆寫。比較舊的時間、或舊工作的事件，也不會蓋掉較新的工作。

`started` 是工作中，`completed` 是做完，`failed` 是失敗。接收器暫時沒開時，命令結束碼是 3，`result=unreachable`。

Codex 活動走同一個埠的 `/api/codex-activity`。Hook 權杖在 `headers/codex-hook.header`。沒有先登記的 bot 不會自動搶座位。

## 讀取資料的授權

GET `/`、`/api/state`、`/api/self-report`、`/health` **沒有** bearer 權杖。這是刻意的：瀏覽器要能畫畫面，而權杖不該進前端。這只在接收器拒絕 `127.0.0.1` 以外的綁定時才成立。啟動時會印出這個警告。寫入一律要權杖，而且不看 `Origin`。回應不送跨網域 CORS。

`/health` 只含版本、服務名稱和 receiver id，沒有權杖。

## 示範

<http://127.0.0.1:8795/?view=demo>

這一頁有 DEMO 標示，用的是模擬人名，不會把事件 POST 到真實接收器。回到沒有 `view=demo` 的網址就只剩真實座位。

不裝接收器時，可以打開倉庫根目錄的 [`standalone.html`](./standalone.html)。它一樣預設是真實畫面（打不開接收器就顯示連線中斷），示範仍要加 `?view=demo`。

## 檢查

```bash
npm test
npm run typecheck
npm run build
python3 -m unittest discover -s receiver -t receiver
```

畫面素材與授權見 [ASSETS.md](./ASSETS.md)。
