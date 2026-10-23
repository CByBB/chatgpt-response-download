(() => {
  "use strict";
  const D = (globalThis.__CGPT_DL__ = globalThis.__CGPT_DL__ || {});

  D.VERSION = "1.6.28";
  D.MARK = "data-cgpt-dl";
  D.BTN_CLASS = "cgpt-dl-btn";
  D.LAYER_ID = "cgpt-dl-layer";
  D.DEBUG = false;

  D.DOWNLOAD_ICON = `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="icon-sm">
      <path d="M10 2.5a.75.75 0 0 1 .75.75v7.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V3.25A.75.75 0 0 1 10 2.5Z"/>
      <path d="M3.5 12.75a.75.75 0 0 1 .75.75v1.5c0 .69.56 1.25 1.25 1.25h9c.69 0 1.25-.56 1.25-1.25v-1.5a.75.75 0 0 1 1.5 0v1.5A2.75 2.75 0 0 1 14.5 17.5h-9A2.75 2.75 0 0 1 2.75 14.75v-1.5a.75.75 0 0 1 .75-.75Z"/>
    </svg>
  `;
  D.CHECK_ICON = `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" class="icon-sm">
      <path d="M4.5 10.5l3.5 3.5 7.5-7.5" stroke="currentColor" stroke-width="1.75"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  D.LOADING_ICON = `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" class="icon-sm cgpt-dl-spin">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" stroke-width="1.75"
        stroke-linecap="round" stroke-dasharray="34 20"/>
    </svg>
  `;

  D.SKIP_PROPS = new Set([
    "animation-delay","animation-direction","animation-duration","animation-fill-mode",
    "animation-iteration-count","animation-name","animation-play-state","animation-timing-function",
    "transition-delay","transition-duration","transition-property","transition-timing-function",
    "cursor","caret-color","user-select","pointer-events","-webkit-user-select",
    "offset-path","offset-distance","offset-rotate",
  ]);

  D.qs = (root, selector) => root.querySelector(selector);
  D.qsa = (root, selector) => Array.from(root.querySelectorAll(selector));
  D.deepQsa = function deepQsa(selector, root = document) {
    const results = [];
    const visit = (node) => {
      if (!node) return;
      if (node.querySelectorAll) {
        try {
          results.push(...node.querySelectorAll(selector));
        } catch {
          /* invalid selector in some roots */
        }
      }
      const all = node.querySelectorAll ? node.querySelectorAll("*") : [];
      for (const el of all) {
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(root);
    return results;
  };
  D.labelOf = (el) =>
    (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.getAttribute("data-testid") ||
      el.textContent ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
  D.log = (...args) => {
    if (D.DEBUG) console.log("[cgpt-dl]", ...args);
  };
  D.nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  D.slugify = (text) => {
    const s = String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    return s || "chatgpt-response";
  };
  D.timestamp = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  };
  D.escapeHtml = (str) =>
    String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  D.setImportant = (el, prop, value) => {
    try {
      el.style.setProperty(prop, value, "important");
    } catch {
      el.style[prop] = value;
    }
  };
  D.isDarkTheme = () => {
    const html = document.documentElement;
    if (getComputedStyle(html).colorScheme === "dark") return true;
    if (html.classList.contains("dark") || html.dataset.theme === "dark") return true;
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return window.matchMedia("(prefers-color-scheme: dark)").matches;
    const luminance =
      (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
    return luminance < 0.45;
  };
  D.pageChrome = (content) => {
    const bodyCs = getComputedStyle(document.body);
    const htmlCs = getComputedStyle(document.documentElement);
    const contentCs = content ? getComputedStyle(content) : bodyCs;
    const tokenMax =
      contentCs.getPropertyValue("--thread-content-max-width").trim() ||
      htmlCs.getPropertyValue("--thread-content-max-width").trim();
    return {
      bg: bodyCs.backgroundColor || htmlCs.backgroundColor || "#212121",
      fg: contentCs.color || bodyCs.color || "#ececec",
      font:
        contentCs.fontFamily ||
        bodyCs.fontFamily ||
        'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      lineHeight: contentCs.lineHeight || "1.6",
      fontSize: contentCs.fontSize || "16px",
      contentMaxWidth: tokenMax && tokenMax !== "0px" ? tokenMax : "48rem",
    };
  };
  D.childIndexPath = (root, node) => {
    const path = [];
    let cur = node;
    while (cur && cur !== root) {
      const parent = cur.parentElement;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.children, cur));
      cur = parent;
    }
    return cur === root ? path : null;
  };
  D.nodeFromPath = (root, path) => {
    let cur = root;
    for (const idx of path) {
      if (!cur?.children?.[idx]) return null;
      cur = cur.children[idx];
    }
    return cur;
  };
})();
