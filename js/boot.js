(() => {
  "use strict";
  const D = (globalThis.__CGPT_DL__ = globalThis.__CGPT_DL__ || {});
  const VERSION = D.VERSION || "0";

  if (globalThis.__CGPT_DL_BOOTED__ === VERSION) {
    globalThis.__CGPT_DL_ALIVE__ = true;
    return;
  }

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

  const isTop = window === window.top;
  if (!isTop) return;

  if (typeof D.startUi === "function") D.startUi();
  else console.error("[cgpt-dl] startUi missing — script order broken");
})();
