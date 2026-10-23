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
  D.INLINE_PROPS = [
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
  D.INLINE_PROP_SET = new Set(D.INLINE_PROPS);

  // Freezing ChatGPT's measured px sizes into export collapses the fluid layout
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
    if (D.INLINE_PROP_SET.has(name)) return true;
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
    if (!value || D.SKIP_PROPS.has(name) || name.startsWith("--")) return false;
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
    for (const name of D.INLINE_PROPS) {
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

  function parseStyleDeclarations(styleAttr) {
    const map = new Map();
    String(styleAttr || "")
      .split(";")
      .forEach((chunk) => {
        const t = chunk.trim();
        if (!t) return;
        const i = t.indexOf(":");
        if (i <= 0) return;
        const prop = t.slice(0, i).trim().toLowerCase();
        let val = t.slice(i + 1).trim();
        if (!prop || !val) return;
        map.set(prop, val);
      });
    return map;
  }

  function styleMapToCssText(map) {
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${k}:${v}`)
      .join(";");
  }

  function shouldKeepClassName(name) {
    if (!name) return false;
    return (
      name.startsWith("cgpt-") ||
      name.startsWith("katex") ||
      name.startsWith("language-") ||
      name.startsWith("hljs") ||
      name.startsWith("mjx-") ||
      name === "mermaid" ||
      name === "MathJax" ||
      name === "invisible" ||
      name === "sr-only"
    );
  }

  /**
   * Move inline style="" onto deduped head classes (cgpt-c-N).
   * HTML keeps one generated class (+ a few renderer classnames like katex).
   * Returns the CSS text to inject in <head>.
   */
  function extractInlineStylesToClasses(cloneRoot) {
    if (!(cloneRoot instanceof HTMLElement)) return "";

    const fingerprintToClass = new Map();
    const rules = [];
    let counter = 0;

    const ensureClass = (styleAttr) => {
      const map = parseStyleDeclarations(styleAttr);
      if (!map.size) return null;
      const fp = styleMapToCssText(map);
      let cls = fingerprintToClass.get(fp);
      if (cls) return cls;
      cls = `cgpt-c-${++counter}`;
      fingerprintToClass.set(fp, cls);
      // Expand to CSS declarations; preserve !important when already present
      const body = [...map.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([k, v]) => `${k}:${v}`)
        .join(";");
      rules.push(`.${cls}{${body}}`);
      return cls;
    };

    // SVGElement.className is a read-only SVGAnimatedString — use attribute only
    const applyClasses = (el, names) => {
      const unique = [...new Set(names.filter(Boolean))];
      if (unique.length) el.setAttribute("class", unique.join(" "));
      else el.removeAttribute("class");
    };

    qsa(cloneRoot, "[style]").forEach((el) => {
      const styleAttr = el.getAttribute("style") || "";
      const cls = ensureClass(styleAttr);
      el.removeAttribute("style");

      const kept = [...el.classList].filter(shouldKeepClassName);
      applyClasses(el, cls ? [cls, ...kept.filter((c) => c !== cls)] : kept);
    });

    // Strip Dil hashed class soup from nodes that never had inline styles
    qsa(cloneRoot, "[class]").forEach((el) => {
      applyClasses(el, [...el.classList].filter(shouldKeepClassName));
    });

    return rules.join("\n");
  }

  Object.assign(D, {
    isMediaElement,
    isAllowedInlineProp,
    shouldInlineProp,
    ownCssVarsFromStyleAttr,
    inlineOneNode,
    collectUsedCssVariables,
    cssVarsBlock,
    inlineComputedStyles,
    inlineComputedStylesAsync,
    extractInlineStylesToClasses,
  });
})();
