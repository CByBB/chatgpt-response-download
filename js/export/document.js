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

  let _exportCssText = null;
  async function loadExportCss() {
    if (_exportCssText != null) return _exportCssText;
    try {
      const url = chrome.runtime.getURL("export/export.css");
      const res = await fetch(url);
      _exportCssText = res.ok ? await res.text() : "";
    } catch {
      _exportCssText = "";
    }
    return _exportCssText;
  }

  async function buildHtmlDocument({
    bodyHtml,
    cssVars,
    dark,
    title,
    chrome,
    authorCss,
    extractedCss = "",
  }) {
    const bg = chrome?.bg || (dark ? "#212121" : "#ffffff");
    const fg = chrome?.fg || (dark ? "#ececec" : "#0d0d0d");
    const font = chrome?.font || "ui-sans-serif, system-ui, sans-serif";
    const lineHeight = chrome?.lineHeight || "1.6";
    const fontSize = chrome?.fontSize || "16px";
    const maxWidth = chrome?.contentMaxWidth || "48rem";
    const extraCss = authorCss ? `\n/* captured page rules */\n${authorCss}\n` : "";
    const widgetCss = await loadExportCss();
    const elementCss = extractedCss
      ? `\n/* element styles extracted from computed layout */\n${extractedCss}\n`
      : "";

    return `<!DOCTYPE html>
<html lang="en" class="${dark ? "dark" : "light"}" style="color-scheme:${dark ? "dark" : "light"}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
:root {
  --cgpt-dl-max-width: ${maxWidth};
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
${widgetCss}
${extraCss}
${elementCss}
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
  Object.assign(D, {
    loadExportCss,
    buildHtmlDocument,
    downloadText,
  });
})();
