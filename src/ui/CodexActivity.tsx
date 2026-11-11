import { useState } from "react";
import { CODEX_ACTIVITY_EVIDENCE, type CodexActivityAgent, type projectCodexActivity } from "../adapters/codexActivity";
import { OfficeScene, SEAT_IDS, type OfficeAgent, type OfficeSceneConfig } from "../office";
import { CompletionWall } from "./CompletionWall";
import { ReportTime } from "./reportConnection";

const LIVE_SESSION_ID = "office-live";
const ACTIVITY_STALE_MS = 300_000;
const labels = { working: "已啟動", completed: "已完成", failed: "失敗", unknown: "未知" } as const;
const eventLabels = { started: "啟動", stopped: "結束", completed: "已完成", failed: "失敗" } as const;

function seatFromActivity(agent: CodexActivityAgent, now: number): OfficeAgent {
  const hookEnded = agent.stoppedAt != null && !agent.outcome;
  const stale = !hookEnded && now - agent.lastEventAt > ACTIVITY_STALE_MS;
  return {
    id: agent.agentId,
    name: agent.agentId,
    role: agent.agentType,
    status: stale || hookEnded ? "unknown" : agent.outcome ?? "working",
    freshness: stale ? "stale" : "fresh",
    connected: true,
    ...(stale || hookEnded ? { deskPresence: "away" } : {}),
    ...(agent.taskTitle ? { task: { title: agent.taskTitle } } : {}),
    lastUpdatedAt: new Date(agent.lastEventAt).toISOString(),
  };
}

function activityLabel(agent: CodexActivityAgent, seat: OfficeAgent) {
  if (seat.freshness === "stale") return "離席";
  if (agent.outcome) return labels[agent.outcome];
  return agent.stoppedAt == null ? labels.working : "已結束";
}

type Sessions = ReturnType<typeof projectCodexActivity>;

export function CodexActivity({ sessions, reducedMotion, config }: { sessions: Sessions; reducedMotion: boolean; config: OfficeSceneConfig }) {
  const [sessionId, setSessionId] = useState("");
  const [agentId, setAgentId] = useState("");
  const sortedSessions = sessions?.slice().sort((left, right) => left.sessionId.localeCompare(right.sessionId)) ?? [];
  const session = sortedSessions.find((item) => item.sessionId === sessionId)
    ?? sortedSessions.find((item) => item.sessionId === LIVE_SESSION_ID) ?? sortedSessions[0];
  const shownSessionId = session?.sessionId ?? LIVE_SESSION_ID;
  const now = Date.now();
  const rows = (session?.agents ?? []).map((agent) => ({ agent, seat: seatFromActivity(agent, now) }));
  const agents = rows.map(({ seat }) => seat);
  const latest = rows.slice().sort((left, right) =>
    Number(right.seat.status === "working") - Number(left.seat.status === "working") || right.agent.lastEventAt - left.agent.lastEventAt,
  )[0];
  const selected = rows.find(({ agent }) => agent.agentId === agentId) ?? latest;
  const events = session?.recent ?? [];
  const timeline = events.filter((event) => event.agentId === selected?.agent.agentId)
    .map(({ eventId, kind, at }) => ({ key: `event:${eventId}`, kind, at }));
  if (selected) {
    const { startedAt, stoppedAt, outcome } = selected.agent;
    const snapshots = [["started", startedAt], [outcome ?? "stopped", stoppedAt]] as const;
    for (const [kind, at] of snapshots) {
      if (at != null && !timeline.some((event) => event.kind === kind && event.at === at)) {
        timeline.push({ key: `snapshot:${kind}`, kind, at });
      }
    }
  }
  timeline.sort((left, right) => left.at - right.at);
  const completions = events.filter((event) => event.kind === "completed").map((event) => ({
    key: `${event.agentId}:${event.jobId ?? event.eventId}`,
    title: event.taskTitle ?? rows.find(({ agent }) => agent.agentId === event.agentId)?.agent.taskTitle ?? event.jobId ?? event.agentId,
    person: event.agentId,
    at: event.at,
  }));
  for (const { agent } of rows) {
    if (agent.outcome !== "completed" || agent.stoppedAt == null || completions.some((entry) => entry.person === agent.agentId && entry.at === agent.stoppedAt)) continue;
    completions.push({ key: `${agent.agentId}:snapshot`, title: agent.taskTitle ?? agent.agentId, person: agent.agentId, at: agent.stoppedAt });
  }

  return (
    <div className="shell">
      <section className="office-floor-card">
        <div className="floor-heading">
          <h2>辦公室平面圖</h2>
          {session ? <label className="activity-session">Codex 工作階段
          <select value={shownSessionId} onChange={(event) => {
            setSessionId(event.target.value);
            setAgentId("");
          }}>
            {sortedSessions.map((item) => <option key={item.sessionId} value={item.sessionId}>{item.sessionId}</option>)}
          </select>
          </label> : null}
        </div>
        <div className="floor-slot">
          <OfficeScene
            key={session ? shownSessionId : undefined}
            className="floor"
            agents={agents}
            statusLabels={labels}
            selectedId={selected?.agent.agentId}
            onSelect={setAgentId}
            config={config}
            reducedMotion={reducedMotion}
            playful
            rotateSeats
            seatStorageKey={session ? `agent-office:seats:codex:hook:${shownSessionId}` : undefined}
          />
        </div>
        <p className="caption">{session ? `工作階段內共 ${agents.length} 位子代理。新回報的子代理會自動入座。` : "尚無子代理入座。收到啟動回報後會自動安排座位。"}</p>
        <CompletionWall completions={completions} />
        {agents.length > SEAT_IDS.length ? (
          <section className="panel activity-list" aria-label="工作階段子代理清單">
            <h2>所有子代理</h2>
            <ul aria-label="此工作階段的子代理">
              {rows.map(({ agent, seat }) => (
                <li key={agent.agentId}>
                  <button type="button" className="text-btn" aria-pressed={agent.agentId === selected?.agent.agentId} onClick={() => setAgentId(agent.agentId)}>
                    {agent.agentId}・{activityLabel(agent, seat)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>
      <aside className="side">
        {selected ? (
          <section className="panel seat-inspector" aria-label="席位詳情" data-testid="detail-panel">
            <div className="inspector-heading">
              <h2>席位詳情</h2>
              <p className="detail-status inspector-status" data-status={selected.seat.status} data-testid="detail-status">{activityLabel(selected.agent, selected.seat)}</p>
            </div>
            <p className="inspector-agent">{selected.agent.agentId}</p>
            <div className="inspector-task">
              <p className="inspector-label">任務</p>
              <p className="inspector-title">{selected.agent.taskTitle ?? "尚無任務名稱"}</p>
              {selected.agent.outcome ? <dl className="inspector-result"><dt>任務結果</dt><dd>{labels[selected.agent.outcome]}</dd></dl> : null}
              {selected.seat.freshness === "stale" ? <p className="hint">回報逾時</p> : null}
            </div>
            <details className="inspector-meta">
              <summary>來源與回報資訊</summary>
              <dl className="facts">
              <dt>類型</dt><dd>{selected.agent.agentType}</dd>
              <dt>回合</dt><dd>{selected.agent.turnId ?? "未提供"}</dd>
              <dt>啟動時間</dt><dd>{selected.agent.startedAt == null ? "尚無紀錄" : <ReportTime at={selected.agent.startedAt} />}</dd>
              <dt>結束時間</dt><dd>{selected.agent.stoppedAt == null ? "尚無紀錄" : <ReportTime at={selected.agent.stoppedAt} />}</dd>
              <dt>證據</dt><dd>{selected.agent.outcome !== undefined || selected.agent.taskTitle ? "本機任務回報" : CODEX_ACTIVITY_EVIDENCE}</dd>
              </dl>
            </details>
            {timeline.length > 0 ? (
              <section className="task-timeline" aria-label="任務時間軸">
                <h3>任務時間軸</h3>
                <ol className="timeline-events">
                  {timeline.map((event) => <li key={event.key}><strong>{eventLabels[event.kind]}</strong> <ReportTime at={event.at} /></li>)}
                </ol>
              </section>
            ) : null}
          </section>
        ) : <section className="panel seat-inspector"><h2>席位詳情</h2><p className="hint">子代理入座後，點選工位就能查看任務。</p></section>}
      </aside>
    </div>
  );
}
