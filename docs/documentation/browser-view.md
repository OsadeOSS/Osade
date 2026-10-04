---
title: Browser view
description: Keep a live web page beside the chat and send an annotated screenshot of the exact element you mean.
---

# Browser view

The browser view places a web page beside the active Osade session. Use it to inspect a local dev
server, reproduce a UI problem, or show an agent a visual result without switching applications.

Open or close it with the **Browser** button, the command center, or
`Ctrl+Shift+B` (`Cmd+Shift+B` on macOS). Drag the divider to resize the pane; double-click the
divider to restore its default width.

## Navigate

The toolbar provides Back, Forward, Reload, an address field, Screenshot, and **Open in your
browser**. A bare host is normalized to HTTPS, while `localhost` keeps HTTP. The embedded pane
accepts only `http` and `https` URLs.

Every time the pane opens it starts at the configured local development URL. The address bar
follows links and redirects so it continues to show the page that is actually open.

## Send an annotated screenshot

1. Open the page you want the agent to inspect.
2. Select **Screenshot**.
3. Click the element you mean in the full-window preview.
4. Confirm the box and element label, or choose **Retake**.
5. Select **Add to chat**, add any explanation, and send the message.

Osade adds the captured PNG to the composer and appends context containing the page URL and the
selected element. The image sent to the agent includes the same box and label shown in the
preview. You can also add the screenshot without selecting an element.

Large captures are scaled before sending so they remain within the attachment limit.

## Isolation

The page runs in a separate Electron `WebContentsView`. It has no Osade preload bridge, no Node.js
access, and a cookie partition separate from the app. New windows are handed to the operating
system browser. Local `file:` URLs and other non-web schemes are refused.

The browser view is available in the desktop shell, not when the renderer is opened as an ordinary
web page.
