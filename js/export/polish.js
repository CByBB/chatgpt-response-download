(() => {
  "use strict";
  const D = (globalThis.__CGPT_DL__ = globalThis.__CGPT_DL__ || {});
  const qs = (...a) => D.qs(...a);
  const qsa = (...a) => D.qsa(...a);
  const setImportant = (...a) => D.setImportant(...a);
  const nextFrame = (...a) => D.nextFrame(...a);
  const isDarkTheme = (...a) => D.isDarkTheme(...a);
  const slugify = (...a) => D.slugify(...a);
  const timestamp = (...a) => D.timestamp(...a);
  const escapeHtml = (...a) => D.escapeHtml(...a);
  const childIndexPath = (...a) => D.childIndexPath(...a);
  const nodeFromPath = (...a) => D.nodeFromPath(...a);
  const log = (...a) => D.log(...a);

  function undoBreakoutLayout(el) {
    if (!(el instanceof HTMLElement)) return;
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
    if (/\d{3,}px/.test(pad) || /-\d+px/.test(pad)) setImportant(el, "padding", "0");
    if (/-\d+px/.test(mar) || /\d{3,}px/.test(mar)) {
      const top = el.style.marginTop || "0";
      const bottom = el.style.marginBottom || "0";
      setImportant(el, "margin", `${top || "0"} 0 ${bottom || "0"} 0`);
    }
  }

  /** DOM cleanup only — visual table rules live in export/export.css */
  function sanitizeTable(table) {
    if (!(table instanceof HTMLElement)) return;
    qsa(table, "colgroup, col").forEach((el) => el.remove());
    qsa(table, "tr, th, td").forEach((el) => {
      el.removeAttribute("data-state");
      el.removeAttribute("aria-selected");
      el.removeAttribute("tabindex");
    });
  }

  /** Empty absolute overlays (table resize chrome) sit inset:0 and steal link clicks */
  function stripTableClickBlockers(cloneRoot) {
    qsa(cloneRoot, '[data-d-table-viewport]').forEach((vp) => {
      let sib = vp.nextElementSibling;
      while (sib) {
        const next = sib.nextElementSibling;
        const empty =
          !(sib.textContent || "").trim() && !sib.querySelector("img, svg, canvas, video, a[href]");
        if (sib.getAttribute("aria-hidden") === "true" && empty) sib.remove();
        sib = next;
      }
    });

    qsa(cloneRoot, '[aria-hidden="true"]').forEach((el) => {
      if ((el.textContent || "").trim()) return;
      if (el.querySelector("img, svg, canvas, video, a[href]")) return;
      const st = el.getAttribute("style") || "";
      if (
        /position\s*:\s*absolute/i.test(st) &&
        (/inset\s*:\s*0/i.test(st) ||
          (/top\s*:\s*0/i.test(st) && /bottom\s*:\s*0/i.test(st) && /left\s*:\s*0/i.test(st)))
      ) {
        el.remove();
      }
    });
  }

  function tightenMonospaceBlocks(cloneRoot) {
    // Halve oversized inlined line-heights; padding comes from export.css
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
    qsa(
      cloneRoot,
      'pre, [data-code-block], [class*="CodeBlock"], [class*="code-block"], [class*="CodeSurface"]'
    ).forEach((root) => {
      halfLineHeight(root);
      qsa(root, "*").forEach(halfLineHeight);
    });
  }

  function polishFeatureCards(cloneRoot) {
    // Only restore card host padding when export zeroed it; density CSS is in export.css
    const isActualFeatureCard = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.closest("table, pre, [data-code-block], .cgpt-dl-diagram")) return false;
      const cls = el.className?.toString?.() || "";
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
      if (qsa(el, "table, h1, h2").length > 2) return false;
      return true;
    };
    qsa(cloneRoot, "[style*='border-radius'], [style*='border:'] , [class*='rounded']").forEach(
      (card) => {
        if (!isActualFeatureCard(card)) return;
        const pl = parseFloat(card.style.paddingLeft) || 0;
        if (pl < 8) {
          setImportant(card, "padding", "12px 16px");
          setImportant(card, "box-sizing", "border-box");
        }
      }
    );
  }

  function polishFormatSelector(cloneRoot) {
    // CTA background often missing from CSS vars after freeze
    qsa(cloneRoot, '[data-cgpt-dl-static][data-pill], [data-cgpt-dl-static][data-variant="solid"]').forEach(
      (el) => {
        const bg = (el.style.backgroundColor || el.style.background || "").trim();
        if (!bg || bg === "none" || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") {
          const dark = isDarkTheme();
          setImportant(el, "background", dark ? "#ffffff" : "#0d0d0d");
          setImportant(el, "background-color", dark ? "#ffffff" : "#0d0d0d");
          setImportant(el, "color", dark ? "#0d0d0d" : "#ffffff");
        }
      }
    );
  }

  function polishLayoutGrids(cloneRoot) {
    const grids = qsa(
      cloneRoot,
      '[data-d-component="grid"], [style*="display: grid"], [style*="display:grid"], [class*="Grid-"]'
    );
    grids.forEach((grid) => {
      const rows = (grid.style.gridTemplateRows || "").trim();
      const cols = (grid.style.gridTemplateColumns || "").trim();
      const shorthand = (grid.style.grid || "").trim();
      if (rows && /^[\d.]+px(\s+[\d.]+px)*$/.test(rows)) {
        const n = rows.split(/\s+/).length;
        setImportant(grid, "grid-template-rows", n > 1 ? `repeat(${n}, auto)` : "auto");
      } else if (/\d+px\s*\//.test(shorthand)) {
        setImportant(grid, "grid-template-rows", "auto");
      }
      if (cols && /^[\d.]+px(\s+[\d.]+px)+$/.test(cols)) {
        const n = cols.split(/\s+/).length;
        setImportant(grid, "grid-template-columns", `repeat(${n}, minmax(0, 1fr))`);
      }
    });
  }

  function polishWritingBlocks(cloneRoot) {
    // Padding mostly from export.css; restore only if still zeroed on the host
    qsa(
      cloneRoot,
      '[data-testid="chatgpt-writing-block"], [data-testid="writing-block-container"], [data-oai-writing-block-surface], [data-writing-block-variant], [class*="WritingBlock"]'
    ).forEach((block) => {
      const pl = parseFloat(block.style.paddingLeft) || 0;
      if (pl < 8) {
        setImportant(block, "padding-left", "1rem");
        setImportant(block, "padding-right", "1rem");
        setImportant(block, "box-sizing", "border-box");
      }
    });
  }

  function stripFocusChrome(cloneRoot) {
    qsa(cloneRoot, "[style]").forEach((el) => {
      const outline = (el.style.outline || "").toLowerCase();
      if (outline && outline !== "none" && outline !== "0px") {
        setImportant(el, "outline", "none");
        setImportant(el, "outline-offset", "0");
      }
      const shadow = el.style.boxShadow || "";
      if (
        /0\s*0\s*0\s*(1|2|3)px|rgba?\(\s*255\s*,\s*255\s*,\s*255/i.test(shadow) &&
        /^(TR|TD|TH|LI)$/i.test(el.tagName)
      ) {
        setImportant(el, "box-shadow", "none");
      }
    });
  }

  function normalizeExportLayout(cloneRoot) {
    stripTableClickBlockers(cloneRoot);
    if (!(cloneRoot instanceof HTMLElement)) return;
    cloneRoot.style.width = "100%";
    cloneRoot.style.maxWidth = "100%";
    cloneRoot.style.minWidth = "0";
    cloneRoot.style.marginLeft = "0";
    cloneRoot.style.marginRight = "0";
    cloneRoot.style.boxSizing = "border-box";
    cloneRoot.setAttribute("data-cgpt-dl-export", "1");

    qsa(cloneRoot, "[style]").forEach(undoBreakoutLayout);

    qsa(cloneRoot, "table").forEach((table) => {
      let node = table.parentElement;
      for (let i = 0; i < 4 && node && node !== cloneRoot; i++) {
        undoBreakoutLayout(node);
        node = node.parentElement;
      }
      sanitizeTable(table);
    });

    tightenMonospaceBlocks(cloneRoot);

    // Lone .katex block formulas — mark parent for CSS centering when unambiguous
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
      if ((parent.textContent || "").trim().length < 3) return;
      parent.setAttribute("data-cgpt-dl-math-block", "1");
    });

    // Icon + title flex nudge (dynamic sibling shape)
    qsa(cloneRoot, "svg").forEach((svg) => {
      if (svg.closest(".cgpt-dl-diagram")) return;
      const parent = svg.parentElement;
      if (!parent) return;
      const display = (parent.style.display || "").toLowerCase();
      if (!display.includes("flex")) return;
      const kids = [...parent.children];
      const sibling = kids.find((c) => c !== svg);
      const siblingIsTitleOnly =
        sibling &&
        (/^H[1-6]$/i.test(sibling.tagName) ||
          ((sibling.textContent || "").trim().length < 80 && !sibling.querySelector("p, li, ul, ol")));
      if (siblingIsTitleOnly) {
        setImportant(parent, "align-items", "center");
        setImportant(svg, "align-self", "center");
      } else {
        setImportant(parent, "align-items", "flex-start");
        setImportant(svg, "align-self", "flex-start");
        setImportant(svg, "margin-top", "0.3em");
      }
      setImportant(svg, "flex-shrink", "0");
    });

    qsa(cloneRoot, "li, [data-d-component='list-item']").forEach((el) => {
      el.removeAttribute("data-state");
      el.removeAttribute("aria-selected");
      el.removeAttribute("tabindex");
    });

    polishFormatSelector(cloneRoot);
    polishFeatureCards(cloneRoot);
    polishWritingBlocks(cloneRoot);
    polishLayoutGrids(cloneRoot);
  }

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
  Object.assign(D, {
    undoBreakoutLayout,
    sanitizeTable,
    tightenMonospaceBlocks,
    polishFeatureCards,
    polishFormatSelector,
    polishLayoutGrids,
    polishWritingBlocks,
    stripFocusChrome,
    normalizeExportLayout,
    fixWritingBlockDuplicates,
    stripTableClickBlockers,
  });
})();
