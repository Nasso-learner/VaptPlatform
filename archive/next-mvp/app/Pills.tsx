export const SEVS = ["critical", "high", "medium", "low", "info"];

export function Pills({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="pills">
      {SEVS.filter((s) => counts[s]).map((s) => <span key={s} className={`sev ${s}`}>{s}: {counts[s]}</span>)}
    </div>
  );
}
