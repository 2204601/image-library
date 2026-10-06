import {
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderPlus,
  Images,
  Inbox,
  Library,
  Tag as TagIcon,
  Tags,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  confirmDeleteFolder,
  confirmDeleteTag,
  createLibraryDialog,
  emptyTrash,
  openLibraryDialog,
} from "../lib/actions";
import { api, type Folder, type View } from "../lib/api";
import { useStore } from "../store";
import { useMenu } from "./ContextMenu";
import { startPointerDrag } from "./DragLayer";

const sameView = (a: View, b: View) =>
  a.kind === b.kind && (a.kind !== "folder" || (b.kind === "folder" && a.id === b.id));

function Row({
  active,
  dropHighlight,
  depth = 0,
  icon,
  label,
  count,
  children,
  ...rest
}: {
  active?: boolean;
  dropHighlight?: boolean;
  depth?: number;
  icon: React.ReactNode;
  label: React.ReactNode;
  count?: number;
} & React.HTMLAttributes<HTMLDivElement> & { "data-drop"?: string }) {
  return (
    <div
      {...rest}
      className={`group flex h-7 cursor-default items-center gap-1.5 rounded-md pr-2 ${
        active ? "bg-accent/25 text-white" : "hover:bg-white/5"
      } ${dropHighlight ? "ring-2 ring-accent ring-inset" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {children}
      <span className="shrink-0 text-dim">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-xs text-dim tabular-nums">{count}</span>}
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
  const showMenu = useMenu((s) => s.show);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);

  const children = useMemo(() => {
    const m = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const k = f.parentId;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(f);
    }
    return m;
  }, [folders]);

  const create = async (parentId: string | null) => {
    try {
      const id = await api.createFolder("新しいフォルダ", parentId);
      if (parentId) setCollapsed((c) => new Set([...c].filter((x) => x !== parentId)));
      await useStore.getState().refresh();
      setEditing(id);
    } catch (e) {
      useStore.getState().toast(String(e), true);
    }
  };

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
            data-drop={`folder:${f.id}`}
            active={sameView(view, { kind: "folder", id: f.id })}
            dropHighlight={drag !== null && dropTarget === `folder:${f.id}`}
            icon={<FolderIcon size={15} />}
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
                (x, y) => ({ kind: "folder", id: f.id, x, y }),
                () => setView({ kind: "folder", id: f.id }),
              )
            }
            onDoubleClick={() => setEditing(f.id)}
            onContextMenu={(e) =>
              showMenu(e, [
                { label: "サブフォルダを作成", onClick: () => create(f.id) },
                { label: "名前を変更", onClick: () => setEditing(f.id) },
                ...(f.parentId
                  ? [{ label: "最上位へ移動", onClick: () => run(() => api.moveFolder(f.id, null)) }]
                  : []),
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

  return (
    <Section
      title="フォルダ"
      drop={drag?.kind === "folder" ? "root" : undefined}
      highlight={drag?.kind === "folder" && dropTarget === "root"}
      action={
        <button title="フォルダを作成" className="text-dim hover:text-fg" onClick={() => create(null)}>
          <FolderPlus size={15} />
        </button>
      }
    >
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
  drop,
  highlight,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  drop?: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div
        data-drop={drop}
        className={`mb-1 flex items-center justify-between rounded px-2 text-xs font-semibold tracking-wide text-dim ${
          highlight ? "ring-2 ring-accent" : ""
        }`}
      >
        <span>{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function TagList() {
  const tags = useStore((s) => s.tags);
  const tagFilter = useStore((s) => s.tagFilter);
  const toggleTagFilter = useStore((s) => s.toggleTagFilter);
  const run = useStore((s) => s.run);
  const showMenu = useMenu((s) => s.show);
  const [editing, setEditing] = useState<number | null>(null);

  return (
    <Section title="タグ">
      {tags.length === 0 && <p className="px-2 py-1 text-xs text-dim">タグはまだありません</p>}
      {tags.map((t) => (
        <Row
          key={t.id}
          active={tagFilter.includes(t.id)}
          icon={<TagIcon size={14} />}
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

  const smart: { view: View; label: string; icon: React.ReactNode; count: number }[] = [
    { view: { kind: "all" }, label: "すべて", icon: <Images size={15} />, count: counts.all },
    { view: { kind: "unfiled" }, label: "未分類", icon: <Inbox size={15} />, count: counts.unfiled },
    { view: { kind: "untagged" }, label: "タグなし", icon: <Tags size={15} />, count: counts.untagged },
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
        <FolderTree />
        <TagList />
      </nav>
    </aside>
  );
}
