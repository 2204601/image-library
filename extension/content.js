// Alt+right-click (Option+right-click on a Mac) on an image saves it straight
// away, without the menu.
document.addEventListener(
  "contextmenu",
  (e) => {
    if (!e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
    const img = e.target instanceof Element ? e.target.closest("img") : null;
    const url = img?.currentSrc || img?.src;
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: "save-image", url }).catch(() => {});
  },
  true,
);
