// The settings screen (⌘,), see docs/SETTINGS.md: the app's pages (一般,
// サイドバー, ブラウザ拡張, Claude; settings.json and this PC), then the open
// library's (概要, サイドバー; stored in its library.db). Changes are saved as
// they are made.
import {
  Bot,
  FileText,
  FolderInput,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Library,
  PanelLeft,
  Puzzle,
  Settings,
  Shapes,
  Share2,
  Type,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { transferAllOfKind } from "../lib/actions";
import { api, formatBytes, KINDS, kindLabel, type AppSettings, type ItemKind } from "../lib/api";
import { sidebarEntriesOf, type SidebarHidden } from "../lib/librarySettings";
import { MODES, modeLabel, modesFor, type Mode } from "../lib/modes";
import { isMac } from "../lib/shortcuts";
import { appVersion, checkForUpdate } from "../lib/update";
import { sidebarHidden, usedModes, useStore, type SettingsTab } from "../store";
import { WebImportSettings } from "./WebImportDialog";
import { composing } from "../lib/ime";
import { ClaudeSettings } from "./ClaudeSettings";
import { ShareSettings } from "./ShareDialog";

export const SETTINGS_KEY = isMac ? "⌘," : "Ctrl+,";

const KIND_ICON: Record<Mode | ItemKind, React.ReactNode> = {
  stock: <Shapes size={14} />,
  image: <ImageIcon size={14} />,
  font: <Type size={14} />,
  file: <FileText size={14} />,
};

type Page = { id: SettingsTab; label: string; icon: React.ReactNode };

/** Saved for the app (settings.json and this PC). */
const APP_PAGES: Page[] = [
  { id: "general", label: "一般", icon: <Settings size={15} /> },
  { id: "sidebar", label: "サイドバー", icon: <PanelLeft size={15} /> },
  { id: "extension", label: "ブラウザ拡張", icon: <Puzzle size={15} /> },
  { id: "claude", label: "Claude", icon: <Bot size={15} /> },
];

/** Saved in the open library (library.db). */
const LIBRARY_PAGES: Page[] = [
  { id: "library", label: "概要", icon: <Info size={15} /> },
  { id: "librarySidebar", label: "サイドバー", icon: <PanelLeft size={15} /> },
  { id: "libraryShare", label: "フォルダの共有", icon: <Share2 size={15} /> },
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
      if (s.settingsTab && e.key === "Escape" && !composing(e)) {
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
  const library = useStore((s) => s.library);
  const close = () => openSettings(null);

  const pageButton = (p: Page) => (
    <button
      key={p.id}
      onClick={() => openSettings(p.id)}
      aria-current={tab === p.id}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left ${
        tab === p.id ? "bg-accent/25 text-white" : "text-dim hover:bg-white/5 hover:text-fg"
      }`}
    >
      {p.icon}
      {p.label}
    </button>
  );

  return (
    <div data-modal className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/50" onPointerDown={close}>
      <div
        role="dialog"
        aria-label="設定"
        className="flex h-[min(620px,88vh)] w-[760px] max-w-[94vw] animate-zoom-in overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-line bg-bg/40 p-2">
          <div className="px-2 pt-1 pb-2 text-base font-semibold">設定</div>
          <NavHeading title="アプリ全体" />
          {APP_PAGES.map(pageButton)}
          {/* Only with a library open: its settings are stored in it. */}
          {library && (
            <>
              <div className="mx-2 my-2 border-t border-line" />
              <NavHeading title={`ライブラリ「${library.name}」`} sub="このライブラリに保存" />
              {LIBRARY_PAGES.map(pageButton)}
            </>
          )}
        </nav>
        <div className="relative min-w-0 flex-1">
          <div className="h-full overflow-y-auto px-6 py-5">
            {tab === "general" && <GeneralPage />}
            {tab === "sidebar" && <AppSidebarPage />}
            {tab === "extension" && <WebImportSettings />}
            {tab === "claude" && <ClaudeSettings />}
            {tab === "library" && <LibraryPage />}
            {tab === "librarySidebar" && <LibrarySidebarPage />}
            {tab === "libraryShare" && <ShareSettings />}
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

function NavHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="px-2 pt-1 pb-1">
      <div className="truncate text-[11px] font-semibold text-dim" title={title}>
        {title}
      </div>
      {sub && <div className="text-[10px] text-dim/70">{sub}</div>}
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

function GeneralPage() {
  const app = useStore((s) => s.appSettings);
  const save = useStore((s) => s.saveAppSettings);
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
        <span className="text-xs text-dim">Stockroom {appVersion() || "（開発版）"}</span>
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

function LibraryPage() {
  const library = useStore((s) => s.library);
  const kinds = useStore((s) => s.counts.kinds);
  const used = useStore(useShallow(usedModes));
  const setUsedModes = useStore((s) => s.setUsedModes);
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
      {/* A kind at a time (one library per kind is what moving all is for). */}
      <div className="mt-2 flex flex-wrap gap-2">
        {KINDS.filter((k) => (kinds[k.kind] ?? 0) > 0).map(({ kind }) => (
          <button
            key={kind}
            onClick={() => {
              useStore.getState().openSettings(null);
              transferAllOfKind(kind);
            }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-xs hover:bg-white/5"
          >
            <FolderInput size={14} />
            {kindLabel(kind)}をすべて別のライブラリへ移す…
            <span className="text-dim tabular-nums">（{kinds[kind]} 件）</span>
          </button>
        ))}
      </div>

      <Heading
        title="使う種類"
        sub="使う種類が一覧と種類の絞り込みに出ます。フォントをほかの種類と使うときは、フォントを見比べる「フォント」のモードも出ます。この設定はライブラリに保存されます"
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

    </div>
  );
}

// ------------------------------------------------------------ サイドバー

/** One column of checks per mode; `onChange` gets the mode's new hidden entries. */
function SidebarChecks({
  modes,
  hidden,
  onChange,
}: {
  modes: Mode[];
  hidden: SidebarHidden;
  /** Without it the checks are shown, not changed (the app's, from a library). */
  onChange?: (mode: Mode, ids: string[]) => void;
}) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${modes.length}, minmax(0, 1fr))` }}>
      {modes.map((m) => {
        const off = hidden[m] ?? [];
        return (
          <div key={m}>
            {modes.length > 1 && (
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-dim">
                {KIND_ICON[m]}
                {modeLabel(m)}
              </div>
            )}
            {sidebarEntriesOf(m).map((e) => (
              <Check
                key={e.id}
                checked={!off.includes(e.id)}
                disabled={!onChange}
                onChange={(show) => onChange?.(m, show ? off.filter((x) => x !== e.id) : [...off, e.id])}
              >
                {e.label}
              </Check>
            ))}
          </div>
        );
      })}
    </div>
  );
}

const SIDEBAR_SUB =
  "チェックを外した項目はサイドバーに出しません。表示を隠すだけで、シェルフへ追加（B キー）などの操作はそのまま使えます。「すべて」と「ゴミ箱」はいつも出ます";

function AppSidebarPage() {
  const hidden = useStore((s) => sidebarHidden(s, "app"));
  const loaded = useStore((s) => s.appSettings !== null);
  const setSidebarHidden = useStore((s) => s.setSidebarHidden);
  return (
    <div>
      <Heading title="サイドバーの項目" sub={`すべてのライブラリの既定です。${SIDEBAR_SUB}`} />
      {loaded && <SidebarChecks modes={MODES} hidden={hidden} onChange={(m, ids) => setSidebarHidden(m, ids, "app")} />}
      <p className="mt-4 text-xs text-dim">
        ライブラリごとに変えるときは、そのライブラリを開いて、設定のライブラリの「サイドバー」で「このライブラリだけの設定」を選びます。
      </p>
    </div>
  );
}

function LibrarySidebarPage() {
  const library = useStore((s) => s.library);
  const own = useStore((s) => s.librarySettings.sidebarOwn);
  const hidden = useStore((s) => sidebarHidden(s));
  const modes = useStore(useShallow((s) => modesFor(usedModes(s))));
  const setSidebarOwn = useStore((s) => s.setSidebarOwn);
  const setSidebarHidden = useStore((s) => s.setSidebarHidden);
  const openSettings = useStore((s) => s.openSettings);
  if (!library) return <p className="mt-8 text-center text-dim">ライブラリを開いていません</p>;

  const radio = (value: boolean, label: string, hint: string) => (
    <label className="flex cursor-pointer items-start gap-2.5 py-1">
      <input
        type="radio"
        name="sidebarOwn"
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
        checked={own === value}
        onChange={() => setSidebarOwn(value)}
      />
      <span>
        {label}
        <span className="mt-0.5 block text-xs text-dim">{hint}</span>
      </span>
    </label>
  );

  return (
    <div>
      <Heading title="サイドバーの項目" sub={SIDEBAR_SUB} />
      {radio(false, "アプリ全体の設定を使う", "どのライブラリでも同じ項目を出します。この PC の設定です")}
      {radio(true, "このライブラリだけの設定", "ライブラリに保存され、ほかの PC で開いても同じ項目を出します")}
      <div className={`mt-3 rounded-lg border border-line p-3 ${own ? "" : "bg-bg/40"}`}>
        <SidebarChecks modes={modes} hidden={hidden} onChange={own ? setSidebarHidden : undefined} />
        {!own && (
          <button
            onClick={() => openSettings("sidebar")}
            className="mt-2 text-xs text-accent underline-offset-2 hover:underline"
          >
            アプリ全体の設定を開く
          </button>
        )}
      </div>
    </div>
  );
}
