import { BrowserWindow, WebContentsView, shell, type Rectangle } from 'electron';

import {
  elementProbeScript,
  readBounds,
  readElement,
  type BrowserElement,
  type BrowserShot,
  type BrowserState,
  type CssRect,
} from './browser-contract.js';

/**
 * The browser pane's page, in the main process — issue #13.
 *
 * In Electron a tiled browser is a `WebContentsView`: a second Chromium view parented to the
 * window, not an `<iframe>` in the renderer. Three consequences shape everything below.
 *
 *   - It is a **native** view, so it paints over the renderer whatever z-index the renderer
 *     asks for. The only way to get it out from under a renderer overlay is to remove it from
 *     the window — see `setBounds`.
 *   - Its geometry is window coordinates in DIP, and the renderer only knows CSS pixels.
 *     Someone has to divide by the zoom factor; that someone is here, where it lives (`zoom.ts`).
 *   - Nothing in this file may be driven by the page. The pane renders whatever the developer
 *     has running, so it gets no bridge, no Node, and a session partition of its own.
 *
 * Deliberately **not** done: `webSecurity: false`. The spec's mixed-content note is about an
 * iframe inside an HTTPS document. A `WebContentsView` is a top-level browsing context, so
 * `http://localhost:3000` inside a `file://` app is already allowed, and turning the guard off
 * would only weaken every other origin the pane visits.
 */

export interface BrowserViewOptions {
  onInfo: (message: string) => void;
  /** The window's current zoom factor, so CSS pixels can be turned into DIP. */
  zoomFactor: () => number;
}

const BLANK: BrowserState = {
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
};

/** Only these may be loaded into the pane. Everything else is a link out, not a page in. */
const NAVIGABLE = /^https?:\/\//iu;
const ABOUT_BLANK = 'about:blank';

export class BrowserViewHost {
  private view: WebContentsView | null = null;

  private window: BrowserWindow | null = null;

  /** Last bounds asked for, in CSS pixels, so a re-attach can restore them. */
  private wanted: CssRect | null = null;

  private loading = false;

  private error: string | null = null;

  /** Which `load()` is current. Only the newest may report a failure — see `load`. */
  private loadSeq = 0;

  private stateHandlers = new Set<(state: BrowserState) => void>();

  constructor(private readonly options: BrowserViewOptions) {}

  /** A closed pane is indistinguishable from a blank one here, which is the point. */
  state(): BrowserState {
    if (this.view == null) return BLANK;
    return {
      url: this.view.webContents.getURL(),
      title: this.view.webContents.getTitle(),
      loading: this.loading,
      canGoBack: this.view.webContents.navigationHistory.canGoBack(),
      canGoForward: this.view.webContents.navigationHistory.canGoForward(),
      error: this.error,
    };
  }

  onState(handler: (state: BrowserState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  /**
   * Create the view if it does not exist and put it in the window.
   *
   * Idempotent on purpose: the renderer's effects run twice under StrictMode, and neither should
   * reload the page.
   */
  open(win: BrowserWindow, url: string): void {
    this.window = win;
    if (this.view == null) this.view = this.create();
    if (win.contentView.children.includes(this.view) === false) {
      win.contentView.addChildView(this.view);
    }
    this.applyBounds();
    this.load(url);
  }

  close(): void {
    const view = this.view;
    this.view = null;
    this.wanted = null;
    if (view == null) return;
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      if (win.contentView.children.includes(view)) win.contentView.removeChildView(view);
    }
    // The view holds a live renderer process; dropping the reference is not enough.
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  /**
   * Park the view over a rectangle the renderer measured, or take it off the window entirely.
   *
   * `null` is the important case. While a renderer overlay is up — the screenshot annotator — the
   * native view would paint straight over it no matter what z-index the overlay asked for, so
   * "hidden" has to mean "not a child of this window", not "zero-sized".
   */
  setBounds(css: CssRect | null): void {
    this.wanted = readBounds(css);
    this.applyBounds();
  }

  /**
   * Point the pane at a URL.
   *
   * The scheme is checked *here* as well as in `will-navigate`, and the duplicate is the point:
   * `will-navigate` only fires for navigation the page starts, so a `file:///…` typed into the
   * URL bar would walk straight past it. The pane sits inside a tool whose whole value is that it
   * can read your repository — being able to render `file:///…/.ssh/id_rsa` and screenshot it
   * into a chat is not a capability this feature should have.
   */
  async load(url: string): Promise<BrowserState> {
    const view = this.require();
    const target = url.trim() === '' ? ABOUT_BLANK : url.trim();
    const seq = (this.loadSeq += 1);
    if (!NAVIGABLE.test(target) && target !== ABOUT_BLANK) {
      this.error = `refused ${target} — the browser pane only opens http and https`;
      this.options.onInfo(`browser pane refused to load ${target}`);
      this.emit();
      return this.state();
    }
    this.error = null;
    this.loading = true;
    this.emit();
    try {
      await view.webContents.loadURL(target);
    } catch (err) {
      // `loadURL` rejects on the failures it can see (bad scheme, aborted). A page that answers
      // with an error status resolves normally, so this is the narrow path, not the common one.
      //
      // A superseded load — the user pressing Enter twice — rejects with ERR_ABORTED while the
      // page they *did* ask for is loading fine. Letting that through would pin a red error over
      // a working page, so only the newest load gets to say the load failed.
      if (seq === this.loadSeq) {
        this.error = (err as Error).message;
        this.options.onInfo(`browser pane failed to load ${target}: ${(err as Error).message}`);
      }
    } finally {
      if (seq === this.loadSeq) {
        this.loading = false;
        this.emit();
      }
    }
    return this.state();
  }

  reload(): void {
    this.require().webContents.reload();
  }

  goBack(): boolean {
    const history = this.require().webContents.navigationHistory;
    if (!history.canGoBack()) return false;
    history.goBack();
    return true;
  }

  goForward(): boolean {
    const history = this.require().webContents.navigationHistory;
    if (!history.canGoForward()) return false;
    history.goForward();
    return true;
  }

  /** Hand the current page to the operating system's browser and stop. */
  openExternally(): void {
    const url = this.view?.webContents.getURL() ?? '';
    if (url === '' || url === ABOUT_BLANK) return;
    void shell.openExternal(url);
  }

  async screenshot(): Promise<BrowserShot> {
    const view = this.require();
    // An occluded or unpainted view captures as an *empty* image rather than failing, so a
    // 0-byte PNG would otherwise be annotated and sent to the chat as a screenshot of nothing.
    // The same retry the window's own smoke capture uses: a handful of attempts, then say so.
    // `backgroundThrottling: false` in the view's preferences is what keeps a retry from being
    // pointless — a throttled renderer may simply never paint again.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const image = await view.webContents.capturePage();
      const png = image.toPNG();
      if (png.length > 0) {
        const size = image.getSize();
        return {
          data: png.toString('base64'),
          width: size.width,
          height: size.height,
          url: view.webContents.getURL(),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('the browser pane captured nothing — is the window minimised?');
  }

  /**
   * What is under a point in the pane, as a description the agent can act on.
   *
   * The point is normalised (0..1 of the pane) because the click happened on a *screenshot*.
   * The answer is validated in `browser-contract.ts` — the page is not obliged to return the
   * shape the probe asked for.
   */
  async elementAt(fx: number, fy: number): Promise<BrowserElement | null> {
    const view = this.require();
    const raw: unknown = await view.webContents.executeJavaScript(
      elementProbeScript(min(max(fx, 0), 1), min(max(fy, 0), 1)),
      true,
    );
    return readElement(raw);
  }

  private require(): WebContentsView {
    if (this.view == null) throw new Error('the browser pane is not open');
    return this.view;
  }

  private create(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webSecurity: true,
        // Its own partition, so a page's cookies and localStorage never touch Osade's — and so
        // closing the pane can be relied on to not have logged anyone into Osade.
        partition: 'persist:osade-browser-view',
        backgroundThrottling: false,
      },
    });
    view.setBackgroundColor('#0f1214');

    // `window.open` and `target=_blank` are a request to leave, not to open a pane we would then
    // have to track. Hand them to the real browser.
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (NAVIGABLE.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });

    view.webContents.on('will-navigate', (event, url) => {
      if (NAVIGABLE.test(url) || url === ABOUT_BLANK) return;
      // A `javascript:` or `file:` navigation is a page reaching for something it was not given.
      event.preventDefault();
      this.options.onInfo(`browser pane refused a navigation to ${url}`);
    });

    view.webContents.on('did-start-loading', () => {
      this.loading = true;
      // A load that actually started supersedes whatever failed last. Without this a refused
      // `file://` leaves its banner up through every successful reload afterwards.
      this.error = null;
      this.emit();
    });
    view.webContents.on('did-stop-loading', () => {
      this.loading = false;
      this.emit();
    });
    // Typed one at a time rather than in a loop: `WebContents.on` has an overload per event
    // name, and iterating a union of them matches none of the overloads.
    view.webContents.on('did-navigate', () => this.emit());
    view.webContents.on('did-navigate-in-page', () => this.emit());
    view.webContents.on('page-title-updated', () => this.emit());
    view.webContents.on('did-fail-load', (_event, code, description, url, _isMainFrame, _validated, hasRaw) => {
      // -3 is ERR_ABORTED, which every navigation issues for the page it is replacing.
      if (code === -3 || !hasRaw) return;
      this.error = `${description} (${code}) — ${url}`;
      this.options.onInfo(`browser pane failed to load ${url}: ${description} (${code})`);
      this.loading = false;
      this.emit();
    });
    view.webContents.on('render-process-gone', (_event, details) =>
      this.options.onInfo(`browser pane renderer gone: ${details.reason}`),
    );
    return view;
  }

  /**
   * CSS pixels to DIP.
   *
   * `getBoundingClientRect` reports layout pixels at the renderer's zoom factor, while
   * `setBounds` wants device-independent pixels. At 100% zoom the two are the same, which is why
   * this is the kind of thing that looks correct until someone presses Ctrl+plus.
   */
  private applyBounds(): void {
    const view = this.view;
    const win = this.window;
    if (view == null) return;

    if (this.wanted == null || win == null || win.isDestroyed()) {
      this.detachFrom(win);
      return;
    }

    const zoom = this.options.zoomFactor();
    const safe = zoom > 0 ? zoom : 1;
    // One CSS pixel at zoom 1.2 covers 1.2 DIP, so this multiplies — dividing shrinks the page
    // and drags it up and left of its slot.
    const bounds: Rectangle = {
      x: Math.round(this.wanted.x * safe),
      y: Math.round(this.wanted.y * safe),
      width: Math.round(this.wanted.width * safe),
      height: Math.round(this.wanted.height * safe),
    };
    // A pane squeezed to nothing still swallows every click in the top-left of the window.
    if (bounds.width < 8 || bounds.height < 8) {
      this.detachFrom(win);
      return;
    }
    if (win.contentView.children.includes(view) === false) win.contentView.addChildView(view);
    view.setBounds(bounds);
  }

  private detachFrom(win: BrowserWindow | null): void {
    if (win == null || win.isDestroyed() || this.view == null) return;
    if (win.contentView.children.includes(this.view)) win.contentView.removeChildView(this.view);
  }

  private emit(): void {
    if (this.stateHandlers.size === 0) return;
    const snapshot = this.state();
    for (const handler of this.stateHandlers) {
      try {
        handler(snapshot);
      } catch {
        // A renderer that went away between the event and this push must not stop the pane
        // from reporting anything at all.
      }
    }
  }
}

function min(a: number, b: number): number {
  return Math.min(a, b);
}

function max(a: number, b: number): number {
  return Math.max(a, b);
}
