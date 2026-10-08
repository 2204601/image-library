import {
  ChevronDown,
  ChevronRight,
  Copy,
  Folder as FolderIcon,
  FolderPlus,
  FolderSearch,
  Heart,
  Image as ImageIcon,
  Images,
  Inbox,
  Library,
  Pin,
  Tag as TagIcon,
  Tags,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  confirmDeleteFolder,
  confirmDeleteSmartFolder,
  confirmDeleteTag,
  createFolder,
  createLibraryDialog,
  createSmartFolder,
  emptyTrash,
  openLibraryDialog,
  renameSmartFolder,
  shiftFolder,
  sortFoldersByName,
} from "../lib/actions";
import { api, FONT_CATEGORIES, FONT_SCRIPTS, KINDS, type Folder, type ItemKind, type View } from "../lib/api";
import { appVersion, checkForUpdate } from "../lib/update";
import { activeConditions, useStore } from "../store";
import { useMenu } from "./ContextMenu";
import { startPointerDrag } from "./DragLayer";
import { colorHex } from "../lib/colors";

const collapsedKey = (root: string) => `collapsed:${root}`;
function loadCollapsed(root: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(collapsedKey(root)) ?? "[]"));
  } catch {
    return new Set();
  }
}
function saveCollapsed(root: string, c: Set<string>) {
  try {
    localStorage.setItem(collapsedKey(root), JSON.stringify([...c]));
  } catch {
    /* ignore */
  }
}

const sameView = (a: View, b: View) =>
  a.kind === b.kind && (!("id" in a) || ("id" in b && a.id === b.id));

/** Drop highlight + post-drop pulse for a sidebar row with `data-drop={dropId}`. */
function useDropState(dropId: string | undefined) {
  const over = useStore(
    (s) => dropId !== undefined && (s.drag !== null || s.fileDrag) && s.dropTarget === dropId,
  );
  const flash = useStore((s) => (dropId !== undefined && s.flash?.target === dropId ? s.flash.n : null));
  return { over, flash };
}

function Row({
  active,
  dropId,
  depth = 0,
  icon,
  label,
  count,
  children,
  ...rest
}: {
  active?: boolean;
  dropId?: string;
  depth?: number;
  icon: React.ReactNode;
  label: React.ReactNode;
  count?: number;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { over, flash } = useDropState(dropId);
  // Folder reordering: a line above / below the row.
  const insert = useStore((s) =>
    dropId && s.drag && s.dropTarget?.startsWith(`pos:${dropId}:`) ? s.dropTarget.slice(-6) : null,
  );
  return (
    <div
      {...rest}
      data-drop={dropId}
      className={`group relative flex h-7 cursor-default items-center gap-1.5 rounded-md pr-2 transition-[background-color,transform,box-shadow] duration-150 ${
        over
          ? "scale-[1.03] bg-accent text-white shadow-lg shadow-accent/30"
          : active
            ? "bg-accent/25 text-white"
            : "hover:bg-white/5"
      }`}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {flash !== null && (
        <span
          key={`pulse-${flash}`}
          className="pointer-events-none absolute inset-0 animate-drop-pulse rounded-md"
        />
      )}
      {insert && (
        <span
          className={`pointer-events-none absolute right-1 h-0.5 rounded-full bg-accent shadow-[0_0_6px] shadow-accent ${
            insert === "before" ? "-top-px" : "-bottom-px"
          }`}
          style={{ left: 4 + depth * 14 }}
        />
      )}
      {children}
      <span className={`shrink-0 ${over ? "text-white" : "text-dim"}`}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span
          key={`count-${flash ?? ""}`}
          className={`text-xs tabular-nums ${over ? "text-white" : "text-dim"} ${flash !== null ? "animate-pop" : ""}`}
        >
          {count}
        </span>
      )}
    </div>
  );
}

function InlineEdit({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      ref={ref}
      defaultValue={value}
      className="w-full rounded border border-accent bg-bg px-1 outline-none"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

function FolderTree() {
  const folders = useStore((s) => s.folders);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const run = useStore((s) => s.run);
  const dropTarget = useStore((s) => s.dropTarget);
  const drag = useStore((s) => s.drag);
  const root = useStore((s) => s.library?.root ?? "");
  const showMenu = useMenu((s) => s.show);
  const [collapsed, setCollapsedRaw] = useState<Set<string>>(() => loadCollapsed(root));
  const editing = useStore((s) => s.renamingFolder);
  const setEditing = useStore((s) => s.setRenamingFolder);
  const showSubfolders = useStore((s) => s.showSubfolders);
  const setShowSubfolders = useStore((s) => s.setShowSubfolders);
  const setCollapsed = (fn: (c: Set<string>) => Set<string>) =>
    setCollapsedRaw((c) => {
      const n = fn(c);
      saveCollapsed(root, n);
      return n;
    });

  useEffect(() => setCollapsedRaw(loadCollapsed(root)), [root]);

  const children = useMemo(() => {
    const m = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const k = f.parentId;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(f);
    }
    return m;
  }, [folders]);

  const create = (parentId: string | null) => createFolder(parentId);

  // A folder being renamed (e.g. just created via ⌘⇧N) must be visible.
  useEffect(() => {
    if (!editing) return;
    const byId = new Map(folders.map((f) => [f.id, f]));
    const ancestors: string[] = [];
    for (let p = byId.get(editing)?.parentId; p; p = byId.get(p)?.parentId) ancestors.push(p);
    if (ancestors.some((a) => collapsed.has(a))) {
      setCollapsed((c) => new Set([...c].filter((x) => !ancestors.includes(x))));
    }
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-drop="folder:${CSS.escape(editing)}"]`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  }, [editing, folders]);

  // Hovering a collapsed folder while dragging opens it after a moment.
  useEffect(() => {
    if (!dropTarget?.startsWith("folder:")) return;
    const id = dropTarget.slice(7);
    if (!collapsed.has(id)) return;
    const t = setTimeout(() => setCollapsed((c) => new Set([...c].filter((x) => x !== id))), 600);
    return () => clearTimeout(t);
  }, [dropTarget, collapsed]);

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const render = (parent: string | null, depth: number): React.ReactNode =>
    (children.get(parent) ?? []).map((f) => {
      const kids = children.has(f.id);
      const open = !collapsed.has(f.id);
      return (
        <div key={f.id}>
          <Row
            depth={depth}
            dropId={`folder:${f.id}`}
            active={sameView(view, { kind: "folder", id: f.id })}
            icon={<FolderIcon size={15} style={{ color: colorHex(f.color) }} fill={colorHex(f.color) ?? "none"} fillOpacity={0.3} />}
            label={
              editing === f.id ? (
                <InlineEdit
                  value={f.name}
                  onDone={(v) => {
                    setEditing(null);
                    if (v && v.trim() && v !== f.name) run(() => api.renameFolder(f.id, v));
                  }}
                />
              ) : (
                f.name
              )
            }
            count={f.count}
            onPointerDown={(e) =>
              startPointerDrag(
                e,
                () => ({ kind: "folder", id: f.id }),
                () => setView({ kind: "folder", id: f.id }),
              )
            }
            onDoubleClick={() => setEditing(f.id)}
            onContextMenu={(e) =>
              showMenu(e, [
                { label: "サブフォルダを作成", onClick: () => create(f.id) },
                { label: "名前を変更", hint: "F2", onClick: () => setEditing(f.id) },
                {
                  label: `${showSubfolders ? "✓ " : ""}サブフォルダの内容を表示`,
                  onClick: () => {
                    setView({ kind: "folder", id: f.id });
                    setShowSubfolders(!showSubfolders);
                  },
                },
                ...(f.parentId
                  ? [{ label: "最上位へ移動", onClick: () => run(() => api.moveFolder(f.id, null)) }]
                  : []),
                { separator: true },
                { colors: { current: f.color, onPick: (c) => run(() => api.setFolderColor(f.id, c)) } },
                { separator: true },
                { label: "上へ", hint: "⌘[", onClick: () => shiftFolder(f.id, -1) },
                { label: "下へ", hint: "⌘]", onClick: () => shiftFolder(f.id, 1) },
                ...(kids
                  ? [{ label: "サブフォルダを名前順に並べ替え", onClick: () => sortFoldersByName(f.id) }]
                  : []),
                { separator: true },
                { label: "削除", danger: true, onClick: () => confirmDeleteFolder(f.id, f.name) },
              ])
            }
          >
            <span
              className={`-ml-1 w-3.5 shrink-0 text-dim ${kids ? "" : "invisible"}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                toggle(f.id);
              }}
            >
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </Row>
          {kids && open && render(f.id, depth + 1)}
        </div>
      );
    });

  const draggingNested =
    drag?.kind === "folder" && folders.find((f) => f.id === drag.id)?.parentId != null;

  return (
    <Section
      title="フォルダ"
      onContextMenu={(e) =>
        showMenu(e, [
          { label: "フォルダを作成", hint: "⌘⇧N", onClick: () => create(null) },
          { label: "最上位のフォルダを名前順に並べ替え", onClick: () => sortFoldersByName(null) },
        ])
      }
      action={
        <button title="フォルダを作成（⌘⇧N）" className="text-dim hover:text-fg" onClick={() => create(null)}>
          <FolderPlus size={15} />
        </button>
      }
    >
      {draggingNested && (
        <div
          data-drop="root"
          className={`mb-1 animate-slide-down rounded-md border border-dashed px-2 py-1.5 text-center text-xs transition-colors ${
            dropTarget === "root" ? "border-accent bg-accent text-white" : "border-line text-dim"
          }`}
        >
          ここにドロップで最上位へ
        </div>
      )}
      {folders.length === 0 ? (
        <p className="px-2 py-1 text-xs text-dim">＋ でフォルダを作成</p>
      ) : (
        render(null, 0)
      )}
    </Section>
  );
}

function Section({
  title,
  action,
  onContextMenu,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div
        onContextMenu={onContextMenu}
        className="mb-1 flex items-center justify-between px-2 text-xs font-semibold tracking-wide text-dim"
      >
        <span>{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function SmartFolderList() {
  const smartFolders = useStore((s) => s.smartFolders);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const editing = useStore((s) => s.renamingFolder);
  const setEditing = useStore((s) => s.setRenamingFolder);
  const startEditSmart = useStore((s) => s.startEditSmart);
  const run = useStore((s) => s.run);
  const hasConditions = useStore((s) => activeConditions(s) > 0);
  const showMenu = useMenu((s) => s.show);

  return (
    <Section
      title="スマートフォルダ"
      action={
        <button
          title={hasConditions ? "今の条件をスマートフォルダとして保存（⌘⇧⌥N）" : "スマートフォルダを作成（⌘⇧⌥N）"}
          className="text-dim hover:text-fg"
          onClick={() => createSmartFolder()}
        >
          <FolderPlus size={15} />
        </button>
      }
    >
      {smartFolders.length === 0 && (
        <p className="px-2 py-1 text-xs leading-relaxed text-dim">
          絞り込み（⌘⇧F）の条件を保存すると、当てはまる画像が自動で集まります
        </p>
      )}
      {smartFolders.map((sf) => (
        <Row
          key={sf.id}
          active={sameView(view, { kind: "smart", id: sf.id })}
          icon={<FolderSearch size={15} style={{ color: colorHex(sf.color) }} />}
          label={
            editing === sf.id ? (
              <InlineEdit
                value={sf.name}
                onDone={(v) => {
                  setEditing(null);
                  if (v && v.trim() && v !== sf.name) renameSmartFolder(sf.id, v);
                }}
              />
            ) : (
              sf.name
            )
          }
          count={sf.count}
          onClick={() => setView({ kind: "smart", id: sf.id })}
          onDoubleClick={() => setEditing(sf.id)}
          onContextMenu={(e) =>
            showMenu(e, [
              { label: "条件を編集", onClick: () => startEditSmart(sf) },
              { label: "名前を変更", hint: "F2", onClick: () => setEditing(sf.id) },
              { colors: { current: sf.color, onPick: (c) => run(() => api.setSmartFolderColor(sf.id, c)) } },
              { separator: true },
              { label: "削除", danger: true, onClick: () => confirmDeleteSmartFolder(sf.id, sf.name) },
            ])
          }
        />
      ))}
    </Section>
  );
}

const KIND_ICON: Record<ItemKind, React.ReactNode> = {
  image: <ImageIcon size={15} />,
  font: <Type size={15} />,
};

/** Clicking a filter row: only this one (again: none); ⌘ / Shift adds or removes it. */
function pickFrom<T>(cur: T[], v: T, add: boolean): T[] {
  if (add) return cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
  return cur.length === 1 && cur[0] === v ? [] : [v];
}

const isAdd = (e: React.MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey;

/**
 * Quick filter by kind, on top of the open view (like tags). A click shows
 * only that kind (again: all kinds); ⌘ / Shift + click adds or removes one.
 * With fonts shown, their writing systems and typeface styles appear below.
 */
function KindList() {
  const counts = useStore((s) => s.counts);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const { kinds, fontScripts, fontCategories } = filter;
  const fontsOpen = kinds.includes("font");
  const active = kinds.length + fontScripts.length + fontCategories.length > 0;

  const pickKind = (k: ItemKind, add: boolean) => {
    const next = pickFrom(kinds, k, add);
    // The font filters only make sense while fonts are shown.
    setFilter(next.includes("font") ? { kinds: next } : { kinds: next, fontScripts: [], fontCategories: [] });
  };

  const sub = (title: string, items: { key: string; label: string }[], counted: Record<string, number>, on: string[], set: (v: string[]) => void) => {
    const shown = items.filter((x) => counted[x.key] || on.includes(x.key));
    if (!shown.length) return null;
    return (
      <>
        <div className="mt-1 mb-0.5 pl-9 text-[11px] text-dim">{title}</div>
        {shown.map((x) => (
          <Row
            key={x.key}
            depth={1}
            active={on.includes(x.key)}
            icon={<span className="block h-1.5 w-1.5 rounded-full bg-current" />}
            label={x.label}
            count={counted[x.key] ?? 0}
            title="クリックでこれだけを表示（⌘・Shift+クリックで追加）"
            onClick={(e) => set(pickFrom(on, x.key, isAdd(e)))}
          />
        ))}
      </>
    );
  };

  return (
    <Section
      title="種類"
      action={
        active && (
          <button
            title="種類の絞り込みを解除"
            className="text-dim hover:text-fg"
            onClick={() => setFilter({ kinds: [], fontScripts: [], fontCategories: [] })}
          >
            <X size={14} />
          </button>
        )
      }
    >
      {KINDS.map(({ kind, label }) => (
        <div key={kind}>
          <Row
            active={kinds.includes(kind)}
            icon={KIND_ICON[kind]}
            label={label}
            count={counts.kinds[kind] ?? 0}
            title={
              kind === "font"
                ? "クリックでフォントだけを表示。言語・書体で絞り込めます（⌘・Shift+クリックで追加）"
                : "クリックでこの種類だけを表示（⌘・Shift+クリックで追加）"
            }
            onClick={(e) => pickKind(kind, isAdd(e))}
          />
          {kind === "font" && fontsOpen && (
            <div className="animate-slide-down">
              {sub("言語", FONT_SCRIPTS, counts.fontScripts, fontScripts, (v) => setFilter({ fontScripts: v }))}
              {sub("書体", FONT_CATEGORIES, counts.fontCategories, fontCategories, (v) =>
                setFilter({ fontCategories: v }),
              )}
            </div>
          )}
        </div>
      ))}
    </Section>
  );
}

function TagList() {
  const tags = useStore((s) => s.tags);
  const tagFilter = useStore((s) => s.tagFilter);
  const toggleTagFilter = useStore((s) => s.toggleTagFilter);
  const clearTagFilter = useStore((s) => s.clearTagFilter);
  const tagMatchAll = useStore((s) => s.tagMatchAll);
  const setTagMatchAll = useStore((s) => s.setTagMatchAll);
  const run = useStore((s) => s.run);
  const showMenu = useMenu((s) => s.show);
  const [editing, setEditing] = useState<number | null>(null);

  const mode = (all: boolean, label: string, title: string) => (
    <button
      title={title}
      onClick={() => setTagMatchAll(all)}
      className={`rounded px-1.5 py-px font-normal ${
        tagMatchAll === all ? "bg-white/15 text-fg" : "text-dim hover:text-fg"
      }`}
    >
      {label}
    </button>
  );

  return (
    <Section
      title="タグ"
      action={
        tagFilter.length > 0 && (
          <div className="flex items-center gap-1.5 tracking-normal">
            {tagFilter.length > 1 && (
              <div className="flex rounded-md border border-line p-px">
                {mode(false, "いずれか", "選択したタグのどれかが付いた画像（OR）")}
                {mode(true, "すべて", "選択したタグがすべて付いた画像（AND）")}
              </div>
            )}
            <button title="タグの絞り込みを解除" className="text-dim hover:text-fg" onClick={clearTagFilter}>
              <X size={14} />
            </button>
          </div>
        )
      }
    >
      {tags.length === 0 && <p className="px-2 py-1 text-xs text-dim">タグはまだありません</p>}
      {tags.map((t) => (
        <Row
          key={t.id}
          active={tagFilter.includes(t.id)}
          icon={<TagIcon size={14} style={{ color: colorHex(t.color) }} fill={colorHex(t.color) ?? "none"} fillOpacity={0.3} />}
          label={
            editing === t.id ? (
              <InlineEdit
                value={t.name}
                onDone={(v) => {
                  setEditing(null);
                  if (v && v.trim() && v !== t.name) run(() => api.renameTag(t.id, v));
                }}
              />
            ) : (
              t.name
            )
          }
          count={t.count}
          onClick={() => toggleTagFilter(t.id)}
          onDoubleClick={() => setEditing(t.id)}
          onContextMenu={(e) =>
            showMenu(e, [
              { label: "名前を変更", onClick: () => setEditing(t.id) },
              { colors: { current: t.color, onPick: (c) => run(() => api.setTagColor(t.id, c)) } },
              { separator: true },
              { label: "削除", danger: true, onClick: () => confirmDeleteTag(t.id, t.name) },
            ])
          }
        />
      ))}
    </Section>
  );
}

export function Sidebar() {
  const library = useStore((s) => s.library);
  const counts = useStore((s) => s.counts);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const showMenu = useMenu((s) => s.show);

  const smart: { view: View; label: string; icon: React.ReactNode; count?: number }[] = [
    { view: { kind: "all" }, label: "すべて", icon: <Images size={15} />, count: counts.all },
    { view: { kind: "unfiled" }, label: "未分類", icon: <Inbox size={15} />, count: counts.unfiled },
    { view: { kind: "untagged" }, label: "タグなし", icon: <Tags size={15} />, count: counts.untagged },
    { view: { kind: "favorites" }, label: "お気に入り", icon: <Heart size={15} />, count: counts.favorites },
    { view: { kind: "pinned" }, label: "ピン留め", icon: <Pin size={15} />, count: counts.pinned },
    { view: { kind: "similar" }, label: "重複の候補", icon: <Copy size={15} /> },
    { view: { kind: "trash" }, label: "ゴミ箱", icon: <Trash2 size={15} />, count: counts.trash },
  ];

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
      <button
        className="m-2 flex items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-white/5"
        title={library?.root}
        onClick={(e) =>
          showMenu(e, [
            { label: "別のライブラリを開く…", onClick: openLibraryDialog },
            { label: "新しいライブラリを作成…", onClick: createLibraryDialog },
            { separator: true },
            { label: "ブラウザ拡張と連携…", onClick: () => useStore.getState().setWebImportOpen(true) },
            { label: "アップデートを確認…", hint: appVersion(), onClick: () => checkForUpdate(true) },
          ])
        }
      >
        <Library size={18} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate font-semibold">{library?.name}</span>
        <ChevronDown size={14} className="text-dim" />
      </button>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {smart.map((s) => (
          <Row
            key={s.view.kind}
            active={sameView(view, s.view)}
            icon={s.icon}
            label={s.label}
            count={s.count}
            onClick={() => setView(s.view)}
            onContextMenu={
              s.view.kind === "trash"
                ? (e) => showMenu(e, [{ label: "ゴミ箱を空にする", danger: true, onClick: emptyTrash }])
                : undefined
            }
          />
        ))}
        <KindList />
        <FolderTree />
        <SmartFolderList />
        <TagList />
      </nav>
    </aside>
  );
}
