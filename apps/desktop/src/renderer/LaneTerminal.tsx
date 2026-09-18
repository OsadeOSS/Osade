import { useEffect, useRef, type JSX } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { api } from './api.js';
import { terminalKeyAction } from './lane-terminal.js';

/** Interactive PowerShell (or $SHELL) PTY in this lane's checkout. */
export function LaneTerminal({
  taskId,
  visible,
}: {
  taskId: string;
  visible: boolean;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const term = new Terminal({
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: '"IBM Plex Mono", ui-monospace, "Cascadia Code", Consolas, monospace',
      fontSize: 12.5,
      theme: {
        background: '#0f1214',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#22272e',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;

    const fitNow = (): void => {
      if (el.clientWidth < 8 || el.clientHeight < 8) return;
      try {
        fit.fit();
      } catch {
        // host not measured yet
      }
    };
    fitNow();
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

    void api
      .taskShellOpen(taskId, size)
      .then(() => {
        if (stop) return;
        data = term.onData((chunk) => {
          void api.taskShellWrite(taskId, chunk).catch((err: Error) => {
            term.write(`\r\n\x1b[31m${err.message}\x1b[0m\r\n`);
          });
        });
        resized = term.onResize(({ cols, rows }) => {
          if (cols >= 2 && rows >= 2) void api.taskShellResize(taskId, cols, rows);
        });
      })
      .catch((err: Error) => {
        if (!stop) term.writeln(`\x1b[31m${err.message}\x1b[0m`);
      });

    const timer = window.setInterval(() => {
      void api.taskShellRead(taskId).then((chunk) => {
        if (chunk.text.length > 0) term.write(chunk.text);
      });
    }, 16);

    const ro = new ResizeObserver(() => {
      fitNow();
    });
    ro.observe(el);

    return () => {
      stop = true;
      data?.dispose();
      resized?.dispose();
      window.clearInterval(timer);
      ro.disconnect();
      el.removeEventListener('paste', onPaste, true);
      termRef.current = null;
      fitRef.current = null;
      term.dispose();
    };
  }, [taskId]);

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
        background: '#0f1214',
      }}
    />
  );
}
