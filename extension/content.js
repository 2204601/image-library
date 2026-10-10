// Alt+right-click (Option+right-click on a Mac) on an image saves it straight
// away, without the menu.
document.addEventListener(
  "contextmenu",
  (e) => {
    // Only the user's own click: a page could otherwise dispatch a fake
    // Alt+right-click on any <img> and have its URL saved.
    if (!e.isTrusted) return;
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
