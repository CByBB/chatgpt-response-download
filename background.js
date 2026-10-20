chrome.runtime.onInstalled.addListener(() => {
  console.log("[cgpt-dl] extension installed/updated");
});

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
      files: ["content.js"],
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
