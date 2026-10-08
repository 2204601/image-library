// "ブラウザ拡張と連携": turns the local server for the Chrome extension on or
// off (src-tauri/src/webimport.rs) and walks through loading the extension.
import { ask } from "@tauri-apps/plugin-dialog";
import { Check, Copy, FolderOpen, Puzzle } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type WebImportStatus } from "../lib/api";
import { useStore } from "../store";

export function WebImportDialog() {
  const open = useStore((s) => s.webImportOpen);
  if (!open) return null;
  return <Dialog />;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    useStore.getState().toast("コピーしました");
  } catch (e) {
    useStore.getState().toast(String(e), true);
  }
}

function Dialog() {
  const close = () => useStore.getState().setWebImportOpen(false);
  const [status, setStatus] = useState<WebImportStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const isMac = navigator.userAgent.includes("Mac");

  useEffect(() => {
    api.webImportStatus().then(setStatus, (e) => useStore.getState().toast(String(e), true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const act = async (fn: () => Promise<WebImportStatus | unknown>) => {
    setBusy(true);
    try {
      const s = await fn();
      setStatus(s && typeof s === "object" && "enabled" in s ? (s as WebImportStatus) : await api.webImportStatus());
    } catch (e) {
      useStore.getState().toast(String(e), true);
    } finally {
      setBusy(false);
    }
  };

  const resetToken = async () => {
    const ok = await ask(
      "今の拡張機能はつながらなくなります。作り直したあと「フォルダを用意」を押し、Chrome で拡張機能を再読み込みしてください。",
      { title: "接続キーを作り直しますか？", kind: "warning", okLabel: "作り直す", cancelLabel: "キャンセル" },
    );
    if (ok) await act(api.resetWebImportToken);
  };

  const on = status?.enabled ?? false;

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/50" onPointerDown={close}>
      <div
        className="flex max-h-[85vh] w-[560px] max-w-[92vw] animate-zoom-in flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-5 pt-4 pb-3">
          <div className="flex items-center gap-2 text-base font-semibold">
            <Puzzle size={18} className="text-accent" />
            ブラウザ拡張と連携
          </div>
          <p className="mt-1 text-xs text-dim">
            Chrome（Microsoft Edge でも可）の拡張機能から、Web ページの画像やスクリーンショットをこのライブラリに保存できます。
            保存した画像には元のページの URL が記録されます。
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--color-accent)]"
              checked={on}
              disabled={!status || busy}
              onChange={(e) => act(() => api.setWebImport(e.target.checked))}
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium">ブラウザ拡張からの保存を受け付ける</span>
              <span className="mt-0.5 block text-xs text-dim">
                {!status
                  ? "確認中…"
                  : status.error
                    ? null
                    : status.running
                      ? `受付中（127.0.0.1:${status.port}）。このパソコンの中の、接続キーを持つ拡張機能からだけ受け付けます。`
                      : "オフ。アプリの起動中だけ受け付けます。"}
              </span>
              {status?.error && <span className="mt-0.5 block text-xs text-danger">{status.error}</span>}
            </span>
          </label>

          {on && (
            <ol className="mt-5 space-y-4 text-[13px]">
              <Step n={1} title="拡張機能のフォルダを用意する">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    disabled={busy}
                    onClick={() => act(api.installExtension)}
                    className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 font-medium text-white enabled:hover:brightness-110 disabled:opacity-40"
                  >
                    <FolderOpen size={14} />
                    {status?.extensionDir ? "もう一度用意する" : "フォルダを用意して表示"}
                  </button>
                  {status?.extensionDir && (
                    <span className="flex items-center gap-1 text-xs text-dim">
                      <Check size={13} className="text-emerald-500" /> 用意済み
                    </span>
                  )}
                </div>
                {status?.extensionDir && (
                  <PathRow path={status.extensionDir} />
                )}
                <p className="mt-1.5 text-xs text-dim">
                  アプリを更新したときは、もう一度用意してから Chrome の拡張機能の画面で再読み込み（↻）を押してください。
                </p>
              </Step>
              <Step n={2} title="Chrome で拡張機能の画面を開き、「デベロッパー モード」をオンにする">
                <PathRow path="chrome://extensions" hint="アドレスバーに貼り付けて開きます（Edge は edge://extensions）" />
              </Step>
              <Step n={3} title="「パッケージ化されていない拡張機能を読み込む」で、1 のフォルダを選ぶ">
                <p className="text-xs text-dim">
                  {isMac
                    ? "フォルダを選ぶ画面で ⌘⇧G を押し、1 のパスを貼り付けると早く選べます。"
                    : "フォルダを選ぶ画面のアドレス欄に、1 のパスを貼り付けると早く選べます。"}
                </p>
              </Step>
              <Step n={4} title="使い方">
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-dim">
                  <li>ツールバーの拡張機能のアイコンで、保存先のフォルダと付けるタグを選ぶ</li>
                  <li>画像を右クリック →「Image Library に保存」。{isMac ? "Option" : "Alt"} を押しながら右クリックすると、すぐに保存</li>
                  <li>アイコンの「このページの画像を一覧して保存…」で、大きさ・形式で絞り込んでまとめて保存</li>
                  <li>「表示中の画面を保存」で、見えている範囲のスクリーンショットを保存</li>
                </ul>
              </Step>
            </ol>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-5 py-3">
          <span className="flex-1">
            {on && (
              <button disabled={busy} onClick={resetToken} className="text-xs text-dim underline-offset-2 hover:text-fg hover:underline">
                接続キーを作り直す
              </button>
            )}
          </span>
          <button onClick={close} className="h-8 rounded-md border border-line px-3 hover:bg-white/5">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-semibold tabular-nums">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 font-medium">{title}</div>
        {children}
      </div>
    </li>
  );
}

function PathRow({ path, hint }: { path: string; hint?: string }) {
  return (
    <div className="mt-2">
      <div className="flex items-center gap-1 rounded-md border border-line bg-bg pl-2">
        <code className="min-w-0 flex-1 truncate py-1 text-xs" title={path}>
          {path}
        </code>
        <button onClick={() => copy(path)} className="flex h-7 items-center gap-1 px-2 text-xs text-dim hover:text-fg" title="コピー">
          <Copy size={13} /> コピー
        </button>
      </div>
      {hint && <p className="mt-1 text-xs text-dim">{hint}</p>}
    </div>
  );
}
