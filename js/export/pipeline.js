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

  async function exportContent(content, downloadBtn) {
    if (!content) {
      alert("Could not find the response content to download.");
      return;
    }
    if (downloadBtn.dataset.state === "busy") return;

    downloadBtn.dataset.state = "busy";
    downloadBtn.innerHTML = D.LOADING_ICON;
    downloadBtn.setAttribute("aria-label", "Preparing download…");
    await nextFrame();

    try {
      // 1) Wait for in-viewport client widgets
      downloadBtn.setAttribute("aria-label", "Waiting for diagrams…");
      await D.waitForClientRender(content);

      // 2) Clone + inline computed styles
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;left:-9999px;top:0;visibility:hidden;";
      document.body.appendChild(probe);
      const defaults = getComputedStyle(probe);
      const clone = content.cloneNode(true);
      downloadBtn.setAttribute("aria-label", "Capturing styles…");
      await D.inlineComputedStylesAsync(content, clone, defaults);
      probe.remove();

      // 3) Diagrams / Mermaid
      downloadBtn.setAttribute("aria-label", "Capturing diagrams…");
      await D.embedRenderedVisuals(content, clone);
      await D.renderMermaidSourcesIntoClone(content, clone);

      // 4) Freeze chrome, recover links (before favicon inlining wipes ?domain=), then images
      D.freezeInteractiveWidgets(content, clone);
      D.stripInteractiveNoise(clone);
      downloadBtn.setAttribute("aria-label", "Recovering links…");
      await D.preserveHyperlinks(content, clone);
      downloadBtn.setAttribute("aria-label", "Capturing images…");
      await D.embedContentImages(content, clone);
      await D.refillEmptyImageTiles(content, clone);

      // 5) Layout polish (dynamic only; static rules in export.css)
      D.fixWritingBlockDuplicates(clone);
      D.stripFocusChrome(clone);
      D.normalizeExportLayout(clone);
      D.annotateUnrenderedDiagrams(clone);
      D.absolutizeUrls(clone);
      await D.inlineImages(clone);

      // 6) Move style="" into deduped head classes — keep HTML markup clean
      downloadBtn.setAttribute("aria-label", "Packaging styles…");
      const authorCss = D.collectAuthorCssText();
      // Resolve CSS vars while inline styles still present, then extract classes
      const cssVars = D.cssVarsBlock(
        D.collectUsedCssVariables(content, clone, authorCss)
      );
      const extractedCss = D.extractInlineStylesToClasses(clone);

      // 7) Build standalone HTML document
      const previewText = (content.innerText || "chatgpt-response").trim();
      const title = slugify(previewText.split("\n").find(Boolean) || "chatgpt-response");
      const filename = `${title}-${timestamp()}.html`;
      const html = await D.buildHtmlDocument({
        bodyHtml: clone.outerHTML,
        cssVars,
        dark: isDarkTheme(),
        title,
        chrome: D.pageChrome(content),
        authorCss,
        extractedCss,
      });
      D.downloadText(filename, html);

      downloadBtn.dataset.state = "done";
      downloadBtn.innerHTML = D.CHECK_ICON;
      downloadBtn.setAttribute("aria-label", "Downloaded");
      setTimeout(() => {
        downloadBtn.dataset.state = "";
        downloadBtn.innerHTML = D.DOWNLOAD_ICON;
        downloadBtn.setAttribute("aria-label", "Download response as HTML");
      }, 1600);
    } catch (err) {
      console.error("[cgpt-dl] export failed", err);
      downloadBtn.dataset.state = "";
      downloadBtn.innerHTML = D.DOWNLOAD_ICON;
      downloadBtn.setAttribute("aria-label", "Download response as HTML");
      alert("Download failed. Check the console for details.");
    }
  }
  Object.assign(D, {
    exportContent,
  });
})();
