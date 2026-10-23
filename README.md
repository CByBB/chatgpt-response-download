# ChatGPT Response Download

Browser extension that adds a **Download** button on each ChatGPT reply. One click saves that response as a standalone `.html` file built from the live DOM (styles, tables, email writing-blocks, diagrams).

## Install (Chrome / Edge / Brave)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder (`Chatgpt.com`) — the one that contains `manifest.json`.
5. Confirm the card shows **version 1.6.23** and no red error.
6. Open [chatgpt.com](https://chatgpt.com), hard-refresh (`Ctrl+Shift+R`).
7. Console check (`F12`): `[cgpt-dl] ready v1.6.23`

After any code update: **Reload** the extension, then hard-refresh ChatGPT.

## Use

1. Wait until diagrams/widgets on the reply have finished rendering.
2. Click the download icon (replaces Share on the turn action bar).
3. Open the downloaded `.html` in a browser.

## Notes

- Works on `chatgpt.com` and `chat.openai.com`.
- Export reconstructs the rendered DOM with computed styles (not a screenshot).
- Mermaid source is re-rendered into SVG when ChatGPT did not leave a live diagram in the tree.
- ChatGPT’s DOM changes often; if the button disappears after a site update, say so.

## Files

| Path | Role |
|------|------|
| `manifest.json` | Extension manifest (MV3) |
| `background.js` | Reinject helper + image fetch for base64 |
| `content.css` | Live overlay download button |
| `export/export.css` | Static rules embedded into downloaded HTML |
| `js/util.js` | Shared helpers / version |
| `js/ui.js` | Turn detection + download button |
| `js/export/` | Inline styles, polish, widgets, document, pipeline |
| `js/boot.js` | Version gate + start |
| `icons/` | Extension icons |
