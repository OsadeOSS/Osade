import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from 'react';

import type { BrowserShot, BrowserState } from '../main/browser-contract.js';

import { DEFAULT_BROWSER_URL, normaliseUrl } from './browser-view.js';
import { BrowserShotOverlay, type ShotDraft } from './BrowserShot.js';

const BLANK: BrowserState = {
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
};

export interface BrowserPaneProps {
  onClose: () => void;
}

/**
 * The browser pane's chrome — issue #13.
 *
 * The page itself is **not** here. It is a `WebContentsView` parented to the window in the main
 * process, and it paints over this component whatever z-index this component asks for. So this
 * component's real job is the unglamorous one: reserve exactly the right rectangle, in CSS
 * pixels, and tell main about it. `ResizeObserver` catches size changes; a window `resize`
 * listener catches the pane being moved without being resized.
 *
 * While the annotator is up the view is detached rather than covered, because "hidden" for a
 * native child view means "not a child of this window".
 *
 * The pane owns its URL, and always starts at `DEFAULT_BROWSER_URL` — opening the pane is a
 * request to look at your dev server, not to be returned to wherever you were yesterday.
 */
export function BrowserPane({ onClose }: BrowserPaneProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<BrowserState>(BLANK);
  const [draft, setDraft] = useState(DEFAULT_BROWSER_URL);
  /** The user is part-way through typing an address; the bar must not be overwritten. */
  const [editing, setEditing] = useState(false);
  const [shot, setShot] = useState<ShotDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bridge = window.osade?.browser;
  const annotating = shot != null;

  useEffect(() => {
    if (bridge == null) return;
    const off = bridge.onChanged(setState);
    void bridge.state().then(setState, () => setState(BLANK));
    return off;
  }, [bridge]);

  useEffect(() => {
    if (bridge == null) return;
    void bridge.open(DEFAULT_BROWSER_URL).then(setState, (err: Error) => setError(err.message));
    return () => {
      void bridge.close().catch(() => undefined);
    };
  }, [bridge]);

  /**
   * The bar follows the page.
   *
   * Without this the address bar keeps showing whatever was last typed while the page walks off
   * to somewhere else — a link, a redirect, a login bounce — and a bar that lies about where you
   * are is worse than no bar. Skipped while `editing`, so a redirect cannot eat an address
   * someone is in the middle of typing, and skipped for the two URLs that are not really
   * addresses at all.
   */
  useEffect(() => {
    if (editing) return;
    if (state.url === '' || state.url === 'about:blank') return;
    setDraft(state.url);
  }, [state.url, editing]);

  const publishBounds = useCallback(() => {
    const host = hostRef.current;
    if (bridge == null || host == null) return;
    if (annotating) {
      void bridge.bounds(null);
      return;
    }
    const box = host.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) {
      void bridge.bounds(null);
      return;
    }
    void bridge.bounds({
      x: box.left,
      y: box.top,
      width: box.width,
      height: box.height,
    });
  }, [annotating, bridge]);

  useLayoutEffect(() => {
    publishBounds();
  }, [publishBounds]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host == null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => publishBounds());
    observer.observe(host);
    // The pane is a fixed-width column on the right, so a window resize moves it without
    // resizing it — and the observer only sees size.
    window.addEventListener('resize', publishBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', publishBounds);
    };
  }, [publishBounds]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || shot == null) return;
      event.preventDefault();
      setShot(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shot]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function capture(): Promise<void> {
    if (bridge == null) return;
    await run(async () => {
      const image: BrowserShot = await bridge.screenshot();
      setShot({ image, url: image.url !== '' ? image.url : state.url });
    });
  }

  async function submit(urlText: string): Promise<void> {
    const next = normaliseUrl(urlText);
    setEditing(false);
    setDraft(next);
    if (bridge == null) return;
    await run(async () => {
      setState(await bridge.load(next));
    });
  }

  const unsupported = bridge == null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--bg-0)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          borderBottom: '0.5px solid var(--line)',
          background: 'var(--bg-1)',
        }}
      >
        <IconButton label="Back" disabled={busy || !state.canGoBack} onClick={() => void run(() => bridge?.back() ?? Promise.resolve(false))}>
          <path d="M15 18l-6-6 6-6" />
        </IconButton>
        <IconButton
          label="Forward"
          disabled={busy || !state.canGoForward}
          onClick={() => void run(() => bridge?.forward() ?? Promise.resolve(false))}
        >
          <path d="M9 18l6-6-6-6" />
        </IconButton>
        <IconButton
          label="Reload"
          disabled={busy || unsupported}
          onClick={() => void run(() => Promise.resolve(bridge?.reload()))}
        >
          <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" />
        </IconButton>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(draft);
          }}
          style={{ flex: 1, minWidth: 0, display: 'flex' }}
        >
          <input
            value={draft}
            spellCheck={false}
            disabled={unsupported}
            aria-label="Browser address"
            placeholder={DEFAULT_BROWSER_URL}
            onChange={(event) => {
              setEditing(true);
              setDraft(event.target.value);
            }}
            onFocus={(event) => event.currentTarget.select()}
            style={{ height: 28, padding: '0 8px', fontSize: 'var(--t-s)' }}
          />
        </form>
        <IconButton
          label="Screenshot"
          disabled={busy || unsupported}
          onClick={() => void capture()}
          title="Screenshot, then click an element to tag it"
        >
          <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
          <circle cx="12" cy="13" r="3.2" />
        </IconButton>
        <IconButton
          label="Open in your browser"
          disabled={busy || unsupported || state.url === ''}
          onClick={() => void run(() => Promise.resolve(bridge?.openExternal()))}
        >
          <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
        </IconButton>
        <IconButton label="Close browser" onClick={onClose}>
          <path d="M6 6l12 12M18 6L6 18" />
        </IconButton>
      </div>

      {state.title !== '' && (
        <div
          title={state.title}
          style={{
            padding: '3px 10px',
            fontSize: 'var(--t-xs)',
            color: 'var(--ink-3)',
            borderBottom: '0.5px solid var(--line)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            background: 'var(--bg-1)',
          }}
        >
          {state.loading ? 'Loading…' : state.title}
        </div>
      )}

      {(error ?? state.error) != null && (
        <div
          style={{
            padding: '6px 10px',
            fontSize: 'var(--t-xs)',
            color: 'var(--st-fail)',
            borderBottom: '0.5px solid var(--line)',
            background: 'var(--bg-1)',
          }}
        >
          {error ?? state.error}
        </div>
      )}

      {unsupported && (
        <p style={{ margin: 0, padding: '10px 12px', fontSize: 'var(--t-s)', color: 'var(--ink-2)' }}>
          The browser pane needs the desktop shell. It is not available in a plain browser.
        </p>
      )}

      {/*
        The slot the native view sits in. It carries the app's background so a gap during a
        reload reads as "loading" rather than as a hole in the layout, and it is the element
        whose rectangle main is told about.
      */}
      <div
        ref={hostRef}
        data-browser-slot=""
        style={{
          flex: 1,
          minHeight: 0,
          background: 'var(--bg-0)',
          position: 'relative',
        }}
      />

      {shot != null && (
        <BrowserShotOverlay
          shot={shot.image}
          url={shot.url}
          onClose={() => setShot(null)}
          onRetake={() => {
            setShot(null);
            void capture();
          }}
        />
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  title,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}): JSX.Element {
  const style: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    padding: 0,
    flexShrink: 0,
    background: 'transparent',
    border: 'none',
    color: 'var(--ink-2)',
  };
  return (
    <button type="button" aria-label={label} title={title ?? label} disabled={disabled} onClick={onClick} style={style}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}
