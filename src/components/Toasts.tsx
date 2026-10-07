import { X } from "lucide-react";
import { useStore } from "../store";

const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const importing = useStore((s) => s.importing);
  const updating = useStore((s) => s.updating);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
      {importing && (
        <div className="animate-toast-in rounded-lg border border-line bg-raised p-3 shadow-xl">
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
      {updating && (
        <div className="animate-toast-in rounded-lg border border-line bg-raised p-3 shadow-xl">
          <div className="mb-2 flex justify-between text-xs">
            <span>アップデートをダウンロード中…</span>
            <span className="tabular-nums text-dim">
              {mb(updating.done)}
              {updating.total ? ` / ${mb(updating.total)} MB` : " MB"}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-bg">
            <div
              className={`h-full bg-accent transition-[width] ${updating.total ? "" : "animate-pulse"}`}
              style={{ width: updating.total ? `${(updating.done / updating.total) * 100}%` : "100%" }}
            />
          </div>
        </div>
      )}
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-2 rounded-lg border py-2 pr-2 pl-3 shadow-xl ${
            t.leaving ? "animate-toast-out" : "animate-toast-in"
          } ${t.error ? "border-danger/50 bg-[#3a2224]" : "border-line bg-raised"}`}
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
              className="shrink-0 rounded px-2 py-0.5 font-medium text-accent hover:bg-accent/15"
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismiss(t.id)} className="shrink-0 rounded p-0.5 text-dim hover:text-fg">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
