import { bindDestination, call, getConfig } from "./shared.js";

const $ = (id) => document.getElementById(id);

if (navigator.userAgent.includes("Mac")) $("alt-key").textContent = "Option";

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const scriptable = /^(https?|file):/.test(tab?.url ?? "");
$("list").disabled = !scriptable;
$("capture").disabled = !tab || /^(chrome|edge|about|chrome-extension):/.test(tab.url ?? "");

$("list").onclick = () => {
  chrome.runtime.sendMessage({ type: "list-images", tab });
  window.close();
};
$("capture").onclick = () => {
  // The background worker saves it and reports in the page; the popup can close.
  chrome.runtime.sendMessage({ type: "capture", tab });
  window.close();
};

async function connect() {
  const status = $("status");
  status.className = "status";
  status.textContent = "接続を確認しています…";
  try {
    const info = await call("/info");
    if (!info.library) throw new Error("アプリでライブラリが開かれていません");
    status.className = "status ok";
    status.textContent = `接続中：${info.library}`;
    await bindDestination({
      folderSelect: $("folder"),
      tagBox: $("tags"),
      tagInput: $("tag-input"),
      tagList: $("tag-list"),
    });
    $("dest").hidden = false;
  } catch (e) {
    status.className = "status error";
    status.textContent = e.message;
    $("dest").hidden = true;
    if (e.status === 401) $("settings").open = true;
  }
}

const config = await getConfig();
if (config.fromApp) {
  $("settings-note").textContent = "接続キーはアプリが設定済みです。入力した値より、アプリの設定が優先されます。";
}
$("save-token").onclick = async () => {
  await chrome.storage.local.set({ token: $("token").value.trim() });
  $("token").value = "";
  connect();
};

connect();
