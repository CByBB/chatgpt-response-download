(() => {
  "use strict";
  const D = (globalThis.__CGPT_DL__ = globalThis.__CGPT_DL__ || {});
  const qs = (...a) => D.qs(...a);
  const qsa = (...a) => D.qsa(...a);
  const deepQsa = (...a) => {
    if (typeof D.deepQsa !== "function") {
      throw new Error("[cgpt-dl] D.deepQsa missing — util.js did not load");
    }
    return D.deepQsa(...a);
  };
  const labelOf = (...a) => D.labelOf(...a);
  const setImportant = (...a) => D.setImportant(...a);
  const nextFrame = (...a) => D.nextFrame(...a);
  const isDarkTheme = (...a) => D.isDarkTheme(...a);
  const slugify = (...a) => D.slugify(...a);
  const timestamp = (...a) => D.timestamp(...a);
  const escapeHtml = (...a) => D.escapeHtml(...a);
  const childIndexPath = (...a) => D.childIndexPath(...a);
  const nodeFromPath = (...a) => D.nodeFromPath(...a);
  const log = (...a) => D.log(...a);

  D.buttonMap = D.buttonMap || new Map();
  D.layer = D.layer || null;
  D.lastDiag = D.lastDiag || "";
  D.missingTurnStreak = D.missingTurnStreak || 0;
  let scheduled = false;
  function ensureLayer() {
    if (D.layer && document.documentElement.contains(D.layer)) return D.layer;
    D.layer = document.getElementById(D.LAYER_ID);
    if (!D.layer) {
      D.layer = document.createElement("div");
      D.layer.id = D.LAYER_ID;
      D.layer.setAttribute(D.MARK, "layer");
      document.documentElement.appendChild(D.layer);
    }
    return D.layer;
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

  function isAssistantCopyButton(btn) {
    if (!(btn instanceof HTMLElement)) return false;
    if (btn.classList.contains(D.BTN_CLASS)) return false;
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

  function scrubOldInjections() {
    // Older builds inserted into ChatGPT's React tree and could break Share/etc.
    document.querySelectorAll(`span[${D.MARK}="wrap"]`).forEach((el) => el.remove());
    document.querySelectorAll(`.${D.BTN_CLASS}`).forEach((el) => {
      if (el.closest("#" + D.LAYER_ID)) return;
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
        D.exportContent(content, btn);
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
    btn.className = D.BTN_CLASS;
    btn.setAttribute(D.MARK, key);
    btn.setAttribute("aria-label", "Download response as HTML");
    btn.setAttribute("title", "Download as HTML");
    btn.innerHTML = D.DOWNLOAD_ICON;
    bindClick(
      btn,
      () => D.buttonMap.get(key)?.turn,
      () => D.buttonMap.get(key)?.content
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
      D.missingTurnStreak += 1;
      if (D.missingTurnStreak < 10) return;
    } else {
      D.missingTurnStreak = 0;
    }

    turns.forEach((turn, index) => {
      const content = findContentRoot(turn);
      if (!content) return;
      const text = (content.innerText || content.textContent || "").trim();
      if (!text) return;

      const key = turnKey(turn, index);
      liveKeys.add(key);

      let entry = D.buttonMap.get(key);
      if (!entry || !entry.btn.isConnected) {
        if (entry?.share) restoreNativeShare(entry.share);
        if (entry?.btn) entry.btn.remove();
        const btn = createFloatButton(key);
        entry = { btn, turn, content, copy: null, share: null };
        D.buttonMap.set(key, entry);
      } else {
        entry.turn = turn;
        entry.content = content;
      }
      const placed = placeDownloadButton(entry.btn, turn, content, entry);
      entry.copy = placed.copy;
      entry.share = placed.share;
    });

    for (const [key, entry] of D.buttonMap) {
      if (!liveKeys.has(key) && D.missingTurnStreak >= 10) {
        restoreNativeShare(entry.share);
        entry.btn.remove();
        D.buttonMap.delete(key);
      }
    }

    const diag = `turns=${turns.length} buttons=${D.buttonMap.size}`;
    if (diag !== D.lastDiag) {
      D.lastDiag = diag;
      log("sync", diag);
    }
  }

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
  function startUi() {
    D.scrubOldInjections();
    D.ensureLayer();

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.target?.id === D.LAYER_ID) continue;
        if (m.target?.closest?.("#" + D.LAYER_ID)) continue;
        scheduleSync();
        return;
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener("scroll", scheduleSync, true);
    window.addEventListener("resize", scheduleSync);
    document.addEventListener("pointerover", scheduleSync, true);
    setInterval(scheduleSync, 1000);

    syncButtons();
    console.info(`[cgpt-dl] ready v${D.VERSION}`);
  }

  Object.assign(D, {
    ensureLayer,
    searchUnitKey,
    isAssistantUnitKey,
    normalizeAssistantTurn,
    isAssistantTurn,
    turnKey,
    isCodeCopyButton,
    toolbarLabels,
    isAssistantCopyButton,
    findContentNear,
    findAssistantTurns,
    findContentRoot,
    actionBarIsAssistant,
    findTurnActionControls,
    pickBestCopy,
    findCopyInTurn,
    scrubOldInjections,
    restoreAllHiddenShares,
    bindClick,
    findShareForTurn,
    hideNativeShare,
    restoreNativeShare,
    matchActionChrome,
    createFloatButton,
    placeDownloadButton,
    syncButtons,
    scheduleSync,
    startUi,
  });
})();
