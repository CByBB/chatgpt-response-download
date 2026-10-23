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

    // Skip page fetch for hosts that never send CORS headers (avoids console spam)
    try {
      const host = new URL(abs).hostname;
      if (
        /(^|\.)google\.com$/i.test(host) ||
        /(^|\.)gstatic\.com$/i.test(host) ||
        /favicon/i.test(abs)
      ) {
        return null;
      }
    } catch {
      return null;
    }

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

  async function embedContentImages(sourceRoot, cloneRoot) {
    const srcImgs = qsa(sourceRoot, "img").filter((img) => {
      const src = img.currentSrc || img.getAttribute("src") || img.getAttribute("srcset");
      if (!src) return false;
      const r = img.getBoundingClientRect();
      return r.width >= 32 || r.height >= 32 || img.naturalWidth >= 32;
    });

    for (const srcImg of srcImgs) {
      const path = childIndexPath(sourceRoot, srcImg);
      const dst = path ? nodeFromPath(cloneRoot, path) : null;
      if (!(dst instanceof HTMLImageElement)) continue;

      // Keep citation domain before inlining wipes google.com/s2/favicons?domain=
      const rawSrc = srcImg.currentSrc || srcImg.getAttribute("src") || "";
      const fromFav = hrefFromFaviconSrc(rawSrc) || hrefFromFaviconSrc(dst.getAttribute("src") || "");
      if (fromFav) dst.setAttribute("data-cgpt-dl-href", fromFav);

      const dataUrl = await imgToDataUrl(srcImg);
      if (!dataUrl) continue;
      dst.setAttribute("src", dataUrl);
      dst.removeAttribute("srcset");
    }
  }

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

  const URL_PROP_KEYS = [
    "url",
    "permalink",
    "href",
    "link",
    "sourceUrl",
    "canonicalUrl",
    "full_url",
    "display_url",
    "attribution_url",
    "target_url",
    "uri",
    "website",
    "webUrl",
    "citationUrl",
    "landingUrl",
  ];

  function collectHttpStrings(value, out, depth, seen) {
    if (value == null || depth > 10 || out.length > 80) return;
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value) || /^\/\//.test(value)) {
        const href = normalizeHttpUrl(value);
        if (href) out.push(href);
      }
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) collectHttpStrings(item, out, depth + 1, seen);
      return;
    }
    for (const key of URL_PROP_KEYS) {
      if (typeof value[key] === "string") collectHttpStrings(value[key], out, depth + 1, seen);
    }
    if (typeof value.href === "string") collectHttpStrings(value.href, out, depth + 1, seen);
    for (const item of Object.values(value)) {
      if (!item || typeof item === "function") continue;
      collectHttpStrings(item, out, depth + 1, seen);
    }
  }

  function pickBestUrlForLabel(urls, label) {
    const norm = [...new Set((urls || []).map((u) => normalizeHttpUrl(u)).filter(Boolean))];
    if (!norm.length) return null;
    if (norm.length === 1) return norm[0];
    const tokens = String(label || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2);
    if (!tokens.length) return null;
    let best = null;
    let bestScore = 0;
    for (const u of norm) {
      let score = 0;
      try {
        const host = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
        const path = new URL(u).pathname.toLowerCase();
        for (const t of tokens) {
          if (host.includes(t)) score += t.length * 3;
          else if (path.includes(t)) score += t.length;
        }
      } catch {
        /* ignore */
      }
      if (score > bestScore) {
        bestScore = score;
        best = u;
      }
    }
    return bestScore > 0 ? best : null;
  }

  function digUrlFromReact(el, label) {
    if (!(el instanceof Element)) return null;
    let node = el;
    for (let up = 0; up < 10 && node; up++, node = node.parentElement) {
      const keys = Object.keys(node);
      for (const key of keys) {
        if (!key.startsWith("__react")) continue;
        const preferred = digUrlInValue(node[key], 0, new Set());
        if (preferred) return preferred;
        const collected = [];
        collectHttpStrings(node[key], collected, 0, new Set());
        const picked = pickBestUrlForLabel(collected, label || el.textContent || "");
        if (picked) return picked;
      }
    }
    return null;
  }

  function digUrlInValue(value, depth, seen) {
    if (value == null || depth > 9) return null;
    if (typeof value === "string") return normalizeHttpUrl(value);
    if (typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);
    if (typeof value.href === "string") {
      const href = normalizeHttpUrl(value.href);
      if (href) return href;
    }
    for (const key of URL_PROP_KEYS) {
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
    const label = (el.textContent || "").replace(/\s+/g, " ").trim();

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
      "data-cgpt-dl-href",
    ]) {
      const href = normalizeHttpUrl(el.getAttribute(attr));
      if (href) return href;
    }

    // Any attribute that looks like an absolute URL
    for (const attr of el.getAttributeNames?.() || []) {
      const href = normalizeHttpUrl(el.getAttribute(attr));
      if (href) return href;
    }

    const fav = el.querySelector?.('img[src*="favicon"], img[src*="Favicon"], img[data-cgpt-dl-href]');
    if (fav) {
      const href =
        normalizeHttpUrl(fav.getAttribute("data-cgpt-dl-href")) ||
        hrefFromFaviconSrc(fav.getAttribute("src") || fav.src);
      if (href) return href;
    }

    const reactUrl = digUrlFromReact(el, label);
    if (reactUrl) return reactUrl;

    // Domain-looking label on source chips (e.g. "enqa.eu")
    if (label && label.length < 80 && !/\s/.test(label)) {
      const fromText = normalizeHttpUrl(label);
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

  function rememberLabelHref(labelHref, label, href) {
    const key = String(label || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!key || key.length >= 80 || !href) return;
    labelHref.set(key, href);
    // Also index the first token ("ENQA / ESG" → "enqa")
    const first = key.split(/[\/|,·•\-–—]/)[0]?.trim();
    if (first && first.length >= 2 && first !== key) labelHref.set(first, href);
  }

  function lookupLabelHref(labelHref, text) {
    const key = String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!key) return null;
    if (labelHref.has(key)) return labelHref.get(key);
    const first = key.split(/[\/|,·•\-–—]/)[0]?.trim();
    if (first && labelHref.has(first)) return labelHref.get(first);
    return null;
  }

  function citationLinkTarget(el) {
    if (!(el instanceof Element)) return el;
    return (
      el.closest?.(
        '[data-d-component="popover-trigger"], [data-d-component="pressable"], [data-d-component="badge"], [data-cgpt-dl-static]'
      ) || el
    );
  }

  function ensureElementIsLink(el, href) {
    const url = normalizeHttpUrl(href);
    if (!el || !url) return null;

    if (el.tagName === "A") {
      el.setAttribute("href", url);
      styleExportLink(el);
      return el;
    }

    // Flatten nested anchors so we don't leave <span><a>…</a></span>
    qsa(el, "a[href]").forEach((nested) => {
      const parent = nested.parentNode;
      if (!parent) return;
      while (nested.firstChild) parent.insertBefore(nested.firstChild, nested);
      nested.remove();
    });

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

  function hoistNestedCitationLinks(cloneRoot) {
    qsa(
      cloneRoot,
      '[data-d-component="popover-trigger"] a[href], [data-d-component="pressable"] a[href], [data-cgpt-dl-static] a[href]'
    ).forEach((inner) => {
      const href = normalizeHttpUrl(inner.getAttribute("href") || inner.href);
      if (!href) return;
      const wrap = citationLinkTarget(inner);
      if (!wrap || wrap === inner || wrap.tagName === "A") {
        styleExportLink(inner);
        return;
      }
      ensureElementIsLink(wrap, href);
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isCitationClickCandidate(el) {
    if (!(el instanceof Element)) return false;
    if (el.closest?.(`.${D.BTN_CLASS}, #${D.LAYER_ID}, [data-cgpt-dl-link]`)) return false;
    if (el.closest?.('[class*="Radio"], [role="radiogroup"], [data-d-component="radio"]')) {
      return false;
    }
    if (el.closest?.('[data-testid*="composer"], form, nav, [role="navigation"]')) return false;
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 90) return false;
    return true;
  }

  function extractHrefsFromNode(root) {
    const hrefs = [];
    if (!(root instanceof Element)) return hrefs;
    qsa(root, "a[href]").forEach((a) => {
      const href = normalizeHttpUrl(a.getAttribute("href") || a.href);
      if (href) hrefs.push(href);
    });
    qsa(root, 'img[src*="favicon"], img[src*="Favicon"]').forEach((img) => {
      const href = hrefFromFaviconSrc(img.getAttribute("src") || img.src);
      if (href) hrefs.push(href);
    });
    const text = root.textContent || "";
    const re = /https?:\/\/[^\s<>"'）】\]]+/gi;
    let m;
    while ((m = re.exec(text))) {
      const href = normalizeHttpUrl(m[0].replace(/[.,);:]+$/g, ""));
      if (href) hrefs.push(href);
    }
    return hrefs;
  }

  function findOpenCitationSurfaces() {
    const sels = [
      "[data-radix-popper-content-wrapper]",
      "[data-radix-menu-content]",
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[data-state="open"]',
      '[data-d-component="popover"]',
      '[class*="PopoverContent"]',
      '[class*="popover-content"]',
      '[class*="Citation"]',
      '[class*="citation"]',
    ];
    const out = [];
    const seen = new Set();
    for (const sel of sels) {
      qsa(document, sel).forEach((el) => {
        if (seen.has(el)) return;
        if (el.closest?.(`.${D.BTN_CLASS}, #${D.LAYER_ID}`)) return;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return;
        // Must look like a floating card, not the whole app shell
        if (r.width > window.innerWidth * 0.92 && r.height > window.innerHeight * 0.6) return;
        seen.add(el);
        out.push(el);
      });
    }
    return out;
  }

  function closeOpenCitationUi() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
      })
    );
  }

  function stampCitationHref(el, href) {
    const url = normalizeHttpUrl(href);
    if (!el || !url) return;
    el.setAttribute("data-cgpt-dl-href", url);
    const target = citationLinkTarget(el);
    if (target && target !== el) target.setAttribute("data-cgpt-dl-href", url);
    const dotted = el.matches?.('[data-d-text-decoration="underline-dotted"]')
      ? el
      : el.querySelector?.('[data-d-text-decoration="underline-dotted"]');
    if (dotted) dotted.setAttribute("data-cgpt-dl-href", url);
  }

  /**
   * ChatGPT citations are often JS pressables (no href). Click them on the live
   * page, read the URL from the opened popover/card, stamp data-cgpt-dl-href.
   */
  async function harvestCitationHrefsByClick(sourceRoot) {
    if (!(sourceRoot instanceof Element)) return;

    const seen = new Set();
    const triggers = [];
    const consider = (el) => {
      if (!(el instanceof Element) || !isCitationClickCandidate(el)) return;
      const target = citationLinkTarget(el) || el;
      if (seen.has(target)) return;
      if (resolveHrefFromLive(target) || resolveHrefFromLive(el)) return;
      seen.add(target);
      triggers.push(target);
    };

    qsa(sourceRoot, '[data-d-text-decoration="underline-dotted"]').forEach(consider);
    qsa(
      sourceRoot,
      '[data-d-component="pressable"], [data-d-component="popover-trigger"], [aria-haspopup="dialog"]'
    ).forEach(consider);

    for (const el of triggers) {
      const label = (el.textContent || "").replace(/\s+/g, " ").trim();
      closeOpenCitationUi();
      await sleep(30);

      try {
        el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        el.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" })
        );
        el.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })
        );
        el.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse" })
        );
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        el.click();
      } catch {
        /* ignore */
      }

      let href = null;
      for (let attempt = 0; attempt < 8 && !href; attempt++) {
        await sleep(50);
        await nextFrame();
        const surfaces = findOpenCitationSurfaces();
        for (const surface of surfaces) {
          if (el.contains(surface)) continue;
          const hrefs = extractHrefsFromNode(surface);
          href = pickBestUrlForLabel(hrefs, label) || (hrefs.length === 1 ? hrefs[0] : null);
          if (!href) href = digUrlFromReact(surface, label);
          if (href) break;
        }
      }

      if (href) stampCitationHref(el, href);
      closeOpenCitationUi();
      await sleep(40);
    }
    closeOpenCitationUi();
  }

  async function preserveHyperlinks(sourceRoot, cloneRoot) {
    // Click live citation widgets so popover URLs become recoverable
    await harvestCitationHrefsByClick(sourceRoot);

    // Map visible labels → href from any real anchors still on the live reply
    const labelHref = new Map();
    const rememberFromEl = (el, href) => {
      if (!href) return;
      rememberLabelHref(labelHref, el?.textContent || "", href);
    };

    qsa(sourceRoot, "a[href]").forEach((a) => {
      const href = normalizeHttpUrl(a.getAttribute("href") || a.href);
      rememberFromEl(a, href);
    });

    // Pre-harvest citation URLs from live React trees + stamped popover hrefs
    const citationSel =
      '[data-d-component="popover-trigger"], [aria-haspopup="dialog"], [data-d-component="pressable"], [data-d-text-decoration="underline-dotted"]';
    qsa(sourceRoot, citationSel).forEach((el) => {
      const href = resolveHrefFromLive(el);
      if (href) rememberFromEl(el, href);
    });

    const pairAndLinkify = (srcNodes, dstNodes) => {
      const n = Math.min(srcNodes.length, dstNodes.length);
      for (let i = 0; i < n; i++) {
        const src = srcNodes[i];
        const dst = dstNodes[i];
        if (!(dst instanceof Element)) continue;
        if (dst.closest?.("a[href]")) {
          const existing = dst.closest("a[href]");
          styleExportLink(existing);
          rememberFromEl(existing, normalizeHttpUrl(existing.getAttribute("href")));
          continue;
        }
        let href = resolveHrefFromLive(src);
        if (!href) href = lookupLabelHref(labelHref, src.textContent || "");
        if (!href) href = lookupLabelHref(labelHref, dst.textContent || "");
        if (!href) continue;
        const target = citationLinkTarget(dst);
        const linked = ensureElementIsLink(target, href);
        rememberFromEl(linked || dst, href);
      }
    };

    const triggerSel =
      '[data-d-component="popover-trigger"], [aria-haspopup="dialog"], [data-d-component="pressable"]';
    const dottedSel = '[data-d-text-decoration="underline-dotted"]';

    // Pass 1–2: recover from live DOM + any known labels
    pairAndLinkify(qsa(sourceRoot, triggerSel), qsa(cloneRoot, triggerSel));
    pairAndLinkify(qsa(sourceRoot, dottedSel), qsa(cloneRoot, dottedSel));

    // Source chips: URL often only exists as Google favicon ?domain=
    const srcFavs = qsa(sourceRoot, 'img[src*="favicon"], img[src*="Favicon"]');
    const dstFavs = qsa(cloneRoot, 'img[src*="favicon"], img[src*="Favicon"]');
    const favN = Math.min(srcFavs.length, dstFavs.length);
    for (let i = 0; i < favN; i++) {
      const dstImg = dstFavs[i];
      if (dstImg.closest("a[href]")) continue;

      const srcHost =
        srcFavs[i].closest(
          '[data-d-component="badge"], [data-d-component="popover-trigger"], [data-d-component="pressable"], a, div, span'
        ) || srcFavs[i].parentElement;

      let href =
        resolveHrefFromLive(srcHost) ||
        hrefFromFaviconSrc(srcFavs[i].getAttribute("src") || srcFavs[i].src) ||
        hrefFromFaviconSrc(dstImg.getAttribute("src") || dstImg.src);

      const chip =
        dstImg.closest(
          '[data-d-component="badge"], [data-d-component="popover-trigger"], [data-d-component="pressable"], [data-cgpt-dl-static]'
        ) || dstImg.parentElement?.parentElement;
      if (!chip || chip.closest("a[href]")) continue;

      if (!href) href = lookupLabelHref(labelHref, chip.textContent || "");
      if (!href) {
        const domainText = (chip.textContent || "").match(
          /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i
        );
        if (domainText) href = normalizeHttpUrl(domainText[0]);
      }
      if (!href) continue;
      const linked = ensureElementIsLink(chip, href);
      rememberFromEl(linked || chip, href);
    }

    // Index every recovered anchor, then retry still-unlinked dotted/pressable cells
    qsa(cloneRoot, "a[href]").forEach((a) => {
      const href = normalizeHttpUrl(a.getAttribute("href") || a.href);
      rememberFromEl(a, href);
    });
    pairAndLinkify(qsa(sourceRoot, dottedSel), qsa(cloneRoot, dottedSel));
    pairAndLinkify(qsa(sourceRoot, triggerSel), qsa(cloneRoot, triggerSel));

    // Promote <span popover-trigger><a>…</a></span> → single <a>
    hoistNestedCitationLinks(cloneRoot);

    // Final pass: polish every remaining anchor
    qsa(cloneRoot, "a[href]").forEach((a) => {
      const href = normalizeHttpUrl(a.getAttribute("href") || a.href);
      if (!href) return;
      a.setAttribute("href", href);
      styleExportLink(a);
    });
  }

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

  function isExportChromeControl(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.classList.contains(D.BTN_CLASS) || el.closest(`.${D.BTN_CLASS}`)) return true;
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
        `.${D.BTN_CLASS}`,
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
  Object.assign(D, {
    collectAuthorCssText,
    blobToDataUrl,
    fetchDataUrlViaExtension,
    urlToDataUrl,
    canvasFromImage,
    imgToDataUrl,
    findBgImageUrl,
    injectImgIntoTile,
    embedContentImages,
    refillEmptyImageTiles,
    inlineImages,
    waitForClientRender,
    isIconSvg,
    isSubstantialVisual,
    styleSvgClone,
    svgToDataUrl,
    svgToPngDataUrl,
    embedRenderedVisuals,
    looksLikeMermaidSource,
    ensureMermaidLib,
    renderMermaidSourcesIntoClone,
    annotateUnrenderedDiagrams,
    absolutizeUrls,
    isHttpUrl,
    normalizeHttpUrl,
    hrefFromFaviconSrc,
    digUrlFromReact,
    digUrlInValue,
    resolveHrefFromLive,
    styleExportLink,
    ensureElementIsLink,
    preserveHyperlinks,
    preserveCodeBlockLangLabels,
    isExportChromeControl,
    buttonToStaticDiv,
    isLiveRadioChecked,
    makeRadioDot,
    paintRadioIndicators,
    makeOptionCheck,
    isOptionSelected,
    paintOptionChecks,
    freezeInteractiveWidgets,
    stripInteractiveNoise,
  });
})();
