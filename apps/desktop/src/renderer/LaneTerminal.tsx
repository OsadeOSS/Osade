import { useEffect, useRef, type JSX } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { api, type ShellKind } from './api.js';
import { terminalKeyAction } from './lane-terminal.js';

const BACKGROUND = '#0f1214';

/** Full 16-colour palette so TUIs (Claude, Codex, htop, git) render as they do in a real terminal. */
const THEME: ITheme = {
  background: BACKGROUND,
  foreground: '#c9d1d9',
  cursor: '#58a6ff',
  cursorAccent: BACKGROUND,
  selectionBackground: '#264f78',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
};

/** Poll faster while output is flowing, so a burst drains without 16 ms steps between chunks. */
const IDLE_POLL_MS = 16;
const BUSY_POLL_MS = 4;

/** Where a terminal's bytes go: a lane's shell, or a standalone terminal tab's. */
interface PtyBackend {
  /** `replay` is the shell's recent output when reattaching to one that is already running. */
  open: (size: { cols: number; rows: number }) => Promise<{ replay: string }>;
  read: () => Promise<{ text: string }>;
  write: (data: string) => Promise<unknown>;
  resize: (cols: number, rows: number) => Promise<unknown>;
}

/** Interactive PowerShell (or $SHELL) PTY in this lane's checkout. */
export function LaneTerminal({ taskId, visible }: { taskId: string; visible: boolean }): JSX.Element {
  return (
    <PtyTerminal
      sessionKey={taskId}
      visible={visible}
      backend={{
        open: (size) => api.taskShellOpen(taskId, size),
        read: () => api.taskShellRead(taskId),
        write: (data) => api.taskShellWrite(taskId, data),
        resize: (cols, rows) => api.taskShellResize(taskId, cols, rows),
      }}
    />
  );
}

/** A terminal tab: its own PTY in a folder, running the shell the user picked. */
export function ShellTerminal({
  id,
  cwd,
  shell,
  visible,
  onTitle,
}: {
  id: string;
  cwd: string;
  shell: ShellKind;
  visible: boolean;
  /** The title the program running in it sets — how agents started by hand are spotted. */
  onTitle?: (title: string) => void;
}): JSX.Element {
  return (
    <PtyTerminal
      sessionKey={id}
      visible={visible}
      onTitle={onTitle}
      backend={{
        open: (size) => api.terminalOpen(id, cwd, shell, size),
        read: () => api.terminalRead(id),
        write: (data) => api.terminalWrite(id, data),
        resize: (cols, rows) => api.terminalResize(id, cols, rows),
      }}
    />
  );
}

function PtyTerminal({
  sessionKey,
  visible,
  backend,
  onTitle,
}: {
  sessionKey: string;
  visible: boolean;
  backend: PtyBackend;
  onTitle?: (title: string) => void;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  // Read through a ref so a new callback each render does not restart the session.
  const titleRef = useRef(onTitle);
  titleRef.current = onTitle;
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const term = new Terminal({
      cursorBlink: true,
      scrollback: 10_000,
      fontFamily: '"IBM Plex Mono", ui-monospace, "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      macOptionIsMeta: true,
      // Unicode 11 widths go through the proposed API.
      allowProposedApi: true,
      theme: THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const unicode = new Unicode11Addon();
    term.loadAddon(unicode);
    term.unicode.activeVersion = '11';
    // Opens through the main window's handler, which hands it to the system browser.
    term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')));
    const titled = term.onTitleChange((title) => titleRef.current?.(title));
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;

    // GPU rendering, as in Ghostty/Orca. The DOM renderer takes over if WebGL is unavailable or lost.
    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl?.dispose();
        webgl = null;
      });
      term.loadAddon(webgl);
    } catch {
      webgl = null;
    }

    const fitNow = (): void => {
      if (el.clientWidth < 8 || el.clientHeight < 8) return;
      try {
        fit.fit();
      } catch {
        // host not measured yet
      }
    };
    fitNow();
    // Glyphs measured before the web font loads come out the wrong width.
    void document.fonts.ready.then(() => {
      if (stop) return;
      webgl?.clearTextureAtlas();
      fitNow();
    });
    const size = {
      cols: Math.max(term.cols, 80),
      rows: Math.max(term.rows, 24),
    };

    let stop = false;
    let pasteEpoch = 0;
    let data: { dispose: () => void } | null = null;
    let resized: { dispose: () => void } | null = null;

    const applyPaste = (text: string): void => {
      if (text.length === 0) return;
      term.paste(text);
    };

    term.attachCustomKeyEventHandler((ev) => {
      const action = terminalKeyAction(ev);
      if (action === 'paste') {
        const epoch = ++pasteEpoch;
        void navigator.clipboard.readText().then((text) => {
          if (epoch !== pasteEpoch) return;
          applyPaste(text);
        }).catch(() => {
          // the paste event may still deliver the text
        });
        return false;
      }
      if (action === 'copy') {
        if (!term.hasSelection()) return true;
        const selected = term.getSelection();
        if (selected.length > 0) void navigator.clipboard.writeText(selected).catch(() => undefined);
        return false;
      }
      return true;
    });

    const onPaste = (event: ClipboardEvent): void => {
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (text.length === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pasteEpoch += 1;
      applyPaste(text);
    };
    el.addEventListener('paste', onPaste, true);

    let timer: number | undefined;
    // One read in flight at a time: overlapping reads can land out of order and garble output.
    const poll = (): void => {
      void backend
        .read()
        .then(
          (chunk) => {
            if (stop) return;
            if (chunk.text.length > 0) term.write(chunk.text);
            timer = window.setTimeout(poll, chunk.text.length > 0 ? BUSY_POLL_MS : IDLE_POLL_MS);
          },
          () => {
            if (!stop) timer = window.setTimeout(poll, IDLE_POLL_MS);
          },
        );
    };

    void backend
      .open(size)
      .then(({ replay }) => {
        if (stop) return;
        // Reads start after the replay, which already holds anything unread.
        if (replay.length > 0) term.write(replay);
        poll();
        data = term.onData((chunk) => {
          void backend.write(chunk).catch((err: Error) => {
            term.write(`\r\n\x1b[31m${err.message}\x1b[0m\r\n`);
          });
        });
        resized = term.onResize(({ cols, rows }) => {
          if (cols >= 2 && rows >= 2) void backend.resize(cols, rows);
        });
      })
      .catch((err: Error) => {
        if (!stop) term.writeln(`\x1b[31m${err.message}\x1b[0m`);
      });

    const ro = new ResizeObserver(() => {
      fitNow();
    });
    ro.observe(el);

    return () => {
      stop = true;
      data?.dispose();
      resized?.dispose();
      titled.dispose();
      window.clearTimeout(timer);
      ro.disconnect();
      el.removeEventListener('paste', onPaste, true);
      termRef.current = null;
      fitRef.current = null;
      term.dispose();
    };
    // The backend closes over the same key; a new key is a new session.
  }, [sessionKey]);

  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    const el = host.current;
    if (!term) return;
    if (visible) {
      term.focus();
      if (el && el.clientWidth >= 8 && el.clientHeight >= 8) {
        try {
          fit?.fit();
        } catch {
          // host not measured yet
        }
      }
      return;
    }
    term.blur();
  }, [visible]);

  return (
    <div
      ref={host}
      style={{
        height: '100%',
        width: '100%',
        minHeight: 0,
        background: BACKGROUND,
      }}
    />
  );
}
