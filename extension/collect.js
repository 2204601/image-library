// The image list: every image on a page (img / srcset / links to images /
// CSS backgrounds), filtered by size and format, saved in one go.
import { bindDestination, call, guessExt, saveImage } from "./shared.js";

const $ = (id) => document.getElementById(id);
const tabId = Number(new URLSearchParams(location.search).get("tab"));

/** Runs in the page: the images it shows or links to, largest version first. */
function gather() {
  const found = new Map();
  const add = (raw, w = 0, h = 0, alt = "") => {
    if (!raw) return;
    let url;
    try {
      url = new URL(raw, location.href).href;
    } catch {
      return;
    }
    if (!/^(https?|data|blob):/.test(url)) return;
    const prev = found.get(url);
    if (!prev) found.set(url, { url, w, h, alt });
    else if (w * h > prev.w * prev.h) Object.assign(prev, { w, h });
  };
  // The largest candidate of a srcset ("a.jpg 1x, b.jpg 2x" / "a.jpg 400w, …").
  const best = (srcset) => {
    let top = null;
    for (const part of srcset.split(/,\s+/)) {
      const [u, d] = part.trim().split(/\s+/);
      const n = parseFloat(d) || 1;
      if (u && (!top || n > top.n)) top = { u, n };
    }
    return top?.u;
  };
  for (const img of document.images) {
    const shown = img.currentSrc || img.src;
    add(shown, img.naturalWidth, img.naturalHeight, img.alt);
    if (img.srcset) add(best(img.srcset), 0, 0, img.alt);
  }
  for (const s of document.querySelectorAll("picture source[srcset]")) add(best(s.srcset));
  for (const a of document.querySelectorAll("a[href]")) {
    if (/\.(jpe?g|png|gif|webp|avif|bmp|svg|tiff?|heic)(?:[?#]|$)/i.test(a.pathname)) add(a.href);
  }
  // Background images; capped so huge pages stay quick.
  const all = document.querySelectorAll("body *");
  for (let i = 0; i < all.length && i < 5000; i++) {
    const bg = getComputedStyle(all[i]).backgroundImage;
    if (bg && bg !== "none") for (const m of bg.matchAll(/url\(\s*["']?(.*?)["']?\s*\)/g)) add(m[1]);
  }
  return [...found.values()];
}

/** @type {{ url: string, w: number, h: number, alt: string, ext: string, broken: boolean, selected: boolean, state: string, error?: string, tile?: HTMLElement }[]} */
let images = [];
let tab;
let connected = false;
let saving = false;
let loading = true;
const offFormats = new Set();

const FORMAT_LABEL = { jpg: "JPEG", png: "PNG", gif: "GIF", webp: "WebP", svg: "SVG", avif: "AVIF", "": "その他" };
const formatOf = (img) => (img.ext in FORMAT_LABEL ? img.ext : "");

function passes(img) {
  if (img.broken) return false;
  const minW = Number($("min-w").value) || 0;
  const minH = Number($("min-h").value) || 0;
  if (img.w < minW || img.h < minH) return false;
  return !offFormats.has(formatOf(img));
}

const visible = () => images.filter(passes);
const chosen = () => visible().filter((i) => i.selected && i.state !== "ok");

function renderFormats() {
  const present = [...new Set(images.filter((i) => !i.broken).map(formatOf))];
  present.sort((a, b) => Object.keys(FORMAT_LABEL).indexOf(a) - Object.keys(FORMAT_LABEL).indexOf(b));
  $("formats").replaceChildren(
    ...present.map((f) => {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !offFormats.has(f);
      box.onchange = () => {
        if (box.checked) offFormats.delete(f);
        else offFormats.add(f);
        render();
      };
      label.append(box, FORMAT_LABEL[f]);
      return label;
    }),
  );
}

function tileFor(img) {
  if (img.tile) return img.tile;
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "tile";
  tile.title = img.alt ? `${img.alt}\n${img.url}` : img.url;
  const pic = document.createElement("div");
  pic.className = "pic";
  const el = document.createElement("img");
  el.src = img.url;
  el.loading = "lazy";
  el.alt = "";
  pic.append(el);
  const meta = document.createElement("div");
  meta.className = "meta";
  const check = document.createElement("span");
  check.className = "check";
  const state = document.createElement("span");
  state.className = "state";
  tile.append(pic, meta, check, state);
  tile.onclick = () => {
    if (saving) return;
    img.selected = !img.selected;
    render();
  };
  img.tile = tile;
  return tile;
}

function updateTile(img) {
  const tile = tileFor(img);
  tile.classList.toggle("selected", img.selected);
  tile.querySelector(".meta").textContent =
    `${img.w} × ${img.h}${img.ext ? ` · ${(FORMAT_LABEL[img.ext] ?? img.ext).toUpperCase()}` : ""}`;
  const state = tile.querySelector(".state");
  const labels = { ok: "保存済み", error: "失敗", busy: "保存中…", dup: "既存" };
  state.className = `state ${img.state === "dup" ? "ok" : img.state}`;
  state.textContent = labels[img.state] ?? "";
  state.title = img.error ?? "";
  state.hidden = !img.state;
}

function render() {
  const list = visible();
  for (const img of images) if (img.tile) updateTile(img);
  $("grid").replaceChildren(...list.map((img) => (updateTile(img), img.tile)));
  const hidden = images.filter((i) => !i.broken).length - list.length;
  const n = chosen().length;
  $("count").textContent =
    `${list.length} 件${hidden ? `（条件に合わない ${hidden} 件は非表示）` : ""}` + (n ? ` · ${n} 件を選択中` : "");
  $("save").textContent = n ? `${n} 件を保存` : "保存";
  $("save").disabled = !n || !connected || saving;
  $("empty").hidden = list.length > 0;
  $("empty").textContent = loading
    ? "画像を読み込んでいます…"
    : images.length
      ? "条件に合う画像がありません"
      : "画像が見つかりませんでした";
}

/** Fills in sizes the page didn't know (lazy images, srcset candidates, links, backgrounds). */
function measure(img) {
  if (img.w && img.h) return Promise.resolve();
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => {
      img.w = probe.naturalWidth;
      img.h = probe.naturalHeight;
      // SVG without a size: show it rather than hiding it as 0 × 0.
      if (!img.w && img.ext === "svg") img.w = img.h = 300;
      resolve();
    };
    probe.onerror = () => {
      img.broken = true;
      resolve();
    };
    probe.src = img.url;
  });
}

async function saveSelected() {
  const queue = chosen();
  if (!queue.length) return;
  saving = true;
  let ok = 0;
  let dup = 0;
  let failed = 0;
  for (const img of queue) img.state = "busy";
  render();
  const worker = async () => {
    for (let img = queue.shift(); img; img = queue.shift()) {
      try {
        const res = await saveImage(img.url, { tabId, pageUrl: tab.url, title: tab.title });
        img.state = res.imported ? "ok" : "dup";
        if (res.imported) ok++;
        else dup++;
        img.selected = false;
      } catch (e) {
        img.state = "error";
        img.error = e.message;
        failed++;
        if (e.status === 0 && /接続できません/.test(e.message)) {
          setStatus(e.message, "error");
        }
      }
      updateTile(img);
    }
  };
  // The app imports one at a time; a few downloads in parallel keep it busy.
  await Promise.all([worker(), worker(), worker()]);
  saving = false;
  const parts = ok || !dup ? [`${ok} 件を保存しました`] : [];
  if (dup) parts.push(`${dup} 件はすでにありました`);
  if (failed) parts.push(`${failed} 件は保存できませんでした（失敗の表示にマウスを重ねると理由が出ます）`);
  setStatus(parts.join(" / "), failed && !ok && !dup ? "error" : "ok");
  render();
}

function setStatus(text, kind = "") {
  $("status").className = `status ${kind}`;
  $("status").textContent = text;
}

$("min-w").oninput = $("min-h").oninput = render;
$("select-all").onclick = () => {
  for (const i of visible()) if (i.state !== "ok" && i.state !== "dup") i.selected = true;
  render();
};
$("select-none").onclick = () => {
  for (const i of images) i.selected = false;
  render();
};
$("save").onclick = saveSelected;

async function start() {
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    setStatus("元のタブが見つかりません（閉じられた可能性があります）", "error");
    loading = false;
    render();
    return;
  }
  $("page-title").textContent = tab.title || "ページの画像";
  $("page-url").textContent = tab.url ?? "";
  document.title = `${tab.title} の画像 - Image Library`;

  const connecting = (async () => {
    try {
      const info = await call("/info");
      if (!info.library) throw new Error("アプリでライブラリが開かれていません");
      await bindDestination({
        folderSelect: $("folder"),
        tagBox: $("tags"),
        tagInput: $("tag-input"),
        tagList: $("tag-list"),
      });
      $("dest").hidden = false;
      connected = true;
    } catch (e) {
      setStatus(e.message, "error");
    }
  })();

  let found = [];
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId }, func: gather });
    found = result ?? [];
  } catch (e) {
    setStatus(`このページの画像を読み取れません：${e.message}`, "error");
  }
  images = found.map((f) => ({ ...f, ext: guessExt(f.url), broken: false, selected: false, state: "" }));
  render();
  await Promise.all(images.map(measure));
  loading = false;
  renderFormats();
  await connecting;
  render();
}

start();
