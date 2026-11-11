import { ReportTime } from "./reportConnection";

export type Completion = { key: string; title: string; person: string; at: number };

const taipeiDate = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "short" });

export function CompletionWall({ completions }: { completions: Completion[] }) {
  const today = taipeiDate.format(Date.now());
  const seen = new Set<string>();
  const entries = completions.slice().sort((left, right) => left.at - right.at).filter(({ key, at }) => {
    if (taipeiDate.format(at) !== today || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).reverse();

  return (
    <section className="panel completion-wall" aria-label="今日完工牆">
      <h2>今日完工牆</h2>
      {entries.length > 0 ? (
        <ul className="timeline-events">
          {entries.map(({ key, title, person, at }) => (
            <li key={key}><strong>{title}</strong> <span>{person}・<ReportTime at={at} /></span></li>
          ))}
        </ul>
      ) : <p className="hint">目前沒有台北當日的完工回報。</p>}
    </section>
  );
}
