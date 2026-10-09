// The settings screen (⌘,), see docs/SETTINGS.md: the whole app (一般), the
// open library's own settings (このライブラリ, stored in its library.db) and
// the browser extension (連携). Changes are saved as they are made.
import { FileText, FolderOpen, Image as ImageIcon, Library, Puzzle, Settings, Type, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api, formatBytes, KINDS, kindLabel, type AppSettings, type ItemKind } from "../lib/api";
import { sidebarEntriesOf } from "../lib/librarySettings";
import { isMac } from "../lib/shortcuts";
import { appVersion, checkForUpdate } from "../lib/update";
import { usedModes, useStore, type SettingsTab } from "../store";
import { WebImportSettings } from "./WebImportDialog";

export const SETTINGS_KEY = isMac ? "⌘," : "Ctrl+,";

const KIND_ICON: Record<ItemKind, React.ReactNode> = {
  image: <ImageIcon size={14} />,
  font: <Type size={14} />,
  file: <FileText size={14} />,
};

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "一般", icon: <Settings size={15} /> },
  { id: "library", label: "このライブラリ", icon: <Library size={15} /> },
  { id: "integration", label: "連携", icon: <Puzzle size={15} /> },
];

/** ⌘, opens the screen (or closes it); Esc closes it. */
function useSettingsKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === ",") {
        e.preventDefault();
        s.openSettings(s.settingsTab ? null : "general");
        return;
      }
      if (s.settingsTab && e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        s.openSettings(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

export function SettingsDialog() {
  useSettingsKeys();
  const tab = useStore((s) => s.settingsTab);
  return tab ? <Dialog tab={tab} /> : null;
}

function Dialog({ tab }: { tab: SettingsTab }) {
  const openSettings = useStore((s) => s.openSettings);
  const anchor = useStore((s) => s.settingsAnchor);
  const close = () => openSettings(null);

  // Opened for one part of a tab (e.g. the sidebar entries): bring it into view.
  useEffect(() => {
    if (!anchor) return;
    requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }));
    useStore.setState({ settingsAnchor: null });
  }, [anchor]);

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/50" onPointerDown={close}>
      <div
        role="dialog"
        aria-label="設定"
        className="flex h-[min(620px,88vh)] w-[760px] max-w-[94vw] animate-zoom-in overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-line bg-bg/40 p-2">
          <div className="px-2 pt-1 pb-2 text-base font-semibold">設定</div>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => openSettings(t.id)}
              aria-current={tab === t.id}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                tab === t.id ? "bg-accent/25 text-white" : "text-dim hover:bg-white/5 hover:text-fg"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
        <div className="relative min-w-0 flex-1">
          <div className="h-full overflow-y-auto px-6 py-5">
            {tab === "general" && <GeneralTab />}
            {tab === "library" && <LibraryTab />}
            {tab === "integration" && <WebImportSettings />}
          </div>
          <button
            onClick={close}
            title="閉じる（Esc）"
            className="absolute top-3 right-3 rounded p-1 text-dim hover:bg-white/10 hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Heading({ id, title, sub }: { id?: string; title: string; sub?: string }) {
  return (
    <div id={id} className="mt-6 mb-2 scroll-mt-4 first:mt-0">
      <h2 className="font-semibold">{title}</h2>
      {sub && <p className="mt-0.5 text-xs text-dim">{sub}</p>}
    </div>
  );
}

function Check({
  checked,
  disabled,
  onChange,
  children,
  hint,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <label className={`flex items-start gap-2.5 py-1 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">{children}</span>
        {hint && <span className="mt-0.5 block text-xs text-dim">{hint}</span>}
      </span>
    </label>
  );
}

// ------------------------------------------------------------- 一般

function GeneralTab() {
  const [app, setApp] = useState<AppSettings | null>(null);
  useEffect(() => {
    api.getAppSettings().then(setApp, (e) => useStore.getState().toast(String(e), true));
  }, []);
  const save = (patch: Partial<AppSettings>) => {
    if (!app) return;
    const next = { ...app, ...patch };
    setApp(next);
    api.setAppSettings(next).catch((e) => useStore.getState().toast(String(e), true));
  };
  const radio = (value: AppSettings["startup"], label: string, hint: string) => (
    <label className="flex cursor-pointer items-start gap-2.5 py-1">
      <input
        type="radio"
        name="startup"
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
        checked={app?.startup === value}
        disabled={!app}
        onChange={() => save({ startup: value })}
      />
      <span>
        {label}
        <span className="mt-0.5 block text-xs text-dim">{hint}</span>
      </span>
    </label>
  );

  return (
    <div>
      <Heading title="起動したとき" />
      {radio("last", "前回のライブラリを開く", "見つからないとき（外付けドライブが未接続など）は、ライブラリの一覧を出します")}
      {radio("choose", "ライブラリを選ぶ", "最近使ったライブラリとお気に入りの一覧から選びます")}

      <Heading title="アップデート" />
      <Check
        checked={app?.autoUpdate ?? true}
        disabled={!app}
        onChange={(on) => save({ autoUpdate: on })}
        hint="起動して少したってから、新しいバージョンがあるか確認します"
      >
        アップデートを自動で確認する
      </Check>
      <div className="mt-2 flex items-center gap-3">
        <span className="text-xs text-dim">Image Library {appVersion() || "（開発版）"}</span>
        <button
          onClick={() => checkForUpdate(true)}
          className="h-7 rounded-md border border-line px-2.5 text-xs hover:bg-white/5"
        >
          アップデートを確認…
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------- このライブラリ

function LibraryTab() {
  const library = useStore((s) => s.library);
  const kinds = useStore((s) => s.counts.kinds);
  const used = useStore(useShallow(usedModes));
  const hidden = useStore((s) => s.librarySettings.hidden);
  const setUsedModes = useStore((s) => s.setUsedModes);
  const setSidebarHidden = useStore((s) => s.setSidebarHidden);
  const [size, setSize] = useState<number | null>(null);
  useEffect(() => {
    if (library) api.librarySize().then(setSize, () => setSize(null));
  }, [library]);

  if (!library) return <p className="mt-8 text-center text-dim">ライブラリを開いていません</p>;
  const total = Object.values(kinds).reduce((a, n) => a + (n ?? 0), 0);
  const dropped = KINDS.filter((k) => !used.includes(k.kind) && (kinds[k.kind] ?? 0) > 0);

  return (
    <div>
      <Heading title="ライブラリ" />
      <div className="flex items-start gap-3 rounded-lg border border-line bg-bg/40 p-3">
        <Library size={18} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{library.name}</div>
          <div className="truncate text-xs text-dim" title={library.root}>
            {library.root}
          </div>
          <div className="mt-1 text-xs text-dim tabular-nums">
            {total} 件{size !== null && ` · ${formatBytes(size)}`}
          </div>
        </div>
        <button
          onClick={() => useStore.getState().run(() => api.revealPath(library.root))}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs hover:bg-white/5"
        >
          <FolderOpen size={13} />
          {isMac ? "Finder で表示" : "エクスプローラで表示"}
        </button>
      </div>

      <Heading
        title="使う種類"
        sub="使う種類だけがモードの切り替えに出ます（1 種類ならモードの切り替えは出しません）。この設定はライブラリに保存されます"
      />
      {KINDS.map(({ kind, label }) => {
        const on = used.includes(kind);
        const n = kinds[kind] ?? 0;
        return (
          <Check
            key={kind}
            checked={on}
            // At least one kind stays.
            disabled={on && used.length === 1}
            onChange={(v) => setUsedModes(v ? [...used, kind] : used.filter((m) => m !== kind))}
          >
            {KIND_ICON[kind]}
            {label}
            {n > 0 && <span className="text-xs text-dim tabular-nums">（{n} 件）</span>}
          </Check>
        );
      })}
      {dropped.length > 0 && (
        <p className="mt-1 rounded-md bg-white/5 px-2.5 py-1.5 text-xs text-dim">
          {dropped.map((k) => `${k.label} ${kinds[k.kind]} 件`).join("、")}
          は一覧に出なくなります。アイテムは消えません（チェックを戻すとまた出ます）
        </p>
      )}

      <Heading
        id="settings-sidebar"
        title="サイドバーの項目"
        sub="チェックを外した項目はサイドバーに出しません。表示を隠すだけで、作業台へ追加（B キー）などの操作はそのまま使えます。「すべて」と「ゴミ箱」はいつも出ます"
      />
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${used.length}, minmax(0, 1fr))` }}>
        {used.map((m) => {
          const off = hidden[m] ?? [];
          return (
            <div key={m}>
              {used.length > 1 && (
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-dim">
                  {KIND_ICON[m]}
                  {kindLabel(m)}モード
                </div>
              )}
              {sidebarEntriesOf(m).map((e) => (
                <Check
                  key={e.id}
                  checked={!off.includes(e.id)}
                  onChange={(show) => setSidebarHidden(m, show ? off.filter((x) => x !== e.id) : [...off, e.id])}
                >
                  {e.label}
                </Check>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
