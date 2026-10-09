// The library menu (sidebar header) and the list of known libraries: the ones
// opened or created before, favourites first. Also used on the welcome screen.
import { Bot, Check, ChevronDown, FolderInput, FolderOpen, Library, Plus, Puzzle, RefreshCw, Star, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  createLibraryDialog,
  openLibraryAt,
  openLibraryDialog,
  transferAllOfMode,
} from "../lib/actions";
import { api, kindLabel, type LibraryEntry } from "../lib/api";
import { appVersion, checkForUpdate } from "../lib/update";
import { useStore } from "../store";

export function useLibraries() {
  const [list, setList] = useState<LibraryEntry[] | null>(null);
  const reload = useCallback(() => {
    api.listLibraries().then(setList, (e) => useStore.getState().toast(String(e), true));
  }, []);
  useEffect(reload, [reload]);
  return { list, reload };
}

/** The folder a library is in, shortened for a one-line hint. */
export function parentDir(root: string) {
  const parts = root.split(/[\\/]/).filter(Boolean);
  parts.pop();
  const tail = parts.slice(-2).join("/");
  return parts.length > 2 ? `…/${tail}` : `/${tail}`;
}

export function LibraryRow({
  lib,
  active,
  onClick,
  onFavorite,
  onForget,
  trailing,
}: {
  lib: LibraryEntry;
  active?: boolean;
  onClick: () => void;
  onFavorite?: () => void;
  onForget?: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={lib.exists ? 0 : -1}
      title={lib.exists ? lib.root : `見つかりません：${lib.root}`}
      onClick={() => lib.exists && onClick()}
      onKeyDown={(e) => e.key === "Enter" && lib.exists && onClick()}
      className={`group flex items-center gap-2.5 rounded-md px-2 py-1.5 ${
        lib.exists ? "cursor-pointer" : "cursor-default opacity-45"
      } ${active ? "bg-accent/20 ring-1 ring-accent/60" : lib.exists ? "hover:bg-white/5" : ""}`}
    >
      <Library size={16} className={`shrink-0 ${lib.current || active ? "text-accent" : "text-dim"}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{lib.name}</div>
        <div className="truncate text-[11px] text-dim">{lib.exists ? parentDir(lib.root) : "見つかりません（移動・削除、または外付けドライブ未接続）"}</div>
      </div>
      {trailing}
      {onFavorite && (
        <button
          title={lib.favorite ? "お気に入りから外す" : "お気に入りに追加"}
          onClick={(e) => {
            e.stopPropagation();
            onFavorite();
          }}
          className={`shrink-0 rounded p-1 hover:bg-white/10 ${
            lib.favorite ? "text-yellow-400" : "text-dim opacity-0 group-hover:opacity-100 focus:opacity-100"
          }`}
        >
          <Star size={14} fill={lib.favorite ? "currentColor" : "none"} />
        </button>
      )}
      {onForget && (
        <button
          title="一覧から外す（フォルダは削除しません）"
          onClick={(e) => {
            e.stopPropagation();
            onForget();
          }}
          className="shrink-0 rounded p-1 text-dim opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-fg focus:opacity-100"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/** Favourites, then recent libraries, each with a star and "remove from list". */
export function LibraryList({ list, reload, onOpen }: { list: LibraryEntry[]; reload: () => void; onOpen: (l: LibraryEntry) => void }) {
  const favorites = list.filter((l) => l.favorite);
  const recent = list.filter((l) => !l.favorite);
  const act = (fn: () => Promise<void>) => fn().then(reload, (e) => useStore.getState().toast(String(e), true));
  const row = (l: LibraryEntry) => (
    <LibraryRow
      key={l.root}
      lib={l}
      onClick={() => onOpen(l)}
      onFavorite={() => act(() => api.setLibraryFavorite(l.root, !l.favorite))}
      onForget={l.current ? undefined : () => act(() => api.forgetLibrary(l.root))}
      trailing={l.current && <Check size={15} className="shrink-0 text-accent" />}
    />
  );
  const heading = "px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-dim";
  return (
    <>
      {favorites.length > 0 && (
        <>
          <div className={heading}>お気に入り</div>
          {favorites.map(row)}
        </>
      )}
      {recent.length > 0 && (
        <>
          <div className={heading}>最近使ったライブラリ</div>
          {recent.map(row)}
        </>
      )}
    </>
  );
}

function MenuButton({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-white"
    >
      <span className="shrink-0 opacity-80">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-xs opacity-50">{hint}</span>}
    </button>
  );
}

function Panel({ close }: { close: () => void }) {
  const { list, reload } = useLibraries();
  const mode = useStore((s) => s.mode);
  const count = useStore((s) => s.counts.kinds[s.mode] ?? 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [close]);

  const then = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <div className="fixed inset-0 z-50" onPointerDown={close}>
      <div
        className="absolute top-12 left-2 flex max-h-[75vh] w-80 animate-slide-down flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {list === null ? (
            <div className="p-3 text-dim">読み込み中…</div>
          ) : (
            <LibraryList list={list} reload={reload} onOpen={(l) => then(() => openLibraryAt(l.root))()} />
          )}
        </div>
        <div className="border-t border-line p-1">
          <MenuButton icon={<FolderOpen size={15} />} label="ほかのライブラリを開く…" onClick={then(openLibraryDialog)} />
          <MenuButton icon={<Plus size={15} />} label="新しいライブラリを作成…" onClick={then(createLibraryDialog)} />
        </div>
        <div className="border-t border-line p-1">
          <MenuButton
            icon={<FolderInput size={15} />}
            label={`${kindLabel(mode)}を別のライブラリへ移す…`}
            hint={count ? `${count} 件` : undefined}
            onClick={then(transferAllOfMode)}
          />
          <MenuButton
            icon={<Puzzle size={15} />}
            label="ブラウザ拡張と連携…"
            onClick={then(() => useStore.getState().setWebImportOpen(true))}
          />
          <MenuButton
            icon={<Bot size={15} />}
            label="Claude と連携…"
            onClick={then(() => useStore.getState().setClaudeOpen(true))}
          />
          <MenuButton
            icon={<RefreshCw size={15} />}
            label="アップデートを確認…"
            hint={appVersion()}
            onClick={then(() => checkForUpdate(true))}
          />
        </div>
      </div>
    </div>
  );
}

/** The sidebar header: current library name, opens the library panel. */
export function LibrarySwitcher() {
  const library = useStore((s) => s.library);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        className={`m-2 flex items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-white/5 ${open ? "bg-white/5" : ""}`}
        title={library?.root}
        onClick={() => setOpen((o) => !o)}
      >
        <Library size={18} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate font-semibold">{library?.name}</span>
        <ChevronDown size={14} className={`text-dim transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <Panel close={close} />}
    </>
  );
}
