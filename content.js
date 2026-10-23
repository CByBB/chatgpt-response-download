(() => {
  "use strict";

  const VERSION = "1.6.19";
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

  /**
   * Only visual props — dumping every computed property (and every inherited
   * --var) on every node was producing ~50MB HTML for a short reply.
   */
  const INLINE_PROPS = [
    "color",
    "background",
    "background-color",
    "background-image",
    "background-size",
    "background-position",
    "background-repeat",
    "background-clip",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "font-variant",
    "line-height",
    "letter-spacing",
    "white-space",
    "word-break",
    "overflow-wrap",
    "text-align",
    "text-decoration",
    "text-decoration-color",
    "text-decoration-line",
    "text-indent",
    "text-transform",
    "direction",
    "display",
    "box-sizing",
    "width",
    "height",
    "max-width",
    "min-width",
    "max-height",
    "min-height",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "overflow",
    "overflow-x",
    "overflow-y",
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
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "align-items",
    "align-self",
    "align-content",
    "justify-content",
    "justify-items",
    "justify-self",
    "place-items",
    "place-content",
    "gap",
    "row-gap",
    "column-gap",
    "order",
    "grid",
    "grid-template-columns",
    "grid-template-rows",
    "grid-template-areas",
    "grid-column",
    "grid-row",
    "grid-area",
    "grid-auto-flow",
    "border",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
    "border-width",
    "border-style",
    "border-color",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-radius",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-left-radius",
    "border-bottom-right-radius",
    "border-collapse",
    "border-spacing",
    "outline",
    "outline-offset",
    "opacity",
    "box-shadow",
    "filter",
    "backdrop-filter",
    "transform",
    "transform-origin",
    "object-fit",
    "object-position",
    "aspect-ratio",
    "vertical-align",
    "table-layout",
    "list-style",
    "list-style-type",
    "list-style-position",
    "column-count",
    "columns",
    "isolation",
    "contain",
    "mix-blend-mode",
    "clip-path",
    "fill",
    "stroke",
    "stroke-width",
    "stroke-dasharray",
    "stroke-linecap",
    "stroke-linejoin",
  ];
  const INLINE_PROP_SET = new Set(INLINE_PROPS);

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

  function isAllowedInlineProp(name) {
    if (INLINE_PROP_SET.has(name)) return true;
    return (
      name.startsWith("border") ||
      name.startsWith("padding") ||
      name.startsWith("margin") ||
      name.startsWith("font") ||
      name.startsWith("background") ||
      name.startsWith("grid") ||
      name.startsWith("flex")
    );
  }

  function shouldInlineProp(name, value, defaults, sourceEl) {
    if (!value || SKIP_PROPS.has(name) || name.startsWith("--")) return false;
    if (!isAllowedInlineProp(name)) return false;
    if (
      (value === "none" || value === "normal" || value === "auto") &&
      (name === "box-shadow" ||
        name === "text-decoration" ||
        name === "background-image" ||
        name === "transform" ||
        name === "filter" ||
        name === "outline")
    ) {
      return false;
    }
    // Freezing ChatGPT's px widths/heights into the export causes a narrow column
    // and scrollport tables / overflowing code blocks.
    if (SIZE_PROPS.has(name) && sourceEl && !isMediaElement(sourceEl)) {
      const v = value.trim();
      if (/px$/i.test(v) || /^[0-9.]+$/.test(v)) return false;
    }
    if (defaults && defaults.getPropertyValue(name) === value) return false;
    return true;
  }

  /** Own style="" --vars only (never dump the full inherited token set). */
  function ownCssVarsFromStyleAttr(el) {
    const vars = new Map();
    const inlineAttr = el.getAttribute("style") || "";
    inlineAttr.split(";").forEach((chunk) => {
      const t = chunk.trim();
      if (!t.startsWith("--")) return;
      const i = t.indexOf(":");
      if (i > 0) vars.set(t.slice(0, i).trim(), t.slice(i + 1).trim());
    });
    return vars;
  }

  function inlineOneNode(source, clone, defaults) {
    if (source.nodeType !== 1 || clone.nodeType !== 1) return;
    const computed = getComputedStyle(source);
    const parts = [];

    for (const [k, v] of ownCssVarsFromStyleAttr(source)) {
      if (v) parts.push(`${k}:${v}`);
    }

    const isTableChrome = /^(TR|TD|TH|TABLE|TBODY|THEAD|TFOOT)$/i.test(source.tagName || "");
    for (const name of INLINE_PROPS) {
      // Never bake focus/selection side borders into table chrome
      if (
        isTableChrome &&
        (/^border-(top|right|left)(-|$)/i.test(name) ||
          name === "outline" ||
          name === "outline-offset" ||
          name === "box-shadow")
      ) {
        continue;
      }
      const value = computed.getPropertyValue(name);
      if (shouldInlineProp(name, value, defaults, source)) parts.push(`${name}:${value}`);
    }

    // Sticky headers / fixed chrome break offline docs — pin them into normal flow.
    const pos = computed.position;
    if (pos === "sticky") {
      parts.push("position:relative");
      parts.push("top:auto");
    } else if (pos === "fixed") {
      parts.push("position:absolute");
    }

    if (parts.length) clone.setAttribute("style", parts.join(";"));
    else clone.removeAttribute("style");
  }

  /** Resolve only CSS variables still referenced as var(--…) in the export. */
  function collectUsedCssVariables(liveRoot, cloneRoot, authorCss) {
    const used = new Set();
    const haystack = `${cloneRoot.outerHTML}\n${authorCss || ""}`;
    const re = /var\(\s*(--[\w-]+)/g;
    let m;
    while ((m = re.exec(haystack))) used.add(m[1]);
    // Writing-block / widget tokens often set on a container style attr
    qsa(liveRoot, "[style*='--']").forEach((el) => {
      for (const [k] of ownCssVarsFromStyleAttr(el)) used.add(k);
    });
    qsa(cloneRoot, "[style*='--']").forEach((el) => {
      for (const [k] of ownCssVarsFromStyleAttr(el)) used.add(k);
    });

    const vars = {};
    const rootStyle = getComputedStyle(document.documentElement);
    const liveStyle = getComputedStyle(liveRoot);
    for (const name of used) {
      const v = (liveStyle.getPropertyValue(name) || rootStyle.getPropertyValue(name) || "").trim();
      if (v) vars[name] = v;
    }
    return vars;
  }

  function cssVarsBlock(vars) {
    return Object.entries(vars)
      .filter(([, v]) => v)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join("\n");
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

  function setImportant(el, prop, value) {
    try {
      el.style.setProperty(prop, value, "important");
    } catch {
      el.style[prop] = value;
    }
  }

  /** Halve inlined line-height gaps; add horizontal padding on code surfaces. */
  function tightenMonospaceBlocks(cloneRoot) {
    const roots = qsa(
      cloneRoot,
      'pre, [data-code-block], [class*="CodeBlock"], [class*="code-block"], [class*="CodeSurface"]'
    );

    const halfLineHeight = (el) => {
      const lh = (el.style.lineHeight || "").trim();
      if (!lh || lh === "normal") return;
      const m = lh.match(/^([\d.]+)(px|rem|em)?$/i);
      if (!m) return;
      const n = parseFloat(m[1]);
      if (!Number.isFinite(n) || n <= 0) return;
      const unit = (m[2] || "").toLowerCase();
      if (unit === "px") {
        const fs = parseFloat(el.style.fontSize) || 12;
        const gap = Math.max(0, n - fs);
        setImportant(el, "line-height", `${Math.max(fs * 1.15, fs + gap / 2)}px`);
      } else if (!unit && n >= 1 && n < 5) {
        setImportant(el, "line-height", String(Math.max(1.15, 1 + (n - 1) / 2)));
      } else if (unit === "rem" || unit === "em") {
        setImportant(el, "line-height", `${Math.max(1.15, 1 + (n - 1) / 2)}${unit}`);
      }
    };

    roots.forEach((root) => {
      setImportant(root, "padding-left", "1.25rem");
      setImportant(root, "padding-right", "1.25rem");
      halfLineHeight(root);
      qsa(root, "*").forEach((el) => halfLineHeight(el));
      // Avoid double horizontal padding on nested <code>
      qsa(root, "code").forEach((code) => {
        setImportant(code, "padding-left", "0");
        setImportant(code, "padding-right", "0");
      });
      // Colored shell (Root-*) often holds the visible background — pad it too
      let shell = root;
      for (let i = 0; i < 5 && shell; i++) {
        const bg = (shell.style.backgroundColor || shell.style.background || "").toLowerCase();
        if (/rgb|#|hsl|var\(--/.test(bg) && !/transparent|rgba\(0,\s*0,\s*0,\s*0\)/.test(bg)) {
          const pl = parseFloat(shell.style.paddingLeft) || 0;
          if (pl < 12) {
            setImportant(shell, "padding-left", "1.25rem");
            setImportant(shell, "padding-right", "1.25rem");
          }
          break;
        }
        shell = shell.parentElement;
      }
    });

    // Inline `code` chips outside blocks
    qsa(cloneRoot, "code").forEach((code) => {
      if (code.closest("pre, [data-code-block], [class*='CodeBlock'], [class*='code-block']")) return;
      halfLineHeight(code);
      setImportant(code, "padding-left", "0.4em");
      setImportant(code, "padding-right", "0.4em");
    });
  }

  /**
   * Tables: left-align, content-sized columns, no focus/selection chrome.
   * Focused rows often inline border-*-style:solid WITHOUT width:0 — browsers
   * then paint a medium box (the white highlight around Diff/patch).
   */
  function sanitizeTable(table) {
    if (!(table instanceof HTMLElement)) return;

    setImportant(table, "border", "none");
    setImportant(table, "outline", "none");
    setImportant(table, "box-shadow", "none");
    setImportant(table, "text-align", "left");

    qsa(table, "colgroup, col").forEach((el) => el.remove());

    qsa(table, "tr").forEach((tr) => {
      setImportant(tr, "outline", "none");
      setImportant(tr, "outline-width", "0");
      setImportant(tr, "outline-style", "none");
      setImportant(tr, "box-shadow", "none");
      setImportant(tr, "background", "transparent");
      setImportant(tr, "background-color", "transparent");
      setImportant(tr, "border", "none");
      setImportant(tr, "border-width", "0");
      setImportant(tr, "border-style", "none");
      setImportant(tr, "border-top", "none");
      setImportant(tr, "border-right", "none");
      setImportant(tr, "border-bottom", "none");
      setImportant(tr, "border-left", "none");
      setImportant(tr, "border-top-width", "0");
      setImportant(tr, "border-right-width", "0");
      setImportant(tr, "border-bottom-width", "0");
      setImportant(tr, "border-left-width", "0");
      setImportant(tr, "border-top-style", "none");
      setImportant(tr, "border-right-style", "none");
      setImportant(tr, "border-bottom-style", "none");
      setImportant(tr, "border-left-style", "none");
      tr.removeAttribute("data-state");
      tr.removeAttribute("aria-selected");
      tr.removeAttribute("tabindex");
    });

    qsa(table, "th, td").forEach((cell) => {
      setImportant(cell, "text-align", "left");
      setImportant(cell, "vertical-align", "middle");
      setImportant(cell, "outline", "none");
      setImportant(cell, "outline-width", "0");
      setImportant(cell, "outline-style", "none");
      setImportant(cell, "box-shadow", "none");
      setImportant(cell, "background", "transparent");
      setImportant(cell, "background-color", "transparent");
      // Kill focus rings that use side/top borders; keep a light row rule
      setImportant(cell, "border-top", "none");
      setImportant(cell, "border-right", "none");
      setImportant(cell, "border-left", "none");
      setImportant(cell, "border-top-width", "0");
      setImportant(cell, "border-right-width", "0");
      setImportant(cell, "border-left-width", "0");
      setImportant(cell, "border-top-style", "none");
      setImportant(cell, "border-right-style", "none");
      setImportant(cell, "border-left-style", "none");
      setImportant(cell, "border-bottom", "1px solid rgba(255,255,255,0.08)");
      // Match ChatGPT density (nested <p> margins zeroed below).
      setImportant(cell, "padding-top", "8px");
      setImportant(cell, "padding-bottom", "8px");
      setImportant(cell, "line-height", "1.45");
      setImportant(cell, "height", "auto");
      setImportant(cell, "min-height", "0");
      // Drop forced widths that leave a huge empty first column
      cell.style.removeProperty("width");
      cell.style.removeProperty("min-width");
      cell.style.removeProperty("max-width");
      setImportant(cell, "width", "auto");
      setImportant(cell, "min-width", "0");
      setImportant(cell, "max-width", "none");
      cell.removeAttribute("tabindex");
      cell.removeAttribute("aria-selected");
      cell.removeAttribute("data-state");

      qsa(cell, "p, div, span, li").forEach((inner) => {
        setImportant(inner, "margin", "0");
        setImportant(inner, "margin-top", "0");
        setImportant(inner, "margin-bottom", "0");
        setImportant(inner, "padding-top", "0");
        setImportant(inner, "padding-bottom", "0");
        if (!/^CODE$/i.test(inner.tagName)) {
          const lh = (inner.style.lineHeight || "").trim();
          if (/px$/i.test(lh)) {
            const n = parseFloat(lh);
            const fs = parseFloat(inner.style.fontSize) || 14;
            if (n > fs * 1.4) setImportant(inner, "line-height", "1.35");
          } else {
            setImportant(inner, "line-height", "1.35");
          }
        }
      });
    });

    // First column: hug label text; remaining columns share leftover space
    const rows = qsa(table, "tr");
    if (!rows.length) return;
    rows.forEach((tr) => {
      const cells = qsa(tr, "th, td");
      if (!cells.length) return;
      // Match ChatGPT: first col pad-right, later cols pad-left — but tighter
      setImportant(cells[0], "padding-left", "0");
      setImportant(cells[0], "padding-right", "14px");
      setImportant(cells[0], "width", "max-content");
      setImportant(cells[0], "white-space", "nowrap");
      for (let i = 1; i < cells.length; i++) {
        setImportant(cells[i], "padding-left", "14px");
        setImportant(cells[i], "padding-right", i === cells.length - 1 ? "0" : "14px");
        setImportant(cells[i], "width", "auto");
        setImportant(cells[i], "white-space", "normal");
      }
    });
  }

  /**
   * Icon + title feature lists (Mermaid / Architecture cards). Export often
   * lost horizontal padding (0 !important) so items sat flush — restore GPT spacing.
   */
  function polishFeatureCards(cloneRoot) {
    // Undo mistaken padding on whole-response roots from older builds
    qsa(cloneRoot, "[class*='DilRenderer'], [class*='DilResponse'], [class*='PortalBoundary']").forEach(
      (el) => {
        if (el === cloneRoot) return;
        // Only clear if we clearly over-padded a giant host
        const iconRows = qsa(el, '[data-d-component="row"]').filter(
          (r) => r.querySelector("svg") && r.querySelector("p")
        );
        const tables = qsa(el, "table").length;
        if (tables > 0 || iconRows.length < 2) return;
        // If this node also contains headings outside the card, it's a response root
        if (qs(el, "h1, h2, h3") && !/border-radius/i.test(el.getAttribute("style") || "")) {
          setImportant(el, "padding-left", "0");
          setImportant(el, "padding-right", "0");
          setImportant(el, "padding-top", "0");
          setImportant(el, "padding-bottom", "0");
        }
      }
    );

    const dividers = qsa(cloneRoot, '[data-d-component="divider"], [class*="Divider"]');
    dividers.forEach((div) => {
      // ChatGPT dividers are a 1px rule — inlined line-height:26px made huge gaps
      setImportant(div, "padding-top", "10px");
      setImportant(div, "padding-bottom", "10px");
      setImportant(div, "margin-top", "0");
      setImportant(div, "margin-bottom", "0");
      setImportant(div, "line-height", "0");
      setImportant(div, "font-size", "0");
      setImportant(div, "min-height", "0");
      setImportant(div, "height", "auto");
    });

    // Rows: icon + text stack
    qsa(cloneRoot, '[data-d-component="row"], [data-d-direction="row"]').forEach((row) => {
      const hasIcon = !!row.querySelector("svg");
      const hasTitle = !!row.querySelector("p, h1, h2, h3, h4, strong, [data-d-default-strong]");
      if (!hasIcon || !hasTitle) return;
      if (row.closest("table, pre, [data-code-block]")) return;

      setImportant(row, "display", "flex");
      setImportant(row, "align-items", "flex-start");
      setImportant(row, "gap", "12px");
      setImportant(row, "column-gap", "12px");
      setImportant(row, "row-gap", "12px");

      // Text column: tight title ↔ body like GPT (~4–6px)
      [...row.children].forEach((child) => {
        if (child.querySelector("svg") && !child.querySelector("p")) return;
        if (
          /flex/i.test(child.style.display || "") ||
          child.getAttribute("data-d-direction") === "col"
        ) {
          setImportant(child, "gap", "4px");
          setImportant(child, "row-gap", "4px");
        }
      });

      qsa(row, "p, h1, h2, h3, h4").forEach((p) => {
        setImportant(p, "margin", "0");
        setImportant(p, "margin-top", "0");
        setImportant(p, "margin-bottom", "0");
        const lh = (p.style.lineHeight || "").trim();
        if (/px$/i.test(lh) && parseFloat(lh) >= 24) {
          setImportant(p, "line-height", "1.35");
        }
      });

      const iconBox = [...row.children].find((c) => c.querySelector("svg"));
      if (iconBox) {
        setImportant(iconBox, "flex-shrink", "0");
        setImportant(iconBox, "margin-top", "0.1em");
      }
    });

    const padFeatureHost = (card) => {
      // Match GPT card inset — sides matter more than vertical bulk
      setImportant(card, "padding", "12px 16px");
      setImportant(card, "box-sizing", "border-box");
    };

    const isActualFeatureCard = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.closest("table, pre, [data-code-block], .cgpt-dl-diagram")) return false;
      const cls = el.className?.toString?.() || "";
      // Never pad response / portal roots (bug in 1.6.11)
      if (/DilRenderer|DilResponse|PortalBoundary|Renderer-/i.test(cls)) return false;
      if (el === cloneRoot) return false;

      const style = el.getAttribute("style") || "";
      const hasRadius = /border-radius\s*:\s*[^;]*\d/i.test(style) || /rounded/i.test(cls);
      const hasBorder =
        /border(?:-width)?\s*:\s*(?!0(?:px)?\b)[^;]+/i.test(style) ||
        /border\s*:\s*\d+px\s+solid/i.test(style);
      if (!hasRadius && !hasBorder) return false;

      const rows = qsa(el, '[data-d-component="row"], [data-d-direction="row"]');
      const iconRows = rows.filter((r) => r.querySelector("svg") && r.querySelector("p"));
      if (iconRows.length < 2) return false;

      // Card should be roughly the feature list — not the whole article
      if (qsa(el, "table, h1, h2").length > 2) return false;
      return true;
    };

    qsa(cloneRoot, "[style*='border-radius'], [style*='border:'] , [class*='rounded']").forEach(
      (card) => {
        if (!isActualFeatureCard(card)) return;
        padFeatureHost(card);
      }
    );
  }

  /**
   * ChatGPT “breakout” tables use padding-left:~405px + margin-left:-405px so the
   * table can span the thread column. In a standalone export that padding just
   * eats the width and leaves a skinny table — strip it.
   */
  function undoBreakoutLayout(el) {
    if (!(el instanceof HTMLElement)) return;
    // Never strip Dil selector / card gutters (those are ~12–16px, not table breakout)
    if (
      el.matches?.(
        '[data-d-component="pressable"], [data-d-component="radio"], [data-d-component="radio-group"], [data-d-has-border], [data-cgpt-dl-static], [class*="Radio"], [class*="Pressable"]'
      ) ||
      el.closest?.(
        '[data-d-component="pressable"], [data-d-component="radio-group"], [data-cgpt-dl-static], [class*="generated-image-preview"]'
      )
    ) {
      return;
    }

    const pl = parseFloat(el.style.paddingLeft) || 0;
    const pr = parseFloat(el.style.paddingRight) || 0;
    const ml = el.style.marginLeft || "";
    const mr = el.style.marginRight || "";
    const pad = el.style.padding || "";
    const mar = el.style.margin || "";
    const styleAttr = el.getAttribute("style") || "";
    // Real breakout uses ~200–400px+; do NOT match normal 12px/16px gutters (\d{2,} was wrong)
    const bigPad =
      pl >= 80 ||
      pr >= 80 ||
      /\d{3,}px/.test(pad) ||
      /padding(?:-left|-right):\s*\d{3,}px/i.test(styleAttr);
    const negMar = /^-/.test(ml.trim()) || /^-/.test(mr.trim()) || /-\d+px/.test(mar);
    if (!bigPad && !negMar) return;

    setImportant(el, "padding-left", "0");
    setImportant(el, "padding-right", "0");
    setImportant(el, "margin-left", "0");
    setImportant(el, "margin-right", "0");
    if (/\d{3,}px/.test(pad) || /-\d+px/.test(pad)) {
      setImportant(el, "padding", "0");
    }
    if (/-\d+px/.test(mar) || /\d{3,}px/.test(mar)) {
      // keep vertical margins if we can parse 3/4-value; safest reset horizontal only
      const top = el.style.marginTop || "0";
      const bottom = el.style.marginBottom || "0";
      setImportant(el, "margin", `${top || "0"} 0 ${bottom || "0"} 0`);
    }
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

    // Strip breakout padding/margin anywhere (tables, wide code, diagrams)
    qsa(cloneRoot, "[style]").forEach(undoBreakoutLayout);

    qsa(
      cloneRoot,
      '[data-markdown-table], [class*="TableContainer"], [class*="TableScroller"], [class*="TableWrapper"], [class*="TableFrame"], table'
    ).forEach((el) => {
      if (el.tagName === "TABLE") return;
      undoBreakoutLayout(el);
      setImportant(el, "display", "block");
      setImportant(el, "width", "100%");
      setImportant(el, "max-width", "100%");
      setImportant(el, "min-width", "0");
      setImportant(el, "height", "auto");
      setImportant(el, "max-height", "none");
      setImportant(el, "overflow-x", "auto");
      setImportant(el, "overflow-y", "visible");
      setImportant(el, "contain", "none");
      setImportant(el, "padding-left", "0");
      setImportant(el, "padding-right", "0");
      setImportant(el, "margin-left", "0");
      setImportant(el, "margin-right", "0");
    });

    // Also fix direct parents of tables (often the breakout host)
    qsa(cloneRoot, "table").forEach((table) => {
      let node = table.parentElement;
      for (let i = 0; i < 4 && node && node !== cloneRoot; i++) {
        undoBreakoutLayout(node);
        setImportant(node, "width", "100%");
        setImportant(node, "max-width", "100%");
        setImportant(node, "padding-left", "0");
        setImportant(node, "padding-right", "0");
        setImportant(node, "margin-left", "0");
        setImportant(node, "margin-right", "0");
        node = node.parentElement;
      }
    });

    qsa(cloneRoot, "table").forEach((el) => {
      undoBreakoutLayout(el);
      setImportant(el, "display", "table");
      setImportant(el, "width", "100%");
      setImportant(el, "max-width", "100%");
      setImportant(el, "min-width", "0");
      setImportant(el, "height", "auto");
      // auto: first cols hug labels, last col takes remaining width
      setImportant(el, "table-layout", "auto");
      setImportant(el, "padding-left", "0");
      setImportant(el, "padding-right", "0");
      setImportant(el, "margin-left", "0");
      setImportant(el, "margin-right", "0");
    });

    qsa(cloneRoot, "table").forEach((table) => sanitizeTable(table));

    qsa(
      cloneRoot,
      '[data-code-block], pre, [class*="CodeBlock"], [class*="code-block"], [class*="CodeSurface"]'
    ).forEach((el) => {
      setImportant(el, "width", "100%");
      setImportant(el, "max-width", "100%");
      setImportant(el, "min-width", "0");
      setImportant(el, "box-sizing", "border-box");
      setImportant(el, "overflow-x", "auto");
    });

    tightenMonospaceBlocks(cloneRoot);

    qsa(cloneRoot, '[data-wide-block], [class*="chatgptPaletteBoundary"]').forEach((el) => {
      setImportant(el, "width", "100%");
      setImportant(el, "max-width", "100%");
      setImportant(el, "min-width", "0");
      setImportant(el, "margin-left", "0");
      setImportant(el, "margin-right", "0");
    });

    // Center diagrams / chart images
    qsa(cloneRoot, ".cgpt-dl-diagram, img[alt='Rendered diagram']").forEach((el) => {
      setImportant(el, "display", el.tagName === "IMG" ? "block" : "flex");
      if (el.tagName !== "IMG") setImportant(el, "justify-content", "center");
      setImportant(el, "margin-left", "auto");
      setImportant(el, "margin-right", "auto");
      setImportant(el, "max-width", "100%");
    });
    qsa(cloneRoot, ".cgpt-dl-diagram svg").forEach((el) => {
      setImportant(el, "display", "block");
      setImportant(el, "margin-left", "auto");
      setImportant(el, "margin-right", "auto");
    });

    // Center display math only (not inline $…$)
    qsa(
      cloneRoot,
      '.katex-display, .math-display, [class*="katex-display"], span.katex-display, div.katex-display, mjx-container[display="true"], [data-testid*="math-block" i]'
    ).forEach((el) => {
      setImportant(el, "display", "block");
      setImportant(el, "text-align", "center");
      setImportant(el, "margin-left", "auto");
      setImportant(el, "margin-right", "auto");
      setImportant(el, "width", "100%");
    });
    // ChatGPT often leaves block formulas as a lone .katex inside a paragraph
    qsa(cloneRoot, ".katex").forEach((el) => {
      if (el.closest(".katex-display, .math-display, mjx-container[display='true']")) return;
      const parent = el.parentElement;
      if (!parent || !/^(P|DIV)$/i.test(parent.tagName)) return;
      if (parent.querySelector("p, li, table, pre, code, img, .katex-display")) return;
      const onlyMath =
        [...parent.childNodes].every(
          (n) =>
            n === el ||
            (n.nodeType === 3 && !n.textContent.trim()) ||
            (n.nodeType === 1 && (n === el || el.contains(n) || n.classList?.contains("katex")))
        ) && (parent.textContent || "").replace(/\s+/g, "").length > 0;
      if (!onlyMath) return;
      // Skip tiny inline fragments sitting mid-sentence wrappers
      if ((parent.textContent || "").trim().length < 3) return;
      setImportant(parent, "text-align", "center");
      setImportant(parent, "display", "block");
      setImportant(parent, "width", "100%");
    });

    // Icon + title rows: center icon on the title line (not top-stuck)
    qsa(cloneRoot, "svg").forEach((svg) => {
      if (svg.closest(".cgpt-dl-diagram")) return;
      const parent = svg.parentElement;
      if (!parent) return;
      const display = (parent.style.display || "").toLowerCase();
      const flexish = display.includes("flex");
      const kids = [...parent.children];
      if (!flexish && kids.length > 4) return;

      if (flexish) {
        const sibling = kids.find((c) => c !== svg);
        const siblingIsTitleOnly =
          sibling &&
          (/^H[1-6]$/i.test(sibling.tagName) ||
            ((sibling.textContent || "").trim().length < 80 &&
              !sibling.querySelector("p, li, ul, ol")));
        if (siblingIsTitleOnly) {
          setImportant(parent, "align-items", "center");
          setImportant(svg, "align-self", "center");
        } else {
          setImportant(parent, "align-items", "flex-start");
          // Nudge icon down to the title midline when beside a title+body stack
          setImportant(svg, "align-self", "flex-start");
          setImportant(svg, "margin-top", "0.3em");
        }
      }
      setImportant(svg, "flex-shrink", "0");
      setImportant(svg, "vertical-align", "middle");
    });

    // Markdown / ChatGPT lists — compact like on-screen (avoid airy 26px lh + big margins)
    qsa(cloneRoot, "ul, ol, [data-d-component='list']").forEach((el) => {
      if (el.closest('[data-d-component="row"], [data-testid*="writing"]')) return;
      setImportant(el, "margin-top", "0.35rem");
      setImportant(el, "margin-bottom", "0.5rem");
      const gap = el.style.gap || "";
      if (gap && parseFloat(gap) > 8) {
        setImportant(el, "gap", "0.15rem");
        setImportant(el, "row-gap", "0.15rem");
      }
    });
    qsa(cloneRoot, "li, [data-d-component='list-item']").forEach((el) => {
      if (el.closest('[data-d-component="row"]')) return;
      setImportant(el, "margin-top", "0.1rem");
      setImportant(el, "margin-bottom", "0.1rem");
      setImportant(el, "padding-top", "0");
      setImportant(el, "padding-bottom", "0");
      setImportant(el, "outline", "none");
      setImportant(el, "box-shadow", "none");
      const lh = (el.style.lineHeight || "").trim();
      if (/px$/i.test(lh) && parseFloat(lh) >= 22) {
        setImportant(el, "line-height", "1.4");
      }
      qsa(el, "p").forEach((p) => {
        setImportant(p, "margin", "0");
        const plh = (p.style.lineHeight || "").trim();
        if (/px$/i.test(plh) && parseFloat(plh) >= 22) {
          setImportant(p, "line-height", "1.4");
        }
      });
      el.removeAttribute("data-state");
      el.removeAttribute("aria-selected");
      el.removeAttribute("tabindex");
    });

    // Radio / option rows used as “quick selectors”
    qsa(cloneRoot, '[role="radio"], [role="option"], [role="menuitemradio"]').forEach((el) => {
      setImportant(el, "outline", "none");
      setImportant(el, "box-shadow", "none");
      const parent = el.parentElement;
      if (parent && /flex|grid/i.test(parent.style.display || "")) {
        setImportant(parent, "gap", "0.4rem");
        setImportant(parent, "row-gap", "0.4rem");
      }
    });

    polishFormatSelector(cloneRoot);
    polishFeatureCards(cloneRoot);
    polishWritingBlocks(cloneRoot);
    polishLayoutGrids(cloneRoot);
  }

  function makeOptionCheck() {
    const s = document.createElement("span");
    s.setAttribute("data-cgpt-dl-option-check", "1");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M6.2 10.2l2.4 2.4 5.2-5.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    setImportant(s, "display", "inline-flex");
    setImportant(s, "flex-shrink", "0");
    setImportant(s, "margin-left", "auto");
    setImportant(s, "opacity", "0.9");
    return s;
  }

  function isOptionSelected(el) {
    if (!(el instanceof Element)) return false;
    if (el.getAttribute("aria-pressed") === "true") return true;
    if (el.getAttribute("aria-checked") === "true") return true;
    const state = el.getAttribute("data-state") || "";
    if (/^(checked|on|selected|active)$/i.test(state)) return true;
    if (el.querySelector('[data-state="checked"], [aria-hidden="true"] svg')) {
      const svgs = el.querySelectorAll("svg");
      for (const svg of svgs) {
        const r = svg.getBoundingClientRect();
        if (r.width > 0 && r.width <= 28 && r.height <= 28) return true;
      }
    }
    return false;
  }

  /** Compact Dil “Quick format selector” / option cards after export chrome stripping */
  function polishFormatSelector(cloneRoot) {
    // Outer bordered card (the selector panel only)
    qsa(cloneRoot, '[data-d-component="box"][data-d-has-border]').forEach((el) => {
      if (
        !el.querySelector(
          '[role="radiogroup"], [data-d-component="radio-group"], [data-d-component="pressable"], [data-cgpt-dl-static][data-d-has-border]'
        )
      ) {
        return;
      }
      const pl = parseFloat(el.style.paddingLeft) || 0;
      const pr = parseFloat(el.style.paddingRight) || 0;
      if (pl < 10) setImportant(el, "padding-left", "1rem");
      if (pr < 10) setImportant(el, "padding-right", "1rem");
      const pt = parseFloat(el.style.paddingTop) || 0;
      const pb = parseFloat(el.style.paddingBottom) || 0;
      if (pt < 8) setImportant(el, "padding-top", "1rem");
      if (pb < 8) setImportant(el, "padding-bottom", "1rem");
      setImportant(el, "box-sizing", "border-box");
    });

    // Example-format option rows
    qsa(
      cloneRoot,
      '[data-d-component="pressable"][data-d-has-border], [data-cgpt-dl-static][data-d-has-border], [data-cgpt-dl-static][class*="Pressable"]'
    ).forEach((el) => {
      setImportant(el, "display", "flex");
      setImportant(el, "flex-direction", "row");
      setImportant(el, "align-items", "center");
      setImportant(el, "justify-content", "space-between");
      setImportant(el, "gap", "0.75rem");
      setImportant(el, "width", "100%");
      setImportant(el, "box-sizing", "border-box");
      setImportant(el, "min-height", "0");
      setImportant(el, "height", "auto");
      setImportant(el, "padding", "0.65rem 0.85rem");
      setImportant(el, "padding-left", "0.85rem");
      setImportant(el, "padding-right", "0.85rem");
      setImportant(el, "padding-top", "0.65rem");
      setImportant(el, "padding-bottom", "0.65rem");
      setImportant(el, "border-radius", el.style.borderRadius || "8px");
      setImportant(el, "line-height", "1.35");
      // Text inside should not inflate the row
      qsa(el, "p, span, [data-d-component='text']").forEach((t) => {
        setImportant(t, "margin", "0");
        setImportant(t, "line-height", "1.35");
      });
    });

    // Primary pill CTAs (“Show me an example”) — background often only in CSS vars
    qsa(cloneRoot, '[data-cgpt-dl-static][data-pill], [data-cgpt-dl-static][data-variant="solid"]').forEach(
      (el) => {
        const bg = (el.style.backgroundColor || el.style.background || "").trim();
        if (!bg || bg === "none" || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") {
          const isDark = isDarkTheme();
          setImportant(el, "background", isDark ? "#fff" : "#0d0d0d");
          setImportant(el, "background-color", isDark ? "#fff" : "#0d0d0d");
          setImportant(el, "color", isDark ? "#0d0d0d" : "#fff");
        }
        setImportant(el, "padding", "0.7rem 1rem");
        setImportant(el, "min-height", "2.5rem");
        setImportant(el, "border-radius", "9999px");
        setImportant(el, "display", "inline-flex");
        setImportant(el, "align-items", "center");
        setImportant(el, "justify-content", "center");
        setImportant(el, "width", "100%");
        setImportant(el, "box-sizing", "border-box");
      }
    );

    qsa(cloneRoot, '[role="radiogroup"], [data-d-component="radio-group"]').forEach((g) => {
      setImportant(g, "gap", "0.4rem");
      setImportant(g, "row-gap", "0.4rem");
    });
    qsa(cloneRoot, '[data-d-component="radio"] label, [class*="RadioLabel"]').forEach((lab) => {
      setImportant(lab, "align-items", "center");
      setImportant(lab, "line-height", "1.35");
      setImportant(lab, "gap", "0.55rem");
    });
  }

  /**
   * Kanban / card grids often freeze grid-template-rows to a measured px height
   * (e.g. 94px). Extra items then spill out and overlap the next heading.
   */
  function polishLayoutGrids(cloneRoot) {
    const grids = qsa(
      cloneRoot,
      '[data-d-component="grid"], [style*="display: grid"], [style*="display:grid"], [class*="Grid-"]'
    );

    grids.forEach((grid) => {
      const rows = (grid.style.gridTemplateRows || "").trim();
      const cols = (grid.style.gridTemplateColumns || "").trim();
      const shorthand = (grid.style.grid || "").trim();

      // Frozen px row track(s) → auto so cards grow with content
      if (rows && /^[\d.]+px(\s+[\d.]+px)*$/.test(rows)) {
        const n = rows.split(/\s+/).length;
        setImportant(grid, "grid-template-rows", n > 1 ? `repeat(${n}, auto)` : "auto");
      } else if (/\d+px\s*\//.test(shorthand)) {
        setImportant(grid, "grid-template-rows", "auto");
      }

      // Measured px columns → equal flexible columns in the export
      if (cols && /^[\d.]+px(\s+[\d.]+px)+$/.test(cols)) {
        const n = cols.split(/\s+/).length;
        setImportant(grid, "grid-template-columns", `repeat(${n}, minmax(0, 1fr))`);
      }

      setImportant(grid, "height", "auto");
      setImportant(grid, "max-height", "none");
      setImportant(grid, "align-items", "stretch");
      setImportant(grid, "overflow", "visible");

      // Card cells inside the grid
      qsa(grid, '[data-d-component="grid-item"], [class*="Item-"], [class*="Box-"]').forEach((item) => {
        if (item.style.display === "contents") {
          // contents items don't box; fix their visible children instead
          [...item.children].forEach((child) => {
            setImportant(child, "height", "auto");
            setImportant(child, "max-height", "none");
            setImportant(child, "overflow", "visible");
            const pad = parseFloat(child.style.paddingTop) || 0;
            if (pad < 8) {
              setImportant(child, "padding", "10px 12px");
            }
          });
          return;
        }
        setImportant(item, "height", "auto");
        setImportant(item, "max-height", "none");
        setImportant(item, "overflow", "visible");
        setImportant(item, "min-height", "0");
      });
    });
  }

  /**
   * Email writing-blocks: Tailwind `invisible` measuring spans / aria-hidden
   * layers stack on the subject textarea → ghosted double title without Tailwind.
   */
  function fixWritingBlockDuplicates(cloneRoot) {
    // Global: utility classes that hide measuring clones — useless without Tailwind
    qsa(
      cloneRoot,
      [
        ".invisible",
        '[class~="invisible"]',
        ".sr-only",
        '[class*="sr-only"]',
        ".opacity-0",
        '[class~="opacity-0"]',
        "[data-placeholder]:empty",
      ].join(", ")
    ).forEach((el) => el.remove());

    qsa(cloneRoot, '[aria-hidden="true"]').forEach((el) => {
      if ((el.textContent || "").trim().length >= 2) el.remove();
    });

    const blocks = qsa(
      cloneRoot,
      [
        '[data-testid="chatgpt-writing-block"]',
        '[data-testid="writing-block-container"]',
        "[data-oai-writing-block-surface]",
        "[data-writing-block-variant]",
        '[class*="WritingBlock"]',
        '[class*="writing-block"]',
      ].join(", ")
    );

    blocks.forEach((block) => {
      // Subject auto-size: textarea + invisible span share one grid cell
      qsa(block, "textarea").forEach((ta) => {
        const val = (ta.value || ta.textContent || "").trim();
        const div = document.createElement("div");
        div.textContent = val;
        div.setAttribute("data-cgpt-dl-subject", "1");
        const st = ta.getAttribute("style") || "";
        if (st) div.setAttribute("style", st);
        setImportant(div, "outline", "none");
        setImportant(div, "resize", "none");
        setImportant(div, "overflow", "visible");
        setImportant(div, "grid-area", "auto");
        ta.replaceWith(div);
      });

      // Absolute/fixed title chromes that repeat visible text
      const abs = qsa(block, "*").filter((el) => {
        const pos = (el.style.position || "").toLowerCase();
        return pos === "absolute" || pos === "fixed";
      });
      abs.forEach((el) => {
        const t = (el.textContent || "").trim().replace(/\s+/g, " ");
        if (t.length < 3 || t.length > 180) return;
        const hasNormal = qsa(block, "h1,h2,h3,h4,p,div,span").some((other) => {
          if (other === el || el.contains(other) || other.contains(el)) return false;
          const pos = (other.style.position || "").toLowerCase();
          if (pos === "absolute" || pos === "fixed") return false;
          return (other.textContent || "").trim().replace(/\s+/g, " ") === t;
        });
        if (hasNormal) el.remove();
      });

      // Drop subject body duplicate when header already shows the same title
      const headerText = (
        qs(block, '[class*="whitespace-nowrap"], [class*="text-ellipsis"]')?.textContent || ""
      )
        .trim()
        .replace(/\s+/g, " ");
      if (headerText.length >= 3) {
        qsa(block, "[data-cgpt-dl-subject]").forEach((el) => {
          const t = (el.textContent || "").trim().replace(/\s+/g, " ");
          if (t === headerText) el.remove();
        });
      }
    });
  }

  /** Email / writing-block cards often lose horizontal padding after breakout cleanup */
  function polishWritingBlocks(cloneRoot) {
    const blocks = qsa(
      cloneRoot,
      [
        '[data-testid="chatgpt-writing-block"]',
        '[data-testid="writing-block-container"]',
        "[data-oai-writing-block-surface]",
        "[data-writing-block-variant]",
        '[class*="WritingBlock"]',
      ].join(", ")
    );

    blocks.forEach((block) => {
      setImportant(block, "padding-left", "1rem");
      setImportant(block, "padding-right", "1rem");
      setImportant(block, "box-sizing", "border-box");

      // Inner surfaces / editors that were forced to padding-left:0
      qsa(
        block,
        '[class*="writing-block"], [class*="ProseMirror"], [class*="editor"], [data-oai-writing-block-surface]'
      ).forEach((inner) => {
        const pl = parseFloat(inner.style.paddingLeft) || 0;
        const pr = parseFloat(inner.style.paddingRight) || 0;
        if (pl < 8) setImportant(inner, "padding-left", "1rem");
        if (pr < 8) setImportant(inner, "padding-right", "1rem");
      });

      // Header / body chrome rows flush to edge
      qsa(block, "[style*='padding-left: 0'], [style*='padding-left:0']").forEach((el) => {
        if (el.closest("button, svg")) return;
        if (el === block) return;
        const pl = parseFloat(el.style.paddingLeft) || 0;
        if (pl === 0 && /flex|block|grid/i.test(el.style.display || "block")) {
          // only pad direct content wrappers, not every nested node
          if (el.parentElement === block || el.parentElement?.parentElement === block) {
            setImportant(el, "padding-left", "1rem");
            setImportant(el, "padding-right", "1rem");
          }
        }
      });
    });
  }

  /** Strip focus rings / selection outlines left in computed styles */
  function stripFocusChrome(cloneRoot) {
    qsa(cloneRoot, "[style]").forEach((el) => {
      const outline = (el.style.outline || "").toLowerCase();
      if (outline && outline !== "none" && outline !== "0px") {
        setImportant(el, "outline", "none");
        setImportant(el, "outline-offset", "0");
      }
      // Tailwind-style focus rings often bake into box-shadow
      const shadow = el.style.boxShadow || "";
      if (
        /0\s*0\s*0\s*(1|2|3)px|rgba?\(\s*255\s*,\s*255\s*,\s*255/i.test(shadow) &&
        (el.tagName === "TR" ||
          el.tagName === "TD" ||
          el.tagName === "TH" ||
          el.tagName === "LI" ||
          el.getAttribute("role") === "radio" ||
          el.getAttribute("role") === "option" ||
          el.getAttribute("role") === "row")
      ) {
        setImportant(el, "box-shadow", "none");
      }
    });
  }

  /** Same-origin CSS (markdown / widget rules). Skip huge inlined font blobs. */
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
          if (rule.type === CSSRule.FONT_FACE_RULE) {
            // data: font payloads bloat the file; system fonts are fine offline
            if (/url\(\s*['"]?data:/i.test(text)) continue;
            if (text.length > 4000) continue;
            chunks.push(text);
            continue;
          }
          if (rule.type === CSSRule.KEYFRAMES_RULE) continue;
          if (rule.type === CSSRule.STYLE_RULE && interesting.test(rule.selectorText || "")) {
            if (text.length > 8000) continue;
            chunks.push(text);
          }
        }
      }
    } catch {
      /* ignore */
    }
    const joined = chunks.join("\n");
    return joined.length > 120000 ? joined.slice(0, 120000) : joined;
  }

  async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function fetchDataUrlViaExtension(absUrl) {
    if (!absUrl || !chrome?.runtime?.sendMessage) return null;
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "cgpt-dl-fetch-data-url",
        url: absUrl,
      });
      if (resp?.ok && typeof resp.dataUrl === "string" && resp.dataUrl.startsWith("data:")) {
        return resp.dataUrl;
      }
    } catch {
      /* extension context invalidated / no receiver */
    }
    return null;
  }

  /** Always prefer base64 data URLs; returns null if inlining failed (never leaves bare https). */
  async function urlToDataUrl(url) {
    if (!url || url === "none") return null;
    const cleaned = url.replace(/^url\(["']?|["']?\)$/g, "").trim();
    if (!cleaned || cleaned === "none") return null;
    if (cleaned.startsWith("data:")) return cleaned;

    let abs;
    try {
      abs = new URL(cleaned, location.href).href;
    } catch {
      return null;
    }

    // Extension background fetch bypasses page CORS (images.openai.com, oaiusercontent, …)
    const viaBg = await fetchDataUrlViaExtension(abs);
    if (viaBg) return viaBg;

    try {
      const res = await fetch(abs, { credentials: "include", mode: "cors" });
      if (res.ok) {
        const dataUrl = await blobToDataUrl(await res.blob());
        if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) return dataUrl;
      }
    } catch {
      /* page CORS */
    }
    return null;
  }

  async function canvasFromImage(img) {
    if (!(img instanceof HTMLImageElement)) return null;
    const w = img.naturalWidth || Math.round(img.getBoundingClientRect().width * (devicePixelRatio || 1));
    const h = img.naturalHeight || Math.round(img.getBoundingClientRect().height * (devicePixelRatio || 1));
    if (w < 1 || h < 1) return null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  }

  async function imgToDataUrl(img) {
    if (!(img instanceof HTMLImageElement)) return null;
    const src = img.currentSrc || img.getAttribute("src") || "";
    if (!src) {
      const srcset = img.getAttribute("srcset") || "";
      const first = srcset.split(",")[0]?.trim().split(/\s+/)[0];
      if (first) return urlToDataUrl(first);
      return null;
    }
    if (src.startsWith("data:")) return src;

    const fetched = await urlToDataUrl(src);
    if (fetched) return fetched;

    // Last resort: rasterize the already-decoded bitmap (fails if canvas is CORS-tainted)
    return canvasFromImage(img);
  }

  function findBgImageUrl(el) {
    if (!(el instanceof Element)) return null;
    const nodes = [el, ...qsa(el, "*")];
    for (const node of nodes) {
      try {
        const bg = getComputedStyle(node).backgroundImage || "";
        const m = bg.match(/url\((["']?)([^"')]+)\1\)/);
        if (m?.[2] && !m[2].startsWith("data:image/svg")) return m[2];
      } catch {
        /* ignore */
      }
      const inline = node.style?.backgroundImage || "";
      const m2 = inline.match(/url\((["']?)([^"')]+)\1\)/);
      if (m2?.[2]) return m2[2];
    }
    return null;
  }

  function injectImgIntoTile(tile, dataUrl, alt) {
    if (!tile || !dataUrl) return;
    let img = [...tile.querySelectorAll("img")].find((el) => el.parentElement === tile);
    if (!img) {
      img = document.createElement("img");
      tile.insertBefore(img, tile.firstChild);
    }
    img.setAttribute("src", dataUrl);
    img.removeAttribute("srcset");
    img.alt = alt || img.alt || "Image";
    setImportant(img, "display", "block");
    setImportant(img, "width", "100%");
    setImportant(img, "height", "100%");
    setImportant(img, "object-fit", "cover");
    setImportant(img, "position", "absolute");
    setImportant(img, "inset", "0");
    setImportant(img, "border-radius", "inherit");
    setImportant(img, "z-index", "0");
    if (!/relative|absolute|fixed/i.test(tile.style.position || "")) {
      setImportant(tile, "position", "relative");
    }
  }

  /**
   * Inline live <img> pixels onto the clone (data URLs) while paths still match.
   * ChatGPT image search wraps previews in <button> — freeze/strip may drop them,
   * so refillEmptyImageTiles runs again after strip.
   */
  async function embedContentImages(sourceRoot, cloneRoot) {
    const srcImgs = qsa(sourceRoot, "img").filter((img) => {
      const src = img.currentSrc || img.getAttribute("src") || img.getAttribute("srcset");
      if (!src) return false;
      const r = img.getBoundingClientRect();
      return r.width >= 32 || r.height >= 32 || img.naturalWidth >= 32;
    });

    for (const srcImg of srcImgs) {
      const dataUrl = await imgToDataUrl(srcImg);
      if (!dataUrl) continue;
      const path = childIndexPath(sourceRoot, srcImg);
      const dst = path ? nodeFromPath(cloneRoot, path) : null;
      if (dst instanceof HTMLImageElement) {
        dst.setAttribute("src", dataUrl);
        dst.removeAttribute("srcset");
      }
    }
  }

  /** Restore search/generated preview tiles emptied when their <button> wrappers were removed */
  async function refillEmptyImageTiles(sourceRoot, cloneRoot) {
    const tileSel =
      '[class*="generated-image-preview"], [class*="image-preview"], [class*="ImageTile"]';
    const srcTiles = qsa(sourceRoot, tileSel);
    const dstTiles = qsa(cloneRoot, tileSel);
    const n = Math.min(srcTiles.length, dstTiles.length);
    for (let i = 0; i < n; i++) {
      const dst = dstTiles[i];
      if (dst.querySelector('img[src^="data:"], img[src]:not([src=""])')) continue;

      const liveImg = srcTiles[i].querySelector("img");
      if (liveImg) {
        const dataUrl = await imgToDataUrl(liveImg);
        if (dataUrl) injectImgIntoTile(dst, dataUrl, liveImg.alt || "");
        continue;
      }

      const bg = findBgImageUrl(srcTiles[i]);
      if (bg) {
        const dataUrl = await urlToDataUrl(bg);
        if (dataUrl) injectImgIntoTile(dst, dataUrl, "");
      }
    }
  }

  async function inlineImages(cloneRoot) {
    await Promise.all(
      qsa(cloneRoot, "img").map(async (img) => {
        const src = img.getAttribute("src") || "";
        if (src.startsWith("data:")) return;

        let candidate = src;
        if (!candidate) {
          const srcset = img.getAttribute("srcset") || "";
          candidate = srcset.split(",")[0]?.trim().split(/\s+/)[0] || "";
        }
        if (!candidate) return;

        const dataUrl = await urlToDataUrl(candidate);
        if (dataUrl?.startsWith("data:")) {
          img.setAttribute("src", dataUrl);
          img.removeAttribute("srcset");
        }
        // Leave remote URL only if base64 inlining failed (offline may still break)
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
        img.style.cssText =
          "max-width:100%;height:auto;display:block;margin:0.75rem auto;";

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
            wrap.style.cssText =
              "max-width:100%;overflow:auto;margin:0.75rem auto;display:flex;justify-content:center;";
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
        holder.style.cssText =
          "max-width:100%;overflow:auto;margin:0.75rem auto;display:flex;justify-content:center;";
        holder.innerHTML = svg;
        const svgEl = holder.querySelector("svg");
        if (svgEl) {
          svgEl.style.maxWidth = "100%";
          svgEl.style.height = "auto";
          svgEl.style.display = "block";
          svgEl.style.marginLeft = "auto";
          svgEl.style.marginRight = "auto";
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

  function isHttpUrl(value) {
    return typeof value === "string" && /^https?:\/\//i.test(value.trim());
  }

  function normalizeHttpUrl(value) {
    if (!value) return null;
    let v = String(value).trim();
    if (!v || v === "#" || v.startsWith("javascript:")) return null;
    if (/\s/.test(v)) return null;
    if (v.startsWith("//")) v = `https:${v}`;
    if (!/^https?:\/\//i.test(v) && /^[\w-]+(\.[\w-]+)+/.test(v)) v = `https://${v}`;
    if (!isHttpUrl(v)) return null;
    if (/google\.com\/s2\/favicons|data:image/i.test(v)) return null;
    try {
      const abs = new URL(v, location.href);
      const host = abs.hostname.toLowerCase();
      // Skip ChatGPT app hosts (not citation targets). utm_source=chatgpt.com is fine.
      if (
        host === "chatgpt.com" ||
        host.endsWith(".chatgpt.com") ||
        host === "chat.openai.com" ||
        host.endsWith(".oaistatic.com")
      ) {
        return null;
      }
      return abs.href;
    } catch {
      return v;
    }
  }

  function hrefFromFaviconSrc(src) {
    if (!src) return null;
    try {
      const u = new URL(src, location.href);
      const domain = u.searchParams.get("domain");
      if (!domain) return null;
      return normalizeHttpUrl(domain);
    } catch {
      const m = String(src).match(/[?&]domain=([^&]+)/i);
      if (!m) return null;
      try {
        return normalizeHttpUrl(decodeURIComponent(m[1]));
      } catch {
        return normalizeHttpUrl(m[1]);
      }
    }
  }

  function digUrlFromReact(el, depth = 0) {
    if (!el || depth > 4) return null;
    const keys = Object.keys(el);
    for (const key of keys) {
      if (!key.startsWith("__react")) continue;
      const found = digUrlInValue(el[key], 0, new Set());
      if (found) return found;
    }
    return null;
  }

  function digUrlInValue(value, depth, seen) {
    if (value == null || depth > 7) return null;
    if (typeof value === "string") return normalizeHttpUrl(value);
    if (typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);
    if (typeof value.href === "string") {
      const href = normalizeHttpUrl(value.href);
      if (href) return href;
    }
    for (const key of ["url", "permalink", "href", "link", "sourceUrl", "canonicalUrl"]) {
      if (typeof value[key] === "string") {
        const href = normalizeHttpUrl(value[key]);
        if (href) return href;
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = digUrlInValue(item, depth + 1, seen);
        if (found) return found;
      }
      return null;
    }
    for (const item of Object.values(value)) {
      if (!item || typeof item === "function") continue;
      const found = digUrlInValue(item, depth + 1, seen);
      if (found) return found;
    }
    return null;
  }

  function resolveHrefFromLive(el) {
    if (!(el instanceof Element)) return null;

    if (el.tagName === "A") {
      const href = normalizeHttpUrl(el.getAttribute("href") || el.href);
      if (href) return href;
    }

    const nested = el.querySelector?.("a[href]");
    if (nested) {
      const href = normalizeHttpUrl(nested.getAttribute("href") || nested.href);
      if (href) return href;
    }

    const closest = el.closest?.("a[href]");
    if (closest && closest !== el) {
      const href = normalizeHttpUrl(closest.getAttribute("href") || closest.href);
      if (href) return href;
    }

    for (const attr of [
      "href",
      "data-href",
      "data-url",
      "data-permalink",
      "data-source-url",
      "data-testid-link",
    ]) {
      const href = normalizeHttpUrl(el.getAttribute(attr));
      if (href) return href;
    }

    const fav = el.querySelector?.('img[src*="favicon"], img[src*="Favicon"]');
    if (fav) {
      const href = hrefFromFaviconSrc(fav.getAttribute("src") || fav.src);
      if (href) return href;
    }

    const reactUrl = digUrlFromReact(el) || digUrlFromReact(el.parentElement);
    if (reactUrl) return reactUrl;

    // Domain-looking label on source chips (e.g. "enqa.eu")
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text && text.length < 80 && !/\s/.test(text)) {
      const fromText = normalizeHttpUrl(text);
      if (fromText && /\./.test(fromText)) return fromText;
    }

    return null;
  }

  function styleExportLink(a) {
    if (!(a instanceof HTMLElement)) return;
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    a.setAttribute("data-cgpt-dl-link", "1");
    setImportant(a, "cursor", "pointer");
    setImportant(a, "pointer-events", "auto");
    // Keep ChatGPT dotted look when present; otherwise a light underline
    const deco = (a.style.textDecoration || "").toLowerCase();
    if (!deco || deco === "none") {
      const dotted = a.querySelector?.('[data-d-text-decoration="underline-dotted"]');
      if (!dotted) setImportant(a, "text-decoration", "underline");
    }
  }

  /** Turn a non-anchor node into a real <a href>, preserving children/styles */
  function ensureElementIsLink(el, href) {
    const url = normalizeHttpUrl(href);
    if (!el || !url) return null;

    if (el.tagName === "A") {
      el.setAttribute("href", url);
      styleExportLink(el);
      return el;
    }

    const existing = el.querySelector?.(":scope > a[href], a[href]");
    if (existing && el.contains(existing)) {
      // Prefer promoting the whole chip when the inner anchor is only a fragment
      const existingHref = normalizeHttpUrl(existing.getAttribute("href") || existing.href);
      if (existingHref) {
        existing.setAttribute("href", existingHref);
        styleExportLink(existing);
        return existing;
      }
    }

    const a = document.createElement("a");
    a.setAttribute("href", url);
    for (const { name, value } of [...el.attributes]) {
      if (name === "href" || name === "type" || name === "role" || name === "tabindex") continue;
      try {
        a.setAttribute(name, value);
      } catch {
        /* ignore */
      }
    }
    while (el.firstChild) a.appendChild(el.firstChild);
    styleExportLink(a);
    el.replaceWith(a);
    return a;
  }

  /**
   * ChatGPT citations / source chips are often popover triggers (JS), not <a href>.
   * Recover URLs from nested anchors, React props, favicons, and domain labels.
   */
  function preserveHyperlinks(sourceRoot, cloneRoot) {
    // Map visible labels → href from any real anchors still on the live reply
    const labelHref = new Map();
    qsa(sourceRoot, "a[href]").forEach((a) => {
      const href = normalizeHttpUrl(a.getAttribute("href") || a.href);
      if (!href) return;
      const label = (a.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (label && label.length < 80) labelHref.set(label, href);
    });

    const pairAndLinkify = (srcNodes, dstNodes) => {
      const n = Math.min(srcNodes.length, dstNodes.length);
      for (let i = 0; i < n; i++) {
        const src = srcNodes[i];
        const dst = dstNodes[i];
        if (!(dst instanceof Element)) continue;
        if (dst.closest?.("a[href]")) {
          styleExportLink(dst.closest("a[href]"));
          continue;
        }
        let href = resolveHrefFromLive(src);
        if (!href) {
          const label = (src.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
          if (label && labelHref.has(label)) href = labelHref.get(label);
        }
        if (!href) continue;
        // Prefer wrapping the trigger/chip, not a tiny inner span
        const target =
          dst.closest?.('[data-d-component="popover-trigger"], [data-d-component="badge"], [data-cgpt-dl-static]') ||
          dst;
        ensureElementIsLink(target, href);
      }
    };

    pairAndLinkify(
      qsa(sourceRoot, '[data-d-component="popover-trigger"], [aria-haspopup="dialog"]'),
      qsa(cloneRoot, '[data-d-component="popover-trigger"], [aria-haspopup="dialog"]')
    );

    pairAndLinkify(
      qsa(sourceRoot, '[data-d-text-decoration="underline-dotted"]'),
      qsa(cloneRoot, '[data-d-text-decoration="underline-dotted"]')
    );

    // Source chips: URL often only exists as Google favicon ?domain=
    const srcFavs = qsa(sourceRoot, 'img[src*="favicon"], img[src*="Favicon"]');
    const dstFavs = qsa(cloneRoot, 'img[src*="favicon"], img[src*="Favicon"]');
    const favN = Math.min(srcFavs.length, dstFavs.length);
    for (let i = 0; i < favN; i++) {
      const dstImg = dstFavs[i];
      if (dstImg.closest("a[href]")) continue;

      const srcHost =
        srcFavs[i].closest(
          '[data-d-component="badge"], [data-d-component="popover-trigger"], a, div, span'
        ) || srcFavs[i].parentElement;

      let href =
        resolveHrefFromLive(srcHost) ||
        hrefFromFaviconSrc(srcFavs[i].getAttribute("src") || srcFavs[i].src) ||
        hrefFromFaviconSrc(dstImg.getAttribute("src") || dstImg.src);

      const chip =
        dstImg.closest(
          '[data-d-component="badge"], [data-d-component="popover-trigger"], [data-cgpt-dl-static]'
        ) || dstImg.parentElement?.parentElement;
      if (!chip || chip.closest("a[href]")) continue;

      if (!href) {
        const label = (chip.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (label && labelHref.has(label)) href = labelHref.get(label);
      }
      if (!href) {
        const domainText = (chip.textContent || "").match(
          /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i
        );
        if (domainText) href = normalizeHttpUrl(domainText[0]);
      }
      if (!href) continue;
      ensureElementIsLink(chip, href);
    }

    // Final pass: polish every remaining anchor
    qsa(cloneRoot, "a[href]").forEach((a) => {
      const href = normalizeHttpUrl(a.getAttribute("href") || a.href);
      if (!href) return;
      a.setAttribute("href", href);
      styleExportLink(a);
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

  /** Copy / share / turn chrome — not in-reply widgets or image tiles */
  function isExportChromeControl(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.classList.contains(BTN_CLASS) || el.closest(`.${BTN_CLASS}`)) return true;
    const label = (el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
    const testId = el.getAttribute("data-testid") || "";
    if (
      /^(copy|share|download|good response|bad response|read aloud|regenerate|more actions|more)$/i.test(
        label
      ) ||
      /copy (code|table|message|response)|word wrap|expand table|open email|open in email/i.test(label)
    ) {
      return true;
    }
    if (/copy/i.test(testId) || /share/i.test(testId)) return true;
    if (
      el.matches(
        '[data-testid="copy-code-button"], [data-testid*="copy"], [aria-label="Copy code"], [aria-label="Copy table"], [aria-label="Enable word wrap"], [aria-label="Open email in app"], [aria-label="Open in email"], [aria-label="Expand table"]'
      )
    ) {
      return true;
    }
    if (el.closest("[data-markdown-copy='exclude'], [class*='StickyActionBar'], .turn-action-controls")) {
      if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") return true;
    }
    return false;
  }

  function buttonToStaticDiv(btn) {
    // Real anchors must stay <a href> — a div[href] is not navigable
    if (btn.tagName === "A" && (btn.getAttribute("href") || btn.href)) {
      const href = btn.getAttribute("href") || btn.href;
      try {
        btn.setAttribute("href", new URL(href, location.href).href);
      } catch {
        btn.setAttribute("href", href);
      }
      btn.setAttribute("target", "_blank");
      btn.setAttribute("rel", "noopener noreferrer");
      btn.setAttribute("data-cgpt-dl-static", "1");
      btn.setAttribute("data-cgpt-dl-link", "1");
      btn.removeAttribute("role");
      btn.removeAttribute("tabindex");
      return btn;
    }

    const div = document.createElement("div");
    for (const { name, value } of [...btn.attributes]) {
      if (name === "type" || name === "disabled" || name === "tabindex") continue;
      try {
        div.setAttribute(name, value);
      } catch {
        /* ignore */
      }
    }
    div.innerHTML = btn.innerHTML;
    div.setAttribute("data-cgpt-dl-static", "1");
    div.removeAttribute("tabindex");

    // Absolute decorative icons on CTAs must not sit on the label
    qsa(div, "*").forEach((el) => {
      const pos = (el.style.position || "").toLowerCase();
      if (pos !== "absolute" && pos !== "fixed") return;
      const looksIcon =
        el.tagName === "SVG" ||
        !!el.querySelector("svg") ||
        /icon|chevron|arrow|caret/i.test(String(el.className || ""));
      if (!looksIcon) return;
      setImportant(el, "position", "static");
      setImportant(el, "inset", "auto");
      setImportant(el, "top", "auto");
      setImportant(el, "right", "auto");
      setImportant(el, "bottom", "auto");
      setImportant(el, "left", "auto");
      setImportant(el, "transform", "none");
      setImportant(el, "margin-left", "0.5rem");
      setImportant(el, "flex-shrink", "0");
    });

    const text = (div.textContent || "").replace(/\s+/g, " ").trim();
    const isPill =
      div.hasAttribute("data-pill") ||
      div.getAttribute("data-variant") === "solid" ||
      /show me|example|continue|try it|generate|submit/i.test(text);
    if (isPill) {
      setImportant(div, "display", "inline-flex");
      setImportant(div, "align-items", "center");
      setImportant(div, "justify-content", "center");
      setImportant(div, "gap", "0.5rem");
      setImportant(div, "width", "100%");
      setImportant(div, "box-sizing", "border-box");
      const bg = (div.style.backgroundColor || div.style.background || "").trim();
      if (!bg || bg === "none" || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") {
        const dark = isDarkTheme();
        setImportant(div, "background", dark ? "#ffffff" : "#0d0d0d");
        setImportant(div, "background-color", dark ? "#ffffff" : "#0d0d0d");
        setImportant(div, "color", dark ? "#0d0d0d" : "#ffffff");
      }
      setImportant(div, "border-radius", "9999px");
      setImportant(div, "padding", "0.7rem 1rem");
    }

    btn.replaceWith(div);
    return div;
  }

  function isLiveRadioChecked(el) {
    if (!(el instanceof Element)) return false;
    if (el.getAttribute("aria-checked") === "true") return true;
    if (el.getAttribute("data-state") === "checked") return true;
    if (el.querySelector('input[type="radio"]:checked, [aria-checked="true"], [data-state="checked"]')) {
      return true;
    }
    const btn = el.querySelector('button[role="radio"], [role="radio"], [class*="RadioIndicator"] button');
    if (btn && btn !== el) {
      if (btn.getAttribute("aria-checked") === "true") return true;
      if (btn.getAttribute("data-state") === "checked") return true;
    }
    const label = el.querySelector("label[for]");
    const forId = label?.getAttribute("for");
    if (forId) {
      let input = null;
      try {
        input = el.querySelector(`#${CSS.escape(forId)}`) || document.getElementById(forId);
      } catch {
        input = document.getElementById(forId);
      }
      if (input && "checked" in input && input.checked) return true;
    }
    const wrap = el.querySelector('[class*="RadioIndicator"]');
    if (wrap?.querySelector('[data-state="checked"]')) return true;
    if (wrap && wrap.querySelectorAll("circle").length >= 2) return true;
    return false;
  }

  function makeRadioDot(checked) {
    const s = document.createElement("span");
    s.setAttribute("data-cgpt-dl-radio-dot", checked ? "1" : "0");
    s.setAttribute("aria-hidden", "true");
    setImportant(s, "display", "block");
    setImportant(s, "width", "16px");
    setImportant(s, "height", "16px");
    setImportant(s, "border-radius", "9999px");
    setImportant(s, "box-sizing", "border-box");
    setImportant(s, "border", "1.5px solid color-mix(in srgb, currentColor 55%, transparent)");
    setImportant(s, "background", "transparent");
    setImportant(s, "flex-shrink", "0");
    if (checked) {
      setImportant(s, "border-color", "currentColor");
      setImportant(
        s,
        "background",
        "radial-gradient(circle at center, currentColor 0 4.25px, transparent 4.75px)"
      );
    }
    return s;
  }

  function paintRadioIndicators(sourceRoot, cloneRoot) {
    const srcItems = qsa(sourceRoot, '[data-d-component="radio"], [role="radio"]');
    const dstItems = qsa(cloneRoot, '[data-d-component="radio"], [role="radio"]');
    const n = Math.min(srcItems.length, dstItems.length);
    for (let i = 0; i < n; i++) {
      const checked = isLiveRadioChecked(srcItems[i]);
      const wrap =
        qs(dstItems[i], '[class*="RadioIndicator"]') ||
        qs(dstItems[i], '[class*="radio-indicator"]');
      if (!wrap) continue;
      qsa(wrap, "button, input, [role='radio']").forEach((el) => el.remove());
      qsa(wrap, "[data-cgpt-dl-radio-dot]").forEach((el) => el.remove());
      wrap.appendChild(makeRadioDot(checked));
      setImportant(wrap, "display", "flex");
      setImportant(wrap, "align-items", "center");
      setImportant(wrap, "justify-content", "center");
      setImportant(wrap, "width", "18px");
      setImportant(wrap, "height", "18px");
      setImportant(wrap, "flex", "0 0 18px");
      setImportant(wrap, "min-width", "18px");
    }
  }

  /**
   * Keep in-reply buttons (format selector, image tiles) as static markup.
   * Only turn chrome is removed.
   */
  function paintOptionChecks(sourceRoot, cloneRoot) {
    const sel =
      '[data-d-component="pressable"][data-d-has-border], [class*="Pressable"][data-d-has-border], button[data-d-has-border]';
    const srcOpts = qsa(sourceRoot, sel);
    const dstOpts = qsa(
      cloneRoot,
      '[data-cgpt-dl-static][data-d-has-border], [data-d-component="pressable"][data-d-has-border], [data-cgpt-dl-static][class*="Pressable"]'
    );
    const n = Math.min(srcOpts.length, dstOpts.length);
    for (let i = 0; i < n; i++) {
      if (!isOptionSelected(srcOpts[i])) continue;
      const dst = dstOpts[i];
      if (dst.querySelector("[data-cgpt-dl-option-check], svg")) continue;
      dst.appendChild(makeOptionCheck());
    }
  }

  function freezeInteractiveWidgets(sourceRoot, cloneRoot) {
    paintRadioIndicators(sourceRoot, cloneRoot);

    qsa(cloneRoot, 'button, [role="button"]').forEach((btn) => {
      if (isExportChromeControl(btn)) {
        // Never drop a button that carries the only preview image
        const img = btn.querySelector("img");
        if (img && (img.getAttribute("src") || img.getAttribute("srcset"))) {
          buttonToStaticDiv(btn);
          return;
        }
        btn.remove();
        return;
      }
      if (btn.closest('[class*="RadioIndicator"], [class*="radio-indicator"]')) {
        btn.remove();
        return;
      }
      buttonToStaticDiv(btn);
    });

    paintOptionChecks(sourceRoot, cloneRoot);

    qsa(cloneRoot, 'input[type="radio"], input[type="checkbox"]').forEach((inp) => {
      if (inp.closest('[data-d-component="radio"], [role="radiogroup"], [class*="Radio"]')) {
        inp.remove();
        return;
      }
      setImportant(inp, "display", "none");
    });
  }

  function stripInteractiveNoise(cloneRoot) {
    // Preserve JSON/YAML/Plain text headers before removing action chrome
    preserveCodeBlockLangLabels(cloneRoot);

    // Real <button>s should already be frozen; drop leftovers + dialogs
    qsa(cloneRoot, "button, dialog").forEach((el) => el.remove());

    qsa(
      cloneRoot,
      [
        `.${BTN_CLASS}`,
        '[data-testid="copy-code-button"]',
        '[data-testid*="copy"]',
        '[aria-label="Copy code"]',
        '[aria-label="Copy table"]',
        '[aria-label="Enable word wrap"]',
        '[aria-label="Open email in app"]',
        '[aria-label="Open in email"]',
        '[aria-label="Expand table"]',
      ].join(", ")
    ).forEach((el) => {
      if (el.getAttribute("data-cgpt-dl-static") === "1") return;
      // Keep tile images even if nested under a matched chrome selector
      if (el.closest('[class*="generated-image-preview"]') && el.querySelector?.("img")) return;
      el.remove();
    });

    qsa(cloneRoot, '[role="button"]').forEach((el) => {
      if (el.getAttribute("data-cgpt-dl-static") === "1") return;
      if (isExportChromeControl(el)) el.remove();
    });

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
/* Tables — full width, columns share space */
.cgpt-export table,
.cgpt-export [data-markdown-table] table {
  display: table !important;
  border-collapse: collapse;
  width: 100% !important;
  max-width: 100% !important;
  height: auto !important;
  table-layout: auto !important;
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
  text-align: left !important;
}
.cgpt-export th, .cgpt-export td {
  vertical-align: middle;
  text-align: left !important;
  word-break: break-word;
  outline: none !important;
  outline-width: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
  border-top: none !important;
  border-left: none !important;
  border-right: none !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
  padding-top: 8px !important;
  padding-bottom: 8px !important;
  line-height: 1.45 !important;
  height: auto !important;
  min-height: 0 !important;
}
.cgpt-export th p,
.cgpt-export td p,
.cgpt-export th > div,
.cgpt-export td > div {
  margin: 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  line-height: 1.45 !important;
}
.cgpt-export tr {
  outline: none !important;
  outline-width: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
  border: none !important;
  border-width: 0 !important;
  border-style: none !important;
}
.cgpt-export tr > :first-child {
  width: max-content;
  white-space: nowrap;
  padding-left: 0 !important;
  padding-right: 14px !important;
}
.cgpt-export tr > :not(:first-child) {
  padding-left: 14px !important;
}
.cgpt-export tr > :last-child {
  padding-right: 0 !important;
}

/* Icon + title feature cards — match ChatGPT density */
.cgpt-export [data-d-component="divider"],
.cgpt-export [class*="Divider"] {
  padding-top: 10px !important;
  padding-bottom: 10px !important;
  line-height: 0 !important;
  font-size: 0 !important;
  min-height: 0 !important;
}
.cgpt-export [data-d-component="row"]:has(svg):has(p) {
  gap: 12px !important;
  align-items: flex-start !important;
}
.cgpt-export [data-d-component="row"]:has(svg):has(p) [data-d-direction="col"],
.cgpt-export [data-d-component="row"]:has(svg):has(p) > div:not(:has(> svg:only-child)) {
  gap: 4px !important;
  row-gap: 4px !important;
}
.cgpt-export [data-d-component="row"]:has(svg):has(p) p {
  margin: 0 !important;
}
.cgpt-export thead th,
.cgpt-export th {
  text-align: left !important;
  font-weight: 600;
}
.cgpt-export [data-markdown-table],
.cgpt-export [class*="TableContainer"],
.cgpt-export [class*="TableScroller"],
.cgpt-export [class*="TableWrapper"],
.cgpt-export [class*="TableFrame"] {
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  height: auto !important;
  max-height: none !important;
  overflow-x: auto !important;
  overflow-y: visible !important;
  contain: none !important;
  /* ChatGPT breakout: padding-left 405px + negative margin — kills export width */
  padding-left: 0 !important;
  padding-right: 0 !important;
  margin-left: 0 !important;
  margin-right: 0 !important;
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
  padding-left: 1.25rem !important;
  padding-right: 1.25rem !important;
  line-height: 1.25 !important;
}
.cgpt-export pre code,
.cgpt-export [data-code-block] code,
.cgpt-export [class*="code-block"] code {
  padding-left: 0 !important;
  padding-right: 0 !important;
  line-height: inherit !important;
}
.cgpt-export :not(pre) > code {
  padding-left: 0.4em !important;
  padding-right: 0.4em !important;
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
  line-height: 1.3 !important;
}

/* Email / writing blocks */
.cgpt-export [data-testid="chatgpt-writing-block"],
.cgpt-export [data-testid="writing-block-container"],
.cgpt-export [data-oai-writing-block-surface],
.cgpt-export [data-writing-block-variant] {
  display: block;
  position: relative;
  max-width: 100%;
  box-sizing: border-box;
  padding-left: 1rem !important;
  padding-right: 1rem !important;
}
.cgpt-export [class*="ProseMirror"],
.cgpt-export [class*="writing-block-editor"] {
  outline: none !important;
  min-height: 1.5em;
  white-space: pre-wrap;
  padding-left: 0.25rem !important;
  padding-right: 0.25rem !important;
}
/* Tailwind hide utilities — without Tailwind they show as double text */
.cgpt-export .invisible,
.cgpt-export .sr-only,
.cgpt-export .opacity-0 {
  display: none !important;
}

/* Recovered citation / source links */
.cgpt-export a[data-cgpt-dl-link],
.cgpt-export a[href^="http"] {
  cursor: pointer !important;
  pointer-events: auto !important;
  color: inherit;
}
.cgpt-export a[data-cgpt-dl-link]:hover,
.cgpt-export a[href^="http"]:hover {
  opacity: 0.85;
}

/* Quick format selector / Dil option rows */
.cgpt-export [data-d-component="pressable"][data-d-has-border],
.cgpt-export [data-cgpt-dl-static][data-d-has-border] {
  padding: 0.65rem 0.85rem !important;
  min-height: 0 !important;
  height: auto !important;
  align-items: center !important;
  box-sizing: border-box !important;
}
.cgpt-export [data-cgpt-dl-static][data-pill],
.cgpt-export [data-cgpt-dl-static][data-variant="solid"] {
  border-radius: 9999px !important;
}

/* Image search / generated preview tiles */
.cgpt-export [class*="generated-image-preview"],
.cgpt-export [class*="image-preview"] {
  position: relative !important;
  overflow: hidden !important;
}
.cgpt-export [class*="generated-image-preview"] > img,
.cgpt-export [class*="image-preview"] > img {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  object-fit: cover !important;
  border-radius: inherit;
}

/* Diagrams centered */
.cgpt-export .cgpt-dl-diagram {
  display: flex !important;
  justify-content: center !important;
  align-items: center !important;
  width: 100% !important;
  max-width: 100% !important;
  overflow: auto;
  margin: 0.75rem auto !important;
}
.cgpt-export .cgpt-dl-diagram svg,
.cgpt-export img[alt="Rendered diagram"] {
  display: block !important;
  margin-left: auto !important;
  margin-right: auto !important;
  max-width: 100%;
  height: auto;
}

/* Display math centered (inline katex untouched) */
.cgpt-export .katex-display,
.cgpt-export .math-display,
.cgpt-export [class*="katex-display"],
.cgpt-export mjx-container[display="true"] {
  display: block !important;
  text-align: center !important;
  margin: 0.75rem auto !important;
  width: 100% !important;
}
.cgpt-export .katex-display > .katex,
.cgpt-export .katex-display > .katex-html {
  text-align: center;
}

/* Icon + label vertical centering */
.cgpt-export svg {
  vertical-align: middle;
}
.cgpt-export :is(div,li,a,span,h1,h2,h3,h4,button,[role="button"]):has(> svg:first-child) {
  align-items: center;
}
.cgpt-export [style*="display: flex"]:has(> svg),
.cgpt-export [style*="display:flex"]:has(> svg),
.cgpt-export [style*="display: inline-flex"]:has(> svg) {
  align-items: center !important;
}

/* Lists — compact like ChatGPT */
.cgpt-export ul, .cgpt-export ol,
.cgpt-export [data-d-component="list"] {
  margin: 0.35rem 0 0.6rem;
  padding-left: 1.35em;
}
.cgpt-export li,
.cgpt-export [data-d-component="list-item"] {
  margin: 0.1rem 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  line-height: 1.4 !important;
  outline: none !important;
  box-shadow: none !important;
}
.cgpt-export li + li,
.cgpt-export [data-d-component="list-item"] + [data-d-component="list-item"] {
  margin-top: 0.1rem !important;
}
.cgpt-export li p,
.cgpt-export [data-d-component="list-item"] p {
  margin: 0 !important;
  line-height: 1.4 !important;
}

/* Kill leftover focus/selection rings */
.cgpt-export *:focus,
.cgpt-export *:focus-visible {
  outline: none !important;
}

/* Grid cards (kanban / decision layouts) */
.cgpt-export [class*="Grid"],
.cgpt-export [data-d-component="grid"] {
  display: grid !important;
  max-width: 100%;
  height: auto !important;
  max-height: none !important;
  align-items: stretch !important;
  overflow: visible !important;
  grid-template-rows: auto !important;
}
.cgpt-export [data-d-component="grid"] > *,
.cgpt-export [class*="Grid-"] > * {
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
  min-height: 0 !important;
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

      downloadBtn.setAttribute("aria-label", "Capturing images…");
      await embedContentImages(content, clone);
      freezeInteractiveWidgets(content, clone);
      stripInteractiveNoise(clone);
      preserveHyperlinks(content, clone);
      await refillEmptyImageTiles(content, clone);
      fixWritingBlockDuplicates(clone);
      stripFocusChrome(clone);
      normalizeExportLayout(clone);
      annotateUnrenderedDiagrams(clone);
      absolutizeUrls(clone);
      await inlineImages(clone);

      const previewText = (content.innerText || "chatgpt-response").trim();
      const title = slugify(previewText.split("\n").find(Boolean) || "chatgpt-response");
      const filename = `${title}-${timestamp()}.html`;
      const authorCss = collectAuthorCssText();

      downloadText(
        filename,
        buildHtmlDocument({
          bodyHtml: clone.outerHTML,
          cssVars: cssVarsBlock(collectUsedCssVariables(content, clone, authorCss)),
          dark: isDarkTheme(),
          title,
          chrome: pageChrome(content),
          authorCss,
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
