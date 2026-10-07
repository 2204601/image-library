// In-app updates via tauri-plugin-updater.
//
// The installers are not Apple / Windows code-signed, so a freshly downloaded
// .dmg / .exe triggers Gatekeeper / SmartScreen every time. Files written by the
// app itself carry no quarantine attribute, so an update applied from inside the
// app launches without that warning. Only the first install still shows it.
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useStore } from "../store";

const st = () => useStore.getState();

let version = "";
/** Current app version; empty until `loadAppVersion` resolves (and in the browser mock). */
export const appVersion = () => (version ? `v${version}` : "");

export async function loadAppVersion() {
  if (!isTauri()) return;
  try {
    version = await getVersion();
  } catch {
    /* dev mock */
  }
}

let busy = false;

/**
 * Check GitHub Releases for a newer version. `manual` reports "up to date" and
 * errors; the automatic startup check stays silent unless an update exists.
 */
export async function checkForUpdate(manual: boolean) {
  if (busy) return;
  if (!isTauri()) {
    if (manual) st().toast("ブラウザ版ではアップデートを確認できません", true);
    return;
  }
  busy = true;
  try {
    const update = await check({ timeout: 15_000 });
    if (!update) {
      if (manual) st().toast(`最新版です（${appVersion()}）`);
      return;
    }
    await offer(update);
  } catch (e) {
    if (manual) st().toast(`アップデートの確認に失敗しました：${String(e)}`, true);
    else console.warn("update check failed", e);
  } finally {
    busy = false;
  }
}

async function offer(update: Update) {
  const notes = update.body?.trim();
  const ok = await ask(
    `新しいバージョン v${update.version} があります（現在 v${update.currentVersion}）。` +
      (notes ? `\n\n${notes.slice(0, 600)}` : "") +
      "\n\nダウンロードして再起動しますか？",
    { title: "アップデート", kind: "info", okLabel: "更新して再起動", cancelLabel: "あとで" },
  );
  if (!ok) return;

  let done = 0;
  let total: number | null = null;
  st().setUpdating({ done, total });
  try {
    await update.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? null;
      else if (ev.event === "Progress") done += ev.data.chunkLength;
      else if (ev.event === "Finished") done = total ?? done;
      st().setUpdating({ done, total });
    });
  } catch (e) {
    st().setUpdating(null);
    await message(`アップデートに失敗しました。\n${String(e)}`, { title: "アップデート", kind: "error" });
    return;
  }
  st().setUpdating(null);
  // Windows: the installer has already asked the app to exit by now; relaunch is
  // a no-op there. macOS: the .app was swapped in place, restart to pick it up.
  await relaunch();
}

/** Check a few seconds after launch in release builds. Returns a cleanup. */
export function scheduleUpdateCheck(): () => void {
  if (import.meta.env.DEV || !isTauri()) return () => {};
  const t = setTimeout(() => checkForUpdate(false), 4000);
  return () => clearTimeout(t);
}
