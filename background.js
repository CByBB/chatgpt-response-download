chrome.runtime.onInstalled.addListener(() => {
  console.log("[cgpt-dl] extension installed/updated");
});

/** Fetch image (etc.) in the extension context — bypasses page CORS for data-URL inlining */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "cgpt-dl-fetch-data-url" || !msg.url) return;

  (async () => {
    try {
      const res = await fetch(msg.url, {
        credentials: "omit",
        cache: "force-cache",
        redirect: "follow",
      });
      if (!res.ok) {
        sendResponse({ ok: false, error: `HTTP ${res.status}` });
        return;
      }
      const blob = await res.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error("readAsDataURL failed"));
        reader.readAsDataURL(blob);
      });
      if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
        sendResponse({ ok: false, error: "invalid data url" });
        return;
      }
      sendResponse({ ok: true, dataUrl });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();

  return true; // async sendResponse
});

const CONTENT_SCRIPTS = [
  "js/util.js",
  "js/export/inline-styles.js",
  "js/export/polish.js",
  "js/export/widgets.js",
  "js/export/document.js",
  "js/export/pipeline.js",
  "js/ui.js",
  "js/boot.js",
];

async function injectIntoTab(tabId, url) {
  if (!url || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url)) {
    return;
  }
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"],
    });
  } catch {
    /* already inserted or restricted */
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPTS,
    });
  } catch (err) {
    console.warn("[cgpt-dl] inject failed", err);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    injectIntoTab(tabId, tab.url);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  await injectIntoTab(tab.id, tab.url || "");
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const id = "cgpt-dl-toast";
        let el = document.getElementById(id);
        if (!el) {
          el = document.createElement("div");
          el.id = id;
          el.style.cssText =
            "position:fixed;z-index:2147483647;right:16px;bottom:16px;padding:10px 14px;border-radius:10px;background:#10a37f;color:#fff;font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);";
          document.documentElement.appendChild(el);
        }
        const alive = Boolean(window.__CGPT_DL_ALIVE__);
        el.textContent = alive
          ? "ChatGPT Download is active — look for the circular download button on each reply."
          : "Injected. If the icon still missing, hard-refresh (Ctrl+Shift+R).";
        clearTimeout(el._t);
        el._t = setTimeout(() => el.remove(), 4000);
      },
    });
  } catch (err) {
    console.warn("[cgpt-dl] toast failed", err);
  }
});
