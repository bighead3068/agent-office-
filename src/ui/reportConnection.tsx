import { useEffect, useState } from "react";

const POLL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 10_000;

type Snapshot<T> = { data: T | null; lastSuccessAt: number | null; error: string | null };

export function useSnapshot<T>(enabled: boolean, url: string, project: (payload: unknown) => T | null): Snapshot<T> {
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({ data: null, lastSuccessAt: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    const lifetime = new AbortController();
    let timer: number | undefined;

    async function refresh() {
      try {
        const response = await fetch(url, {
          cache: "no-store",
          signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = project(await response.json());
        if (data == null) throw new Error("invalid");
        if (!lifetime.signal.aborted) setSnapshot({ data, lastSuccessAt: Date.now(), error: null });
      } catch (error) {
        if (!lifetime.signal.aborted) {
          setSnapshot((previous) => ({ ...previous, error: error instanceof Error ? error.message : "error" }));
        }
      } finally {
        if (!lifetime.signal.aborted) timer = window.setTimeout(() => void refresh(), POLL_MS);
      }
    }

    void refresh();
    return () => {
      lifetime.abort();
      window.clearTimeout(timer);
    };
  }, [enabled, url, project]);

  return snapshot;
}

const taipei = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function formatReportTime(at: number): string {
  return `${taipei.format(at)}（台北）`;
}

export function ReportTime({ at }: { at: number }) {
  return <time dateTime={new Date(at).toISOString()}>{formatReportTime(at)}</time>;
}

export function ConnectionNotice({ snapshot, emptyText }: { snapshot: Snapshot<unknown>; emptyText: string }) {
  const { lastSuccessAt, error } = snapshot;
  const state = error ? (lastSuccessAt == null ? "unavailable" : "cached") : (lastSuccessAt == null ? "connecting" : "connected");
  const messages = {
    connecting: "正在連接本機接收器。",
    connected: "本機接收器已連線。",
    unavailable: `本機接收器暫時無法讀取。${emptyText}`,
    cached: "本機接收器更新失敗。下方顯示上次成功讀取的快取，狀態可能已改變。",
  };

  return (
    <p className="live-callout" role="status" data-testid="live-note" data-connection={state}>
      {messages[state]} {state === "cached" && lastSuccessAt != null ? <>上次讀取 <ReportTime at={lastSuccessAt} />。</> : null}
    </p>
  );
}
