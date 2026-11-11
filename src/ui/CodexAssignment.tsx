import { useRef, useState } from "react";
import { CODEX_ACTIVITY_URL } from "../adapters/codexActivity";

export function CodexAssignment() {
  const [task, setTask] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [notice, setNotice] = useState("");
  const output = useRef<HTMLTextAreaElement>(null);
  const prompt = task.trim() && acceptance.trim() ? [
    "請在 Codex 新啟動一位子代理執行以下任務，讓它在 Agent Office 動態辦公室自動入座。",
    `任務\n${task.trim()}`,
    `驗收條件\n${acceptance.trim()}`,
    "派工時為新子代理產生唯一 agent ID（例如 agent- 加 UUID）和唯一 job ID，並把兩者交給它。請子代理用專案的 receiver/report_activity.py 回報。使用 --session-id office-live、--agent-id 和 --job-id，開始時用 --status started 加上 --task 任務名稱，結束時依結果用 --status completed 或 --status failed。全程沿用相同 ID，最後附上驗證結果。",
    `回報使用 --url ${typeof window === "undefined" ? "http://127.0.0.1:8794" : window.location.origin}${CODEX_ACTIVITY_URL}，並把 --runtime-dir 指向 Codex 接收器的資料目錄（預設為 %LOCALAPPDATA%\\agent-office-codex-report）。`,
  ].join("\n\n") : "";

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setNotice("已複製提示詞");
    } catch {
      output.current?.focus();
      output.current?.select();
      setNotice("已選取提示詞，可用 Ctrl+C 或複製選單手動複製。");
    }
  }

  return (
    <details className="assignment-panel">
      <summary>產生派工提示詞</summary>
      <div className="panel assignment-popover">
      <p className="hint">填妥後，複製提示詞到 Codex。新子代理回報時會自動入座。</p>
      <div className="assignment-fields" onChange={() => setNotice("")}>
        <label>任務<textarea rows={2} value={task} onChange={(event) => setTask(event.target.value)} /></label>
        <label>驗收條件<textarea rows={2} value={acceptance} onChange={(event) => setAcceptance(event.target.value)} /></label>
        <label>可複製的提示詞<textarea ref={output} rows={5} value={prompt} readOnly placeholder="填寫任務與驗收條件後會顯示提示詞" /></label>
      </div>
      <div className="assignment-actions">
        <button type="button" className="play-btn" disabled={!prompt} onClick={() => void copyPrompt()}>複製提示詞</button>
        <span role="status">{notice}</span>
      </div>
      </div>
    </details>
  );
}
