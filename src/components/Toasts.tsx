import { useStore } from "../store";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const importing = useStore((s) => s.importing);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
      {importing && (
        <div className="rounded-lg border border-line bg-raised p-3 shadow-xl">
          <div className="mb-2 flex justify-between text-xs">
            <span>読み込み中…</span>
            <span className="tabular-nums text-dim">
              {importing.done} / {importing.total}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-bg">
            <div
              className="h-full bg-accent transition-[width]"
              style={{ width: `${importing.total ? (importing.done / importing.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-lg border px-3 py-2 shadow-xl ${
            t.error ? "border-danger/50 bg-[#3a2224]" : "border-line bg-raised"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
