import { convertFileSrc } from "@tauri-apps/api/core";
import { ExternalLink } from "lucide-react";
import { openSelection } from "../../lib/actions";
import type { Item } from "../../lib/api";

/**
 * The viewer's body for files. PDF opens in the web view's own PDF viewer;
 * office documents show their thumbnail, and editing is left to the default app.
 */
export function FileView({ item }: { item: Item }) {
  if (item.ext.toLowerCase() === "pdf") {
    return (
      <iframe
        key={item.id}
        src={convertFileSrc(item.filePath)}
        title={item.name}
        className="absolute inset-0 h-full w-full border-0 bg-white"
      />
    );
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-10">
      <img
        key={item.id}
        src={convertFileSrc(item.thumbPath)}
        alt={item.name}
        draggable={false}
        className="min-h-0 max-w-full animate-zoom-in rounded-md object-contain shadow-2xl"
      />
      <button
        onClick={() => openSelection([item.id])}
        className="flex shrink-0 items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:brightness-110"
      >
        <ExternalLink size={15} />
        既定のアプリで開く
      </button>
    </div>
  );
}
