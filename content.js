(() => {
  "use strict";

  const VERSION = "1.6.4";
  // Allow reinject after extension reload / version bump
  if (globalThis.__CGPT_DL_BOOTED__ === VERSION) {
    globalThis.__CGPT_DL_ALIVE__ = true;
    return;
  }
  // Tear down previous version if any
  try {
    document.getElementById("cgpt-dl-layer")?.remove();
    document.querySelectorAll('span[data-cgpt-dl="wrap"], .cgpt-dl-btn').forEach((el) => {
      if (!el.closest?.("#cgpt-dl-layer")) el.remove();
    });
    document.querySelectorAll("[data-cgpt-dl-hide='1']").forEach((el) => {
      el.style.visibility = el.getAttribute("data-cgpt-dl-prev-vis") || "";
      el.style.pointerEvents = el.getAttribute("data-cgpt-dl-prev-pe") || "";
      el.removeAttribute("data-cgpt-dl-hide");
      el.removeAttribute("data-cgpt-dl-prev-vis");
      el.removeAttribute("data-cgpt-dl-prev-pe");
    });
  } catch {
    /* ignore */
  }
  globalThis.__CGPT_DL_BOOTED__ = VERSION;
  globalThis.__CGPT_DL_ALIVE__ = true;

  // Skip empty iframes (they were logging turns=0 and looking like failure)
  const isTop = window === window.top;
  const looksLikeChat =
    /\/(c|share|g)\//.test(location.pathname) ||
    Boolean(document.querySelector("main")) ||
    Boolean(document.querySelector('[data-testid^="conversation-turn-"]')) ||
    Boolean(document.querySelector("[data-markdown-text-style], [data-chatgpt-search-unit-key]"));
  if (!isTop && !looksLikeChat) {
    return;
  }

  const MARK = "data-cgpt-dl";
  const BTN_CLASS = "cgpt-dl-btn";
  const LAYER_ID = "cgpt-dl-layer";
  const DEBUG = false;

  // 20×20 filled glyph — closer to ChatGPT action icons than a thin stroke
  const DOWNLOAD_ICON = `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="icon-sm">
      <path d="M10 2.5a.75.75 0 0 1 .75.75v7.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V3.25A.75.75 0 0 1 10 2.5Z"/>
      <path d="M3.5 12.75a.75.75 0 0 1 .75.75v1.5c0 .69.56 1.25 1.25 1.25h9c.69 0 1.25-.56 1.25-1.25v-1.5a.75.75 0 0 1 1.5 0v1.5A2.75 2.75 0 0 1 14.5 17.5h-9A2.75 2.75 0 0 1 2.75 14.75v-1.5a.75.75 0 0 1 .75-.75Z"/>
    </svg>
  `;

  const CHECK_ICON = `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" class="icon-sm">
      <path d="M4.5 10.5l3.5 3.5 7.5-7.5" stroke="currentColor" stroke-width="1.75"
        stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  const LOADING_ICON = `
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" class="icon-sm cgpt-dl-spin">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" stroke-width="1.75"
        stroke-linecap="round" stroke-dasharray="34 20"/>
    </svg>
  `;

  // Do NOT skip position/inset — email writing-blocks, tables, and grids need them.
  // Only skip interaction / motion noise.
  const SKIP_PROPS = new Set([
    "animation-delay",
    "animation-direction",
    "animation-duration",
    "animation-fill-mode",
    "animation-iteration-count",
    "animation-name",
    "animation-play-state",
    "animation-timing-function",
    "transition-delay",
    "transition-duration",
    "transition-property",
    "transition-timing-function",
    "cursor",
    "caret-color",
    "user-select",
    "pointer-events",
    "-webkit-user-select",
    "offset-path",
    "offset-distance",
    "offset-rotate",
  ]);

  /** @type {Map<string, { btn: HTMLButtonElement, turn: Element, content: Element, copy: Element | null }>} */
  const buttonMap = new Map();
  let layer = null;
  let lastDiag = "";
  let missingTurnStreak = 0;

  function qs(root, selector) {
    return root.querySelector(selector);
  }

  function qsa(root, selector) {
    return Array.from(root.querySelectorAll(selector));
  }

  /** Deep querySelectorAll that also walks open shadow roots */
  function deepQsa(selector, root = document) {
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
  }

  function labelOf(el) {
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.getAttribute("data-testid") ||
      ""
    ).trim();
  }

  function ensureLayer() {
    if (layer && document.documentElement.contains(layer)) return layer;
    layer = document.getElementById(LAYER_ID);
    if (!layer) {
      layer = document.createElement("div");
      layer.id = LAYER_ID;
      layer.setAttribute(MARK, "layer");
      document.documentElement.appendChild(layer);
    }
    return layer;
  }

  function log(...args) {
    if (DEBUG) console.debug("[cgpt-dl]", ...args);
  }

  function searchUnitKey(el) {
    return (
      el?.getAttribute?.("data-chatgpt-search-unit-key") ||
      el?.getAttribute?.("data-content-search-unit-key") ||
      ""
    );
  }

  function isAssistantUnitKey(key) {
    return /:assistant(?:$|\b)/.test(key);
  }

  /** Normalize to the outer assistant turn wrapper for both old + current ChatGPT UIs */
  function normalizeAssistantTurn(el) {
    if (!el) return null;

    // Current logged-in UI (from Ctrl+S snapshot)
    const unit =
      el.closest?.("[data-chatgpt-search-unit-key]") ||
      el.closest?.("[data-content-search-unit-key]");
    if (unit && isAssistantUnitKey(searchUnitKey(unit))) return unit;

    if (el.getAttribute?.("data-markdown-text-style") === "assistant-message") {
      return (
        el.closest("[data-chatgpt-search-unit-key], [data-content-search-unit-key]") ||
        el.closest("[data-chatgpt-selection-message-id]")?.parentElement ||
        el.closest(".block-BQZwFn, [class*='block-']") ||
        el
      );
    }

    if (el.getAttribute?.("data-conversation-role") === "assistant") {
      return el.parentElement || el;
    }

    if (el.hasAttribute?.("data-chatgpt-agent-turn-start")) {
      return el.parentElement || el;
    }

    if (el.getAttribute?.("data-chatgpt-selection-message-id")) {
      return (
        el.closest("[data-chatgpt-search-unit-key], [data-content-search-unit-key]") || el
      );
    }

    // Older / share-page UI
    const section =
      el.closest?.('section[data-turn="assistant"]') ||
      el.closest?.('[data-testid^="conversation-turn-"][data-turn="assistant"]');
    if (section) return section;

    if (el.getAttribute?.("data-message-author-role") === "assistant") {
      return (
        el.closest('[data-testid^="conversation-turn-"]') ||
        el.closest("section") ||
        el
      );
    }
    if (el.getAttribute?.("data-turn") === "assistant") return el;

    return null;
  }

  function isAssistantTurn(el) {
    if (!el) return false;
    if (isAssistantUnitKey(searchUnitKey(el))) return true;
    if (el.getAttribute("data-turn") === "assistant") return true;
    if (el.getAttribute("data-message-author-role") === "assistant") return true;
    if (el.getAttribute("data-conversation-role") === "assistant") return true;
    if (el.getAttribute("data-markdown-text-style") === "assistant-message") return true;
    if (qs(el, '[data-markdown-text-style="assistant-message"]')) return true;
    if (qs(el, '[data-message-author-role="assistant"]')) return true;
    if (qs(el, '[data-conversation-role="assistant"]')) return true;
    return false;
  }

  function turnKey(turn, index) {
    return (
      turn.getAttribute("data-chatgpt-selection-message-id") ||
      qs(turn, "[data-chatgpt-selection-message-id]")?.getAttribute(
        "data-chatgpt-selection-message-id"
      ) ||
      searchUnitKey(turn) ||
      turn.getAttribute("data-testid") ||
      turn.getAttribute("data-turn-id") ||
      turn.getAttribute("data-message-id") ||
      qs(turn, "[data-message-id]")?.getAttribute("data-message-id") ||
      `anon-${index}`
    );
  }

  function isCodeCopyButton(btn) {
    const label = labelOf(btn);
    const testId = btn.getAttribute("data-testid") || "";
    if (/copy.?code|code.?copy|copy table/i.test(label + " " + testId)) return true;
    // Current ChatGPT: code/writing blocks often lack data-code-block — detect via surface.
    // Avoid broad class*=writing-block (matches has-data-writing-* on whole turns).
    if (
      btn.closest(
        [
          "[data-code-block]",
          "[data-markdown-copy='code-block']",
          "[data-markdown-table]",
          "[data-testid='writing-block-container']",
          "[data-testid='writing-block-header-surface']",
          "[data-testid*='code-block']",
          "pre",
          ".cm-editor",
          "[class*='code-block-surface']",
        ].join(", ")
      )
    ) {
      return /copy/i.test(label);
    }
    return false;
  }

  function toolbarLabels(fromBtn) {
    let node = fromBtn.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      // Stop before the whole message unit — climbing that high makes code-block
      // "Copy" look like it shares a toolbar with footer Share / Read aloud.
      if (
        node.matches?.(
          '[data-chatgpt-search-unit-key], [data-content-search-unit-key], [data-turn], [data-testid^="conversation-turn-"], [data-message-author-role], [data-markdown-text-style="assistant-message"]'
        )
      ) {
        break;
      }
      const buttons = qsa(node, "button[aria-label]");
      // Real action bars are small; huge node queries are false friends
      if (buttons.length < 2 || buttons.length > 14) continue;
      const labels = buttons.map(labelOf);
      if (
        labels.some((l) => /^(share|read aloud|more actions|regenerate response)$/i.test(l)) ||
        (labels.filter((l) => /^copy$/i.test(l)).length &&
          labels.some((l) => /^(good response|bad response)$/i.test(l)))
      ) {
        return labels;
      }
    }
    return [];
  }

  /** Assistant reply copy only — not user "Copy message", not code/table copy */
  function isAssistantCopyButton(btn) {
    if (!(btn instanceof HTMLElement)) return false;
    if (btn.classList.contains(BTN_CLASS)) return false;
    if (isCodeCopyButton(btn)) return false;

    const label = labelOf(btn);
    if (/copy message/i.test(label)) return false;

    const inAssistant = Boolean(
      btn.closest('[data-turn="assistant"]') ||
        btn.closest('[data-message-author-role="assistant"]') ||
        btn.closest('[data-chatgpt-search-unit-key*=":assistant"]') ||
        btn.closest('[data-content-search-unit-key*=":assistant"]') ||
        btn.closest('[data-markdown-text-style="assistant-message"]') ||
        btn.closest('[data-conversation-role="assistant"]')?.parentElement ||
        btn.closest(".turn-action-controls")
    );

    const testId = btn.getAttribute("data-testid") || "";
    if (testId === "copy-turn-action-button") {
      return inAssistant || /copy response/i.test(label);
    }

    if (/copy response/i.test(label)) return true;
    if (/复制回复|응답 복사/.test(label)) return true;

    // Current UI: bare "Copy" only in the turn action bar (with Share / Read aloud / …)
    if (/^copy$/i.test(label)) {
      if (btn.closest(".turn-action-controls")) return true;
      const labels = toolbarLabels(btn);
      if (labels.some((l) => /^(share|read aloud|more actions|regenerate response)$/i.test(l))) {
        return true;
      }
    }
    return false;
  }

  function findContentNear(turn) {
    if (!turn) return null;
    return (
      qs(turn, '[data-markdown-text-style="assistant-message"]') ||
      qs(turn, '[class*="MarkdownRoot"]') ||
      qs(turn, '[data-message-author-role="assistant"] .markdown') ||
      qs(turn, '[data-message-author-role="assistant"] .prose') ||
      qs(turn, '[data-message-author-role="assistant"]') ||
      qs(turn, ".markdown") ||
      qs(turn, ".prose") ||
      qs(turn, '[class*="markdown"]') ||
      turn
    );
  }

  function findAssistantTurns() {
    const turns = [];
    const seen = new Set();

    const push = (raw) => {
      const el = normalizeAssistantTurn(raw) || (isAssistantTurn(raw) ? raw : null);
      if (!el || seen.has(el)) return;

      const nested = [];
      for (const s of seen) {
        if (s.contains(el)) return;
        if (el.contains(s)) nested.push(s);
      }
      nested.forEach((s) => {
        seen.delete(s);
        const idx = turns.indexOf(s);
        if (idx >= 0) turns.splice(idx, 1);
      });

      seen.add(el);
      turns.push(el);
    };

    // Current logged-in UI
    deepQsa(
      '[data-chatgpt-search-unit-key*=":assistant"], [data-content-search-unit-key*=":assistant"]'
    ).forEach(push);
    deepQsa('[data-markdown-text-style="assistant-message"]').forEach(push);
    deepQsa('[data-conversation-role="assistant"]').forEach(push);
    deepQsa("[data-chatgpt-agent-turn-start]").forEach(push);
    deepQsa("[data-chatgpt-selection-message-id]").forEach((el) => {
      // selection id exists on assistant message wrappers in current UI
      if (qs(el, '[data-markdown-text-style="assistant-message"]') || el.closest('[data-chatgpt-search-unit-key*=":assistant"]')) {
        push(el);
      }
    });

    // Older / share-page UI
    deepQsa(
      'section[data-turn="assistant"], [data-testid^="conversation-turn-"][data-turn="assistant"]'
    ).forEach(push);
    deepQsa('[data-message-author-role="assistant"]').forEach(push);

    // Action-bar anchor (both UIs)
    deepQsa(
      'button[data-testid="copy-turn-action-button"], button[aria-label="Copy response"], button[aria-label="Copy"]'
    ).forEach((btn) => {
      if (!isAssistantCopyButton(btn)) return;
      push(
        btn.closest("[data-chatgpt-search-unit-key], [data-content-search-unit-key]") ||
          btn.closest('section[data-turn="assistant"], [data-testid^="conversation-turn-"]') ||
          btn.closest("[data-chatgpt-selection-message-id]") ||
          btn
      );
    });

    return turns;
  }

  function findContentRoot(turn) {
    return findContentNear(turn);
  }

  function actionBarIsAssistant(bar) {
    const labels = qsa(bar, "button[aria-label]").map(labelOf);
    if (labels.some((l) => /copy message|edit message/i.test(l))) return false;
    return labels.some(
      (l) =>
        /^copy$/i.test(l) ||
        /copy response/i.test(l) ||
        /^(share|read aloud|regenerate response)$/i.test(l)
    );
  }

  /**
   * Logged-in UI: Copy lives in `.turn-action-controls` after the message unit —
   * often a sibling of an ancestor (not of the unit itself).
   */
  function findTurnActionControls(turn) {
    if (!turn) return null;

    let node = turn;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      let sib = node.nextElementSibling;
      for (let i = 0; sib && i < 4; i++, sib = sib.nextElementSibling) {
        const bar = sib.matches?.(".turn-action-controls")
          ? sib
          : sib.querySelector?.(".turn-action-controls");
        if (bar && actionBarIsAssistant(bar)) return bar;
      }
    }
    return null;
  }

  function pickBestCopy(candidates) {
    const list = candidates.filter(Boolean);
    if (!list.length) return null;
    // Prefer the turn-action / "Copy response" control; never a mid-body code Copy
    const ranked = list.filter(isAssistantCopyButton);
    if (!ranked.length) return null;
    const preferred = ranked.find(
      (btn) =>
        btn.getAttribute("data-testid") === "copy-turn-action-button" ||
        /copy response/i.test(labelOf(btn)) ||
        btn.closest(".turn-action-controls")
    );
    // Last match wins — action bar is below content; first match is often a code Copy
    return preferred || ranked[ranked.length - 1];
  }

  function findCopyInTurn(turn) {
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING || 4;

    // 1) Explicit action-controls bar (current logged-in ChatGPT)
    const bar = findTurnActionControls(turn);
    if (bar) {
      const fromBar = pickBestCopy(qsa(bar, "button, [role='button']"));
      if (fromBar) return fromBar;
    }

    // 2) Inside turn — share page / older UI (Copy response is inside the section)
    const localCandidates = qsa(turn, "button, [role='button']").filter(isAssistantCopyButton);
    const localPreferred = localCandidates.find(
      (btn) =>
        btn.getAttribute("data-testid") === "copy-turn-action-button" ||
        /copy response/i.test(labelOf(btn))
    );
    if (localPreferred) return localPreferred;
    if (localCandidates.length === 1) return localCandidates[0];

    // 3) Parent scope by DOM proximity
    let scope = turn.parentElement;
    for (let i = 0; scope && i < 5; i++, scope = scope.parentElement) {
      const candidates = qsa(scope, "button[aria-label], button[data-testid]").filter(
        isAssistantCopyButton
      );
      const following = candidates.filter(
        (btn) => turn.contains(btn) || turn.compareDocumentPosition(btn) & FOLLOWING
      );
      const pick = pickBestCopy(following);
      if (!pick) continue;

      if (pick.closest(".turn-action-controls") || turn.contains(pick)) return pick;

      const turnRect = turn.getBoundingClientRect();
      const copyRect = pick.getBoundingClientRect();
      if (!copyRect.width && !copyRect.height) continue;
      const verticallyNear =
        copyRect.top >= turnRect.top - 8 && copyRect.top <= turnRect.bottom + 120;
      const horizontallyNear =
        Math.abs(copyRect.left - turnRect.left) < Math.max(turnRect.width, 1) + 40;
      if (verticallyNear && horizontallyNear) return pick;
    }

    // 4) Global assistant copies following this turn
    const copies = deepQsa(
      'button[data-testid="copy-turn-action-button"], button[aria-label="Copy response"], button[aria-label="Copy"]'
    ).filter(isAssistantCopyButton);
    const following = copies.filter(
      (copy) => turn.contains(copy) || turn.compareDocumentPosition(copy) & FOLLOWING
    );
    return (
      pickBestCopy(following.filter((copy) => copy.closest(".turn-action-controls"))) ||
      pickBestCopy(following)
    );
  }

  function slugify(text) {
    return (
      text
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60)
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .toLowerCase() || "chatgpt-response"
    );
  }

  function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function pageChrome(content) {
    const bodyCs = getComputedStyle(document.body);
    const htmlCs = getComputedStyle(document.documentElement);
    const contentCs = content ? getComputedStyle(content) : bodyCs;
    // Prefer ChatGPT's thread max-width token when present; never freeze a tiny measured width
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
  }

  function isDarkTheme() {
    const html = document.documentElement;
    if (getComputedStyle(html).colorScheme === "dark") return true;
    if (html.classList.contains("dark") || html.dataset.theme === "dark") return true;
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return window.matchMedia("(prefers-color-scheme: dark)").matches;
    const luminance =
      (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
    return luminance < 0.45;
  }

  function collectCssVariables(el) {
    const vars = {};
    let node = el;
    while (node && node.nodeType === 1) {
      const style = getComputedStyle(node);
      for (let i = 0; i < style.length; i++) {
        const name = style[i];
        if (name.startsWith("--") && !(name in vars)) {
          vars[name] = style.getPropertyValue(name).trim();
        }
      }
      node = node.parentElement;
    }
    const rootStyle = getComputedStyle(document.documentElement);
    for (let i = 0; i < rootStyle.length; i++) {
      const name = rootStyle[i];
      if (name.startsWith("--") && !(name in vars)) {
        vars[name] = rootStyle.getPropertyValue(name).trim();
      }
    }
    return vars;
  }

  function cssVarsBlock(vars) {
    return Object.entries(vars)
      .filter(([, v]) => v)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join("\n");
  }

  // Properties that must stay even when they match the browser default
  const KEEP_ALWAYS = new Set([
    "color",
    "background",
    "background-color",
    "background-image",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "white-space",
    "word-break",
    "overflow-wrap",
    "text-align",
    "text-decoration",
    "border",
    "border-collapse",
    "border-spacing",
    "border-radius",
    "padding",
    "margin",
    "display",
    "position",
    "top",
    "right",
    "bottom",
    "left",
    "inset",
    "z-index",
    "flex",
    "flex-direction",
    "flex-wrap",
    "gap",
    "row-gap",
    "column-gap",
    "grid",
    "grid-template-columns",
    "grid-template-rows",
    "grid-column",
    "grid-row",
    "align-items",
    "justify-content",
    "justify-items",
    "place-items",
    "table-layout",
    "vertical-align",
    "opacity",
    "box-shadow",
    "outline",
    "contain",
    "isolation",
    "fill",
    "stroke",
  ]);

  const SIZE_PROPS = new Set([
    "width",
    "height",
    "max-width",
    "min-width",
    "max-height",
    "min-height",
    "inline-size",
    "block-size",
  ]);

  function isMediaElement(el) {
    return /^(IMG|SVG|CANVAS|VIDEO|IFRAME|PROGRESS|METER|PATH|RECT|CIRCLE|G|USE)$/i.test(
      el?.tagName || ""
    );
  }

  function shouldInlineProp(name, value, defaults, sourceEl) {
    if (!value || SKIP_PROPS.has(name)) return false;
    if (
      (value === "none" || value === "normal" || value === "auto") &&
      (name === "box-shadow" ||
        name === "text-decoration" ||
        name === "background-image" ||
        name === "transform" ||
        name === "filter")
    ) {
      return false;
    }
    // Freezing ChatGPT's px widths/heights into the export causes a narrow column
    // and scrollport tables / overflowing code blocks.
    if (SIZE_PROPS.has(name) && sourceEl && !isMediaElement(sourceEl)) {
      const v = value.trim();
      if (/px$/i.test(v) || /^[0-9.]+$/.test(v)) return false;
    }
    if (
      defaults &&
      !KEEP_ALWAYS.has(name) &&
      !name.startsWith("border") &&
      !name.startsWith("padding") &&
      !name.startsWith("margin") &&
      !name.startsWith("font") &&
      defaults.getPropertyValue(name) === value
    ) {
      return false;
    }
    return true;
  }

  function inlineOneNode(source, clone, defaults) {
    if (source.nodeType !== 1 || clone.nodeType !== 1) return;
    const computed = getComputedStyle(source);
    const parts = [];

    // Preserve CSS variables — writing-blocks / grids / tables depend on --oai-wb-* etc.
    const vars = new Map();
    const inlineAttr = source.getAttribute("style") || "";
    inlineAttr.split(";").forEach((chunk) => {
      const t = chunk.trim();
      if (!t.startsWith("--")) return;
      const i = t.indexOf(":");
      if (i > 0) vars.set(t.slice(0, i).trim(), t.slice(i + 1).trim());
    });
    for (let i = 0; i < computed.length; i++) {
      const name = computed[i];
      if (!name.startsWith("--")) continue;
      const value = computed.getPropertyValue(name).trim();
      if (value) vars.set(name, value);
    }
    for (const [k, v] of vars) parts.push(`${k}:${v}`);

    for (let i = 0; i < computed.length; i++) {
      const name = computed[i];
      if (name.startsWith("--")) continue;
      const value = computed.getPropertyValue(name);
      if (shouldInlineProp(name, value, defaults, source)) parts.push(`${name}:${value}`);
    }

    // Sticky headers / fixed chrome break offline docs — pin them into normal flow.
    // Keep relative/absolute (email frames, table overlays, grid cards need them).
    const pos = computed.position;
    if (pos === "sticky") {
      parts.push("position:relative");
      parts.push("top:auto");
    } else if (pos === "fixed") {
      parts.push("position:absolute");
    }

    if (parts.length) clone.setAttribute("style", parts.join(";"));
  }

  function inlineComputedStyles(source, clone, defaults) {
    if (source.nodeType !== 1 || clone.nodeType !== 1) return;
    inlineOneNode(source, clone, defaults);
    const srcChildren = source.children;
    const cloneChildren = clone.children;
    const len = Math.min(srcChildren.length, cloneChildren.length);
    for (let i = 0; i < len; i++) inlineComputedStyles(srcChildren[i], cloneChildren[i], defaults);
  }

  /** Same walk as inlineComputedStyles but yields so the tab stays responsive */
  async function inlineComputedStylesAsync(source, clone, defaults) {
    let visited = 0;
    async function walk(src, dst) {
      if (src.nodeType !== 1 || dst.nodeType !== 1) return;
      inlineOneNode(src, dst, defaults);
      visited += 1;
      if (visited % 50 === 0) await nextFrame();
      const srcKids = src.children;
      const dstKids = dst.children;
      const len = Math.min(srcKids.length, dstKids.length);
      for (let i = 0; i < len; i++) await walk(srcKids[i], dstKids[i]);
    }
    await walk(source, clone);
  }

  /** Make the export fluid — undo ChatGPT column / scrollport constraints */
  function normalizeExportLayout(cloneRoot) {
    if (!(cloneRoot instanceof HTMLElement)) return;

    cloneRoot.style.width = "100%";
    cloneRoot.style.maxWidth = "100%";
    cloneRoot.style.minWidth = "0";
    cloneRoot.style.marginLeft = "0";
    cloneRoot.style.marginRight = "0";
    cloneRoot.style.boxSizing = "border-box";

    qsa(
      cloneRoot,
      '[data-markdown-table], [class*="TableContainer"], [class*="TableScroller"], [class*="TableWrapper"], [class*="TableFrame"]'
    ).forEach((el) => {
      el.style.width = "100%";
      el.style.maxWidth = "100%";
      el.style.minWidth = "0";
      el.style.height = "auto";
      el.style.maxHeight = "none";
      el.style.overflow = "visible";
      el.style.overflowX = "auto";
      el.style.overflowY = "visible";
      el.style.contain = "none";
    });

    qsa(cloneRoot, "table").forEach((el) => {
      el.style.width = "100%";
      el.style.maxWidth = "100%";
      el.style.height = "auto";
      el.style.display = "table";
    });

    qsa(
      cloneRoot,
      '[data-code-block], pre, [class*="CodeBlock"], [class*="code-block"], [class*="CodeSurface"]'
    ).forEach((el) => {
      el.style.width = "100%";
      el.style.maxWidth = "100%";
      el.style.minWidth = "0";
      el.style.boxSizing = "border-box";
      el.style.overflowX = "auto";
    });

    qsa(cloneRoot, '[data-wide-block], [class*="chatgptPaletteBoundary"]').forEach((el) => {
      el.style.width = "100%";
      el.style.maxWidth = "100%";
      el.style.minWidth = "0";
      el.style.marginLeft = "0";
      el.style.marginRight = "0";
    });
  }

  /** Same-origin CSS (fonts + markdown / widget rules) that survived CORS */
  function collectAuthorCssText() {
    const chunks = [];
    const interesting =
      /markdown|prose|code|pre|table|Table|Grid|Box|Heading|Paragraph|List|mermaid|hljs|token|CodeBlock|Root-|writing|ProseMirror|timeline|Timeline|kanban|dialog|frame-/i;
    try {
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // cross-origin
        }
        if (!rules) continue;
        for (const rule of rules) {
          const text = rule.cssText || "";
          if (!text) continue;
          if (rule.type === CSSRule.FONT_FACE_RULE || rule.type === CSSRule.KEYFRAMES_RULE) {
            chunks.push(text);
            continue;
          }
          if (rule.type === CSSRule.STYLE_RULE && interesting.test(rule.selectorText || "")) {
            chunks.push(text);
          }
        }
      }
    } catch {
      /* ignore */
    }
    const joined = chunks.join("\n");
    return joined.length > 180000 ? joined.slice(0, 180000) : joined;
  }

  async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function inlineImages(cloneRoot) {
    await Promise.all(
      qsa(cloneRoot, "img[src]").map(async (img) => {
        const src = img.getAttribute("src");
        if (!src || src.startsWith("data:")) return;
        try {
          const abs = new URL(src, location.href).href;
          const res = await fetch(abs, { credentials: "include" });
          if (!res.ok) {
            img.setAttribute("src", abs);
            return;
          }
          img.setAttribute("src", await blobToDataUrl(await res.blob()));
        } catch {
          try {
            img.setAttribute("src", new URL(src, location.href).href);
          } catch {
            /* keep */
          }
        }
      })
    );
  }

  function childIndexPath(root, node) {
    const path = [];
    let cur = node;
    while (cur && cur !== root) {
      const parent = cur.parentElement;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.children, cur));
      cur = parent;
    }
    return cur === root ? path : null;
  }

  function nodeFromPath(root, path) {
    let cur = root;
    for (const idx of path) {
      if (!cur?.children?.[idx]) return null;
      cur = cur.children[idx];
    }
    return cur;
  }

  /**
   * Briefly wait for in-viewport client renders. Does NOT scroll the page —
   * scrolling was freezing/jumping the chat during export.
   */
  async function waitForClientRender(root, timeoutMs = 600) {
    await nextFrame();
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const loading = qsa(root, '[aria-label*="Loading" i], [class*="Placeholder"]').filter((el) => {
        const label = (el.getAttribute("aria-label") || "").toLowerCase();
        if (!/loading|mermaid|diagram|chart/i.test(label) && !/Placeholder/i.test(el.className || "")) {
          return false;
        }
        const r = el.getBoundingClientRect();
        // Only care about widgets already on screen
        return r.width > 24 && r.height > 24 && r.bottom > 0 && r.top < window.innerHeight;
      });
      if (!loading.length) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  function isIconSvg(svg) {
    const r = svg.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40)) return true;
    if (svg.closest("button, a, [role='button']")) return true;
    const vb = svg.getAttribute("viewBox") || "";
    return /^0 0 16 16$|^0 0 20 20$|^0 0 24 24$/.test(vb) && r.width <= 40;
  }

  function isSubstantialVisual(el) {
    if (!(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 64 || r.height < 48) return false;
    if (r.width * r.height < 4000) return false;
    return true;
  }

  /** Copy live computed paint props onto an SVG clone so it survives offline */
  function styleSvgClone(liveSvg, cloneSvg) {
    const paint = [
      "fill",
      "stroke",
      "stroke-width",
      "stroke-dasharray",
      "stroke-linecap",
      "stroke-linejoin",
      "opacity",
      "fill-opacity",
      "stroke-opacity",
      "font-family",
      "font-size",
      "font-weight",
      "font-style",
      "color",
      "display",
      "visibility",
      "transform",
    ];
    const walk = (src, dst) => {
      if (!src || !dst || src.nodeType !== 1 || dst.nodeType !== 1) return;
      try {
        const cs = getComputedStyle(src);
        const parts = [];
        for (const k of paint) {
          const v = cs.getPropertyValue(k);
          if (v) parts.push(`${k}:${v}`);
        }
        if (parts.length) {
          const prev = dst.getAttribute("style") || "";
          dst.setAttribute("style", `${parts.join(";")}${prev ? `;${prev}` : ""}`);
        }
      } catch {
        /* ignore */
      }
      if (dst.localName === "use") {
        for (const attr of ["href", "xlink:href"]) {
          const href = dst.getAttribute(attr);
          if (href && href.startsWith("/")) {
            try {
              dst.setAttribute(attr === "href" ? "href" : "xlink:href", new URL(href, location.origin).href);
            } catch {
              /* ignore */
            }
          }
        }
      }
      const sc = src.children;
      const dc = dst.children;
      for (let i = 0; i < sc.length && i < dc.length; i++) walk(sc[i], dc[i]);
    };
    walk(liveSvg, cloneSvg);
    if (!cloneSvg.getAttribute("xmlns")) {
      cloneSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
    const r = liveSvg.getBoundingClientRect();
    const w = Math.max(1, Math.ceil(r.width || 300));
    const h = Math.max(1, Math.ceil(r.height || 150));
    cloneSvg.setAttribute("width", String(w));
    cloneSvg.setAttribute("height", String(h));
    cloneSvg.style.maxWidth = "100%";
    cloneSvg.style.height = "auto";
    cloneSvg.style.display = "block";
  }

  function svgToDataUrl(svgEl) {
    const xml = new XMLSerializer().serializeToString(svgEl);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  }

  async function svgToPngDataUrl(liveSvg) {
    const clone = liveSvg.cloneNode(true);
    styleSvgClone(liveSvg, clone);
    const dataUrl = svgToDataUrl(clone);
    const r = liveSvg.getBoundingClientRect();
    const w = Math.max(1, Math.ceil(r.width * (window.devicePixelRatio || 1)));
    const h = Math.max(1, Math.ceil(r.height * (window.devicePixelRatio || 1)));
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  /**
   * Replace live-rendered canvas / Mermaid SVG / chart hosts in the clone with
   * self-contained images so the export does not depend on ChatGPT's runtime scripts.
   */
  async function embedRenderedVisuals(sourceRoot, cloneRoot) {
    const jobs = [];

    qsa(sourceRoot, "canvas").forEach((canvas) => {
      if (!isSubstantialVisual(canvas)) return;
      jobs.push({ el: canvas, kind: "canvas" });
    });

    qsa(sourceRoot, "svg").forEach((svg) => {
      if (isIconSvg(svg)) return;
      if (!isSubstantialVisual(svg)) return;
      jobs.push({ el: svg, kind: "svg" });
    });

    // Chart/diagram hosts that wrap a rendered SVG (capture the host if bigger)
    qsa(
      sourceRoot,
      '[class*="mermaid" i], [data-testid*="mermaid" i], [data-testid*="diagram" i], [data-testid*="chart" i]'
    ).forEach((host) => {
      if (!isSubstantialVisual(host)) return;
      if (host.querySelector("svg, canvas")) jobs.push({ el: host, kind: "host" });
    });

    // De-dupe nested captures: prefer deepest svg/canvas over host when both queued
    const seen = new Set();
    const unique = [];
    for (const job of jobs) {
      if (seen.has(job.el)) continue;
      seen.add(job.el);
      unique.push(job);
    }

    for (const { el, kind } of unique) {
      const path = childIndexPath(sourceRoot, el);
      if (!path) continue;
      const target = nodeFromPath(cloneRoot, path);
      if (!target?.parentElement) continue;

      try {
        const img = document.createElement("img");
        img.alt = "Rendered diagram";
        img.style.cssText = "max-width:100%;height:auto;display:block;margin:0.75rem 0;";

        if (kind === "canvas") {
          img.src = el.toDataURL("image/png");
          target.replaceWith(img);
          continue;
        }

        if (kind === "svg") {
          // Prefer inline SVG (crisp); fall back to PNG if serialization is huge
          const cloneSvg = el.cloneNode(true);
          styleSvgClone(el, cloneSvg);
          const xml = new XMLSerializer().serializeToString(cloneSvg);
          if (xml.length < 450000) {
            const wrap = document.createElement("div");
            wrap.className = "cgpt-dl-diagram";
            wrap.style.cssText = "max-width:100%;overflow:auto;margin:0.75rem 0;";
            wrap.innerHTML = xml;
            target.replaceWith(wrap);
          } else {
            img.src = await svgToPngDataUrl(el);
            target.replaceWith(img);
          }
          continue;
        }

        // host: rasterize first substantial svg/canvas inside
        const innerCanvas = el.querySelector("canvas");
        const innerSvg = el.querySelector("svg");
        if (innerCanvas && isSubstantialVisual(innerCanvas)) {
          img.src = innerCanvas.toDataURL("image/png");
          target.replaceWith(img);
        } else if (innerSvg && !isIconSvg(innerSvg)) {
          img.src = await svgToPngDataUrl(innerSvg);
          target.replaceWith(img);
        }
      } catch (err) {
        console.warn("[cgpt-dl] visual embed failed", err);
      }
    }
  }

  function looksLikeMermaidSource(text) {
    return /^(flowchart|graph\s|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap|timeline|gitGraph|kanban|C4Context|journey)/m.test(
      (text || "").trim()
    );
  }

  async function ensureMermaidLib() {
    if (globalThis.__cgptDlMermaid?.render) return globalThis.__cgptDlMermaid;
    if (globalThis.mermaid?.render) {
      globalThis.__cgptDlMermaid = globalThis.mermaid;
      return globalThis.mermaid;
    }
    const res = await fetch("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js");
    if (!res.ok) throw new Error("Failed to load mermaid");
    const code = await res.text();
    // Runs in the extension isolated world (not page CSP)
    (0, eval)(code);
    const mermaid = globalThis.mermaid;
    if (!mermaid?.initialize) throw new Error("Mermaid failed to initialize");
    mermaid.initialize({
      startOnLoad: false,
      theme: isDarkTheme() ? "dark" : "default",
      securityLevel: "loose",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    });
    globalThis.__cgptDlMermaid = mermaid;
    return mermaid;
  }

  /**
   * Client-rendered Mermaid may still be missing (lazy/share). Re-render source
   * blocks into self-contained SVG and inject them into the clone.
   */
  async function renderMermaidSourcesIntoClone(sourceRoot, cloneRoot) {
    const blocks = qsa(sourceRoot, "[data-code-block], pre, code").filter((block) =>
      looksLikeMermaidSource(block.textContent || "")
    );
    if (!blocks.length) return;

    let mermaid;
    try {
      mermaid = await ensureMermaidLib();
    } catch (err) {
      console.warn("[cgpt-dl] mermaid unavailable", err);
      return;
    }

    let idx = 0;
    for (const block of blocks) {
      const text = (block.textContent || "").trim();
      const liveWrap =
        block.closest("[data-code-block], [class*='code-block'], [class*='CodeBlock']") ||
        block.parentElement;
      // Skip if ChatGPT already rendered a sizable diagram nearby
      const nearbySvg = liveWrap?.parentElement?.querySelector?.("svg");
      if (nearbySvg && isSubstantialVisual(nearbySvg) && !isIconSvg(nearbySvg)) continue;

      const path = childIndexPath(sourceRoot, liveWrap || block);
      if (!path) continue;
      const cloneWrap = nodeFromPath(cloneRoot, path);
      if (!cloneWrap?.parentElement) continue;
      if (cloneWrap.querySelector(".cgpt-dl-diagram, img[alt='Rendered diagram']")) continue;

      try {
        const id = `cgpt-dl-mmd-${Date.now()}-${idx++}`;
        const { svg } = await mermaid.render(id, text);
        const holder = document.createElement("div");
        holder.className = "cgpt-dl-diagram";
        holder.style.cssText = "max-width:100%;overflow:auto;margin:0.75rem 0;";
        holder.innerHTML = svg;
        const svgEl = holder.querySelector("svg");
        if (svgEl) {
          svgEl.style.maxWidth = "100%";
          svgEl.style.height = "auto";
          svgEl.style.display = "block";
        }
        cloneWrap.insertAdjacentElement("afterend", holder);
      } catch (err) {
        console.warn("[cgpt-dl] mermaid render failed", err);
        cloneWrap.setAttribute("data-cgpt-unrendered-diagram", "1");
      }
    }
  }

  /** Mark remaining diagram sources that could not be rendered */
  function annotateUnrenderedDiagrams(cloneRoot) {
    qsa(cloneRoot, "[data-code-block], pre, code").forEach((block) => {
      const text = (block.textContent || "").trim();
      if (!looksLikeMermaidSource(text)) return;
      const wrap =
        block.closest("[data-code-block], [class*='code-block'], [class*='CodeBlock']") ||
        block.parentElement;
      if (!wrap) return;
      if (wrap.querySelector(".cgpt-dl-diagram, img[alt='Rendered diagram']")) return;
      const parent = wrap.parentElement;
      if (parent?.querySelector?.(":scope > .cgpt-dl-diagram, :scope > img[alt='Rendered diagram']")) {
        return;
      }
      // Sibling diagram injected after wrap
      if (wrap.nextElementSibling?.classList?.contains("cgpt-dl-diagram")) return;
      wrap.setAttribute("data-cgpt-unrendered-diagram", "1");
    });
  }

  function absolutizeUrls(cloneRoot) {
    qsa(cloneRoot, "[href], [src]").forEach((el) => {
      ["href", "src"].forEach((attr) => {
        const val = el.getAttribute(attr);
        if (!val || val.startsWith("data:") || val.startsWith("#") || val.startsWith("mailto:")) {
          return;
        }
        try {
          el.setAttribute(attr, new URL(val, location.href).href);
        } catch {
          /* ignore */
        }
      });
    });
  }

  /**
   * Code-block action bars hold the language title (JSON / YAML / Plain text).
   * Keep the title; drop Copy / wrap / sticky chrome.
   */
  function preserveCodeBlockLangLabels(cloneRoot) {
    qsa(
      cloneRoot,
      '[data-markdown-copy="exclude"], [class*="StickyActionBar"], [class*="ActionBar-"]'
    ).forEach((bar) => {
      // Hover-only table toolbars (no language label) — remove entirely
      const titleEl =
        bar.querySelector(".truncate, [class*='truncate']") ||
        [...bar.children].find(
          (c) =>
            c.tagName === "DIV" &&
            (c.textContent || "").trim() &&
            !c.querySelector("button") &&
            !/ms-auto|justify-self-end/i.test(c.className || "")
        );
      const title = (titleEl?.textContent || "").replace(/\s+/g, " ").trim();

      if (!title || /^(copy|share|edit|more)/i.test(title) || title.length > 48) {
        bar.remove();
        return;
      }

      const label = document.createElement("div");
      label.className = "cgpt-dl-code-lang";
      label.textContent = title;
      // Keep useful header look from the inlined bar styles when present
      const barStyle = bar.getAttribute("style") || "";
      label.setAttribute(
        "style",
        [
          barStyle,
          "position:relative",
          "top:auto",
          "sticky:none",
          "display:flex",
          "align-items:center",
          "gap:0.5rem",
          "min-height:2.5rem",
          "padding:0.5rem 1rem",
          "font-family:ui-sans-serif,system-ui,sans-serif",
          "font-size:0.875rem",
          "font-weight:500",
          "user-select:none",
        ]
          .filter(Boolean)
          .join(";")
      );
      bar.replaceWith(label);
    });
  }

  function stripInteractiveNoise(cloneRoot) {
    // Preserve JSON/YAML/Plain text headers before removing action chrome
    preserveCodeBlockLangLabels(cloneRoot);

    qsa(
      cloneRoot,
      [
        "button",
        `.${BTN_CLASS}`,
        '[data-testid="copy-code-button"]',
        '[data-testid*="copy"]',
        '[aria-label="Copy code"]',
        '[aria-label="Copy table"]',
        '[aria-label="Enable word wrap"]',
        '[aria-label="Open email in app"]',
        '[aria-label="Open in email"]',
        '[aria-label="Expand table"]',
        "dialog",
      ].join(", ")
    ).forEach((el) => el.remove());

    // Any leftover sticky bars without a title
    qsa(cloneRoot, "[data-markdown-copy='exclude'], [class*='StickyActionBar']").forEach((el) =>
      el.remove()
    );

    qsa(cloneRoot, "[contenteditable]").forEach((el) => {
      el.removeAttribute("contenteditable");
      el.setAttribute("role", "document");
    });
  }

  /** Extra layout CSS so tables / writing-blocks / grids survive without ChatGPT runtime */
  function exportWidgetCss() {
    return `
/* Tables — fluid, no nested scrollports */
.cgpt-export table,
.cgpt-export [data-markdown-table] table {
  display: table !important;
  border-collapse: collapse;
  width: 100% !important;
  max-width: 100% !important;
  height: auto !important;
  table-layout: auto;
}
.cgpt-export th, .cgpt-export td {
  vertical-align: top;
}
.cgpt-export [data-markdown-table],
.cgpt-export [class*="TableContainer"],
.cgpt-export [class*="TableScroller"],
.cgpt-export [class*="TableWrapper"],
.cgpt-export [class*="TableFrame"] {
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  height: auto !important;
  max-height: none !important;
  overflow-x: auto !important;
  overflow-y: visible !important;
  contain: none !important;
}
.cgpt-export [data-code-block],
.cgpt-export pre,
.cgpt-export [class*="CodeBlock"],
.cgpt-export [class*="code-block"] {
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  box-sizing: border-box !important;
  overflow-x: auto !important;
}
.cgpt-export .cgpt-dl-code-lang {
  display: flex;
  align-items: center;
  min-height: 2.5rem;
  padding: 0.5rem 1rem;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 0.875rem;
  font-weight: 500;
  opacity: 0.9;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}

/* Email / writing blocks */
.cgpt-export [data-testid="chatgpt-writing-block"],
.cgpt-export [data-oai-writing-block-surface],
.cgpt-export [data-writing-block-variant] {
  display: block;
  position: relative;
  max-width: 100%;
  box-sizing: border-box;
}
.cgpt-export [class*="ProseMirror"],
.cgpt-export [class*="writing-block-editor"] {
  outline: none;
  min-height: 1.5em;
  white-space: pre-wrap;
}

/* Grid cards (kanban / decision layouts) */
.cgpt-export [class*="Grid"],
.cgpt-export [data-d-component="grid"] {
  display: grid;
  max-width: 100%;
}
`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildHtmlDocument({ bodyHtml, cssVars, dark, title, chrome, authorCss }) {
    const bg = chrome?.bg || (dark ? "#212121" : "#ffffff");
    const fg = chrome?.fg || (dark ? "#ececec" : "#0d0d0d");
    const font = chrome?.font || "ui-sans-serif, system-ui, sans-serif";
    const lineHeight = chrome?.lineHeight || "1.6";
    const fontSize = chrome?.fontSize || "16px";
    const maxWidth = chrome?.contentMaxWidth || "48rem";
    const extraCss = authorCss ? `\n/* captured page rules */\n${authorCss}\n` : "";
    const widgetCss = exportWidgetCss();

    return `<!DOCTYPE html>
<html lang="en" class="${dark ? "dark" : "light"}" style="color-scheme:${dark ? "dark" : "light"}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
:root {
${cssVars}
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: ${bg};
  color: ${fg};
  font-family: ${font};
  font-size: ${fontSize};
  line-height: ${lineHeight};
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
/* Wrapper — look comes from inlined computed styles + widget guards */
.cgpt-export {
  max-width: min(${maxWidth}, 100%);
  width: 100%;
  margin: 0 auto;
  padding: 2rem 1.25rem 3rem;
  box-sizing: border-box;
}
.cgpt-export > * {
  max-width: 100% !important;
  box-sizing: border-box;
}
.cgpt-export img, .cgpt-export video, .cgpt-export canvas, .cgpt-export .cgpt-dl-diagram svg {
  max-width: 100%;
  height: auto;
}
.cgpt-export .cgpt-dl-diagram { max-width: 100%; overflow: auto; margin: 0.75rem 0; }
.cgpt-export [data-cgpt-unrendered-diagram="1"]::after {
  content: "Diagram source (not rendered in chat at export time)";
  display: block;
  margin-top: 0.35rem;
  font-size: 0.75rem;
  opacity: 0.55;
}
${widgetCss}
${extraCss}
</style>
</head>
<body>
  <article class="cgpt-export">
    ${bodyHtml}
  </article>
</body>
</html>`;
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function exportContent(content, downloadBtn) {
    if (!content) {
      alert("Could not find the response content to download.");
      return;
    }
    if (downloadBtn.dataset.state === "busy") return;

    downloadBtn.dataset.state = "busy";
    downloadBtn.innerHTML = LOADING_ICON;
    downloadBtn.setAttribute("aria-label", "Preparing download…");
    await nextFrame();

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    try {
      downloadBtn.setAttribute("aria-label", "Waiting for diagrams…");
      await waitForClientRender(content);

      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;left:-9999px;top:0;visibility:hidden;";
      document.body.appendChild(probe);
      const defaults = getComputedStyle(probe);
      const clone = content.cloneNode(true);
      downloadBtn.setAttribute("aria-label", "Capturing styles…");
      await inlineComputedStylesAsync(content, clone, defaults);
      probe.remove();

      downloadBtn.setAttribute("aria-label", "Capturing diagrams…");
      await embedRenderedVisuals(content, clone);
      await renderMermaidSourcesIntoClone(content, clone);

      stripInteractiveNoise(clone);
      normalizeExportLayout(clone);
      annotateUnrenderedDiagrams(clone);
      absolutizeUrls(clone);
      await inlineImages(clone);

      const previewText = (content.innerText || "chatgpt-response").trim();
      const title = slugify(previewText.split("\n").find(Boolean) || "chatgpt-response");
      const filename = `${title}-${timestamp()}.html`;

      downloadText(
        filename,
        buildHtmlDocument({
          bodyHtml: clone.outerHTML,
          cssVars: cssVarsBlock(collectCssVariables(content)),
          dark: isDarkTheme(),
          title,
          chrome: pageChrome(content),
          authorCss: collectAuthorCssText(),
        })
      );

      downloadBtn.dataset.state = "done";
      downloadBtn.innerHTML = CHECK_ICON;
      downloadBtn.setAttribute("aria-label", "Downloaded");
      setTimeout(() => {
        downloadBtn.dataset.state = "";
        downloadBtn.innerHTML = DOWNLOAD_ICON;
        downloadBtn.setAttribute("aria-label", "Download response as HTML");
      }, 1600);
    } catch (err) {
      console.error("[cgpt-dl] Export failed", err);
      downloadBtn.dataset.state = "";
      downloadBtn.innerHTML = DOWNLOAD_ICON;
      downloadBtn.setAttribute("aria-label", "Download response as HTML");
      alert("Failed to download this response. See console for details.");
    } finally {
      window.scrollTo(scrollX, scrollY);
    }
  }

  function scrubOldInjections() {
    // Older builds inserted into ChatGPT's React tree and could break Share/etc.
    document.querySelectorAll(`span[${MARK}="wrap"]`).forEach((el) => el.remove());
    document.querySelectorAll(`.${BTN_CLASS}`).forEach((el) => {
      if (el.closest("#" + LAYER_ID)) return;
      el.remove();
    });
  }

  function restoreAllHiddenShares() {
    document.querySelectorAll("[data-cgpt-dl-hide='1']").forEach(restoreNativeShare);
  }

  function bindClick(btn, getTurn, getContent) {
    btn.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const turn = getTurn();
        const content = findContentRoot(turn) || getContent();
        exportContent(content, btn);
      },
      true
    );
  }

  function findShareForTurn(turn, copy) {
    const bar =
      findTurnActionControls(turn) || copy?.closest?.(".turn-action-controls");
    if (bar) {
      const share = qsa(bar, "button[aria-label]").find((b) =>
        /^share$/i.test(labelOf(b))
      );
      if (share) return share;
    }
    if (copy) {
      let node = copy.parentElement;
      for (let d = 0; node && d < 6; d++, node = node.parentElement) {
        if (node.matches?.("header, [data-testid='conversation-header']")) break;
        const share = qsa(node, "button[aria-label]").find((b) => /^share$/i.test(labelOf(b)));
        if (share && !share.closest("header")) return share;
      }
    }
    return null;
  }

  function hideNativeShare(share) {
    if (!share || share.getAttribute("data-cgpt-dl-hide") === "1") return;
    share.setAttribute("data-cgpt-dl-hide", "1");
    share.setAttribute("data-cgpt-dl-prev-vis", share.style.visibility || "");
    share.setAttribute("data-cgpt-dl-prev-pe", share.style.pointerEvents || "");
    share.style.visibility = "hidden";
    share.style.pointerEvents = "none";
  }

  function restoreNativeShare(share) {
    if (!share || share.getAttribute("data-cgpt-dl-hide") !== "1") return;
    share.style.visibility = share.getAttribute("data-cgpt-dl-prev-vis") || "";
    share.style.pointerEvents = share.getAttribute("data-cgpt-dl-prev-pe") || "";
    share.removeAttribute("data-cgpt-dl-hide");
    share.removeAttribute("data-cgpt-dl-prev-vis");
    share.removeAttribute("data-cgpt-dl-prev-pe");
  }

  /** Match ChatGPT action-button look (color, radius, size) from Share/Copy */
  function matchActionChrome(btn, ref) {
    if (!ref) {
      btn.style.width = "32px";
      btn.style.height = "32px";
      btn.style.borderRadius = "9999px";
      btn.style.color = "";
      btn.style.background = "transparent";
      btn.style.padding = "2px";
      return;
    }
    const box = ref.getBoundingClientRect();
    const cs = getComputedStyle(ref);
    const w = Math.max(28, Math.round(box.width || 32));
    const h = Math.max(28, Math.round(box.height || 32));
    btn.style.width = `${w}px`;
    btn.style.height = `${h}px`;
    btn.style.borderRadius = cs.borderRadius || "9999px";
    btn.style.color = cs.color;
    btn.style.background = "transparent";
    btn.style.border = "none";
    btn.style.padding = cs.padding || "2px";
    btn.style.boxShadow = "none";
  }

  function createFloatButton(key) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;
    btn.setAttribute(MARK, key);
    btn.setAttribute("aria-label", "Download response as HTML");
    btn.setAttribute("title", "Download as HTML");
    btn.innerHTML = DOWNLOAD_ICON;
    bindClick(
      btn,
      () => buttonMap.get(key)?.turn,
      () => buttonMap.get(key)?.content
    );
    ensureLayer().appendChild(btn);
    return btn;
  }

  function placeDownloadButton(btn, turn, content, entry) {
    const copy = findCopyInTurn(turn);
    const share = findShareForTurn(turn, copy);

    // Restore previous share if this entry moved to a different one
    if (entry?.share && entry.share !== share) {
      restoreNativeShare(entry.share);
    }

    const anchor = share || copy;
    const sizeFallback = 32;
    let top;
    let left;
    let width = sizeFallback;
    let height = sizeFallback;
    let visibleBox;

    if (share) {
      hideNativeShare(share);
      const box = share.getBoundingClientRect();
      if (box.width || box.height) {
        top = box.top;
        left = box.left;
        width = box.width;
        height = box.height;
        visibleBox = box;
      } else {
        // Share in layout but not painted yet — keep slot via visibility:hidden
        const bar = share.closest(".turn-action-controls") || content || turn;
        const fallback = bar.getBoundingClientRect();
        top = fallback.top;
        left = fallback.left;
        visibleBox = fallback;
      }
      matchActionChrome(btn, share);
    } else if (copy) {
      const box = copy.getBoundingClientRect();
      matchActionChrome(btn, copy);
      width = parseFloat(btn.style.width) || sizeFallback;
      height = parseFloat(btn.style.height) || sizeFallback;
      if (box.width || box.height) {
        // No Share on this UI — sit immediately right of Copy
        top = box.top + (box.height - height) / 2;
        left = box.right + 2;
        visibleBox = box;
      } else {
        const bar = copy.closest(".turn-action-controls");
        const fallback = (bar || content || turn).getBoundingClientRect();
        top = bar ? fallback.top : fallback.bottom - height - 4;
        left = fallback.left;
        visibleBox = fallback;
      }
    } else {
      matchActionChrome(btn, null);
      const box = (content || turn).getBoundingClientRect();
      if (!box.width && !box.height) {
        btn.style.display = "none";
        return { copy: null, share: null };
      }
      top = box.bottom - height - 4;
      left = box.left;
      visibleBox = { top, bottom: top + height, left, right: left + width };
    }

    left = Math.max(4, Math.min(left, window.innerWidth - width - 4));

    const visible =
      visibleBox.bottom > 40 && visibleBox.top < window.innerHeight - 40;
    btn.style.display = visible ? "inline-flex" : "none";
    btn.style.top = `${Math.round(top)}px`;
    btn.style.left = `${Math.round(left)}px`;
    btn.style.width = `${Math.round(width)}px`;
    btn.style.height = `${Math.round(height)}px`;
    return { copy, share };
  }

  function syncButtons() {
    const turns = findAssistantTurns();
    const liveKeys = new Set();

    if (turns.length === 0) {
      missingTurnStreak += 1;
      if (missingTurnStreak < 10) return;
    } else {
      missingTurnStreak = 0;
    }

    turns.forEach((turn, index) => {
      const content = findContentRoot(turn);
      if (!content) return;
      const text = (content.innerText || content.textContent || "").trim();
      if (!text) return;

      const key = turnKey(turn, index);
      liveKeys.add(key);

      let entry = buttonMap.get(key);
      if (!entry || !entry.btn.isConnected) {
        if (entry?.share) restoreNativeShare(entry.share);
        if (entry?.btn) entry.btn.remove();
        const btn = createFloatButton(key);
        entry = { btn, turn, content, copy: null, share: null };
        buttonMap.set(key, entry);
      } else {
        entry.turn = turn;
        entry.content = content;
      }
      const placed = placeDownloadButton(entry.btn, turn, content, entry);
      entry.copy = placed.copy;
      entry.share = placed.share;
    });

    for (const [key, entry] of buttonMap) {
      if (!liveKeys.has(key) && missingTurnStreak >= 10) {
        restoreNativeShare(entry.share);
        entry.btn.remove();
        buttonMap.delete(key);
      }
    }

    const diag = `turns=${turns.length} buttons=${buttonMap.size}`;
    if (diag !== lastDiag) {
      lastDiag = diag;
      log("sync", diag);
    }
  }

  let scheduled = false;
  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try {
        syncButtons();
      } catch (err) {
        console.error("[cgpt-dl] sync error", err);
      }
    });
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.target?.id === LAYER_ID) continue;
      if (m.target?.closest?.("#" + LAYER_ID)) continue;
      scheduleSync();
      return;
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("scroll", scheduleSync, true);
  window.addEventListener("resize", scheduleSync);
  document.addEventListener("pointerover", scheduleSync, true);
  setInterval(scheduleSync, 1000);

  scrubOldInjections();
  syncButtons();
  console.info(`[cgpt-dl] ready v${VERSION}`);
})();
