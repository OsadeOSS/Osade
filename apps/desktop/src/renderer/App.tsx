import { useEffect, useMemo, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';

import type { TaskView } from '@osade/contract';

import { AgentMark } from './agent-icon.js';
import { AgentPicker, resolveNewChatAgent, type ShellOption } from './AgentPicker.js';
import osadeLogo from './assets/osade.png';
import { Board } from './Board.js';
import { BROWSER_DEFAULT, BROWSER_MAX, BROWSER_MIN, clampBrowserWidth } from './browser-view.js';
import { BrowserPane } from './BrowserPane.js';
import { CommandPalette } from './CommandPalette.js';
import { photosPrompt, type ComposerPhoto } from './compose-photos.js';
import { Detail, DraftPane, PANES, PanelTabs, type FileContext, type PanelLane } from './Detail.js';
import { api, type ShellKind } from './api.js';
import { chord } from './chords.js';
import { type PendingLane } from './delivery.js';
import { GitHubSignIn, useGithub } from './GitHubSignIn.js';
import { ShellTerminal } from './LaneTerminal.js';
import {
  chatActivity,
  chatLabel,
  groupChats,
  laneDigest,
  primaryLane,
  withDigest,
  type ChatGroup,
} from './lanes.js';
import {
  lanePrompt,
  laneTarget,
  parseMentions,
  unavailableAgentMessage,
  validateMentionedAgents,
} from './mentions.js';
import { QuickCapture } from './QuickCapture.js';
import { notesPrompt } from './quick-notes.js';
import {
  ProjectSidebar,
  terminalAgentTone,
  type ProjectActions,
  type ProjectGroup,
  type TerminalAgentRow,
} from './ProjectSidebar.js';
import { contextReposForChat } from './repo-context.js';
import { RepoSettings, useAgentCatalog } from './RepoSettings.js';
import { ShellIcon } from './shell-icon.js';
import { STATUS, summarise } from './status.js';
import { StatusBar } from './StatusBar.js';
import { withProcess, withTitle, type TerminalAgent } from './terminal-agent.js';
import { TerminalWorkspace } from './TerminalWorkspace.js';
import { titleFrom } from './title.js';
import { useLedger } from './useLedger.js';
import { useRepo, type OpenRepo } from './useRepo.js';

const COLLAPSE_KEY = 'osade.repo-collapsed';
const NAMES_KEY = 'osade.repo-names';
const GITHUB_SKIP_KEY = 'osade.github-skipped';
const SIDEBAR_KEY = 'osade.sidebar-width';
const OPENED_FOLDERS_KEY = 'osade.opened-folders';
const PINNED_PROJECTS_KEY = 'osade.pinned-projects';
const HIDDEN_PROJECTS_KEY = 'osade.hidden-projects';
const TERMINAL_TABS_KEY = 'osade.terminal-tabs';
const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 640;
const SIDEBAR_DEFAULT = 320;
const BROWSER_KEY = 'osade.browser-open';
const BROWSER_WIDTH_KEY = 'osade.browser-width';
const PANEL_KEY = 'osade.panel-open';
const PANEL_WIDTH_KEY = 'osade.panel-width';
const PANEL_MIN = 280;
const PANEL_MAX = 760;
const PANEL_DEFAULT = 380;

type Tab =
  | {
      kind: 'draft';
      id: string;
      repoId: string | null;
      repoPath: string | null;
      isolate?: boolean;
      checkoutRef?: string;
      baseRef?: string;
      agentId: string | null;
      optimistic?: string;
      submitting?: boolean;
    }
  | { kind: 'chat'; id: string; focusId?: string; optimistic?: string; isolatedNotice?: string }
  | TerminalTab;

type TerminalTab = {
  kind: 'terminal';
  id: string;
  repoId: string | null;
  cwd: string;
  shell: ShellKind;
  title: string;
};

interface PendingDraft {
  repoId: string | null;
  repoPath: string | null;
  baseRef?: string;
  isolate?: boolean;
  checkoutRef?: string;
}

export function App(): JSX.Element {
  const { tasks: allTasks, connection } = useLedger();
  const { repo, error: repoError, requestId } = useRepo();
  const catalog = useAgentCatalog(connection === 'live');
  const shells = useShellOptions(connection === 'live');
  const github = useGithub();
  const [githubSkipped, setGithubSkipped] = useState(() => {
    try {
      return localStorage.getItem(GITHUB_SKIP_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [githubWelcome, setGithubWelcome] = useState(false);
  const [agentOverride, setAgentOverride] = useState<string | null>(null);
  const [repoPaths, setRepoPaths] = useState<Record<string, string>>({});
  // Folders picked through Open folder, listed in the sidebar before they have any chats.
  const [openedFolders, setOpenedFolders] = useState<OpenedFolder[]>(loadOpenedFolders);
  const [pinnedProjects, setPinnedProjects] = useState<string[]>(() => loadIdList(PINNED_PROJECTS_KEY));
  // Removed from the sidebar; their chats are kept, and opening the folder again brings it back.
  const [hiddenProjects, setHiddenProjects] = useState<string[]>(() => loadIdList(HIDDEN_PROJECTS_KEY));
  const [editors, setEditors] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    void window.osade?.editors?.().then(setEditors, () => undefined);
  }, []);

  // Agents started by hand in terminal tabs, read from the titles they set. Keyed by tab id.
  const [terminalAgents, setTerminalAgents] = useState<Record<string, TerminalAgent>>({});
  // Each terminal tab's latest title, so an agent the process scan finds late still gets it.
  const terminalTitles = useRef<Record<string, string>>({});
  // Terminal tabs come back on launch. Their shells live in the daemon, which outlives the
  // window, so each reopened tab reattaches to its running shell with its scrollback.
  const [restored] = useState(loadTerminalTabs);
  const [tabs, setTabs] = useState<Tab[]>(() => restored.tabs);
  const [activeId, setActiveId] = useState<string | null>(() => restored.activeId);
  useEffect(() => {
    saveTerminalTabs(
      tabs.filter((tab): tab is TerminalTab => tab.kind === 'terminal'),
      activeId,
    );
  }, [tabs, activeId]);

  const hasTerminalTab = tabs.some((tab) => tab.kind === 'terminal');

  useEffect(() => {
    if (!hasTerminalTab) return;
    let stop = false;
    let timer: number | undefined;
    const poll = (): void => {
      void api
        .terminalAgents()
        .then((found) => {
          if (stop) return;
          const byTab = new Map(found.map((row) => [row.id, row]));
          setTerminalAgents((current) => {
            const next: Record<string, TerminalAgent> = {};
            let changed = false;
            for (const id of new Set([...Object.keys(current), ...byTab.keys()])) {
              const prev = current[id] ?? null;
              let agent = withProcess(prev, byTab.get(id) ?? null, Date.now());
              const title = terminalTitles.current[id];
              if (agent != null && agent !== prev && title != null) agent = withTitle(agent, title, Date.now());
              if (agent !== prev) changed = true;
              if (agent != null) next[id] = agent;
            }
            return changed ? next : current;
          });
        })
        .catch(() => undefined)
        .finally(() => {
          if (!stop) timer = window.setTimeout(poll, 2_000);
        });
    };
    poll();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [hasTerminalTab]);
  // The right panel, like Orca's: Files, Checks, Changes, Rules, Notes beside the chat.
  const [panel, setPanel] = useState<PanelLane>('diff');
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [panelWidth, setPanelWidth] = useState(() => loadPanelWidth());
  const [panelDrag, setPanelDrag] = useState(false);
  const panelDragOrigin = useRef<{ x: number; width: number } | null>(null);
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);
  // Back/forward over the tabs you have looked at, like the arrows atop Orca's sidebar.
  const history = useRef<{ stack: string[]; index: number; jumping: boolean }>({
    stack: [],
    index: -1,
    jumping: false,
  });
  const [, setHistoryTick] = useState(0);
  const [view, setView] = useState<'list' | 'board'>('list');
  const [palette, setPalette] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // A row's right-click menu: a chat lane (`task`) or a terminal tab (`terminal`).
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; kind?: 'task' | 'terminal' } | null>(
    null,
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());
  const [aliases, setAliases] = useState<Record<string, string>>(() => loadAliases());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pendingLanes, setPendingLanes] = useState<PendingLane[]>([]);
  const [agentModal, setAgentModal] = useState<PendingDraft | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => loadSidebarWidth());
  const [sidebarDrag, setSidebarDrag] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sidebarDragOrigin = useRef<{ x: number; width: number } | null>(null);
  const [browserOpen, setBrowserOpen] = useState(() => loadFlag(BROWSER_KEY));
  const [browserWidth, setBrowserWidth] = useState(() => loadBrowserWidth());
  const [browserDrag, setBrowserDrag] = useState(false);
  const browserDragOrigin = useRef<{ x: number; width: number } | null>(null);
  // Issue #19 — quick notes. `capture` is the floating popover; `fileCtx` is what the chat in
  // front of you is reading, reported up by its Files lane, so a note is stamped with a file
  // that was actually on screen. `notesVersion` is bumped after a save so an already-open Notes
  // lane refetches rather than showing a list that is one note behind.
  const [capture, setCapture] = useState(false);
  const [fileCtx, setFileCtx] = useState<FileContext | null>(null);
  const [notesVersion, setNotesVersion] = useState(0);

  const defaultAgent = agentOverride ?? repo?.defaultAgent ?? null;
  const scoped = repo ? allTasks.filter((t) => t.task.repo_id === repo.repoId) : allTasks;
  const chats = scoped.filter((t) => t.status !== 'archived');
  const emptyLedger = chats.length === 0 && tabs.length === 0;
  const groups = useMemo(() => groupChats(chats), [chats]);
  const needsYou = groups.filter((g) => g.needsYou);
  const working = chats.filter((t) => t.status === 'implementing' || t.status === 'verifying');

  const byRepo = useMemo(() => groupByRepo(chats), [chats]);

  // Projects known only from their chats have no folder yet; ask once so the menu can use it.
  const askedPaths = useRef(new Set<string>());
  useEffect(() => {
    for (const { repoId } of byRepo) {
      if (repoPaths[repoId] != null || askedPaths.current.has(repoId)) continue;
      askedPaths.current.add(repoId);
      void api.repoPath(repoId).then(
        ({ path }) => setRepoPaths((current) => (current[repoId] ? current : { ...current, [repoId]: path })),
        () => undefined,
      );
    }
  }, [byRepo, repoPaths]);
  const flat = useMemo(() => byRepo.flatMap((g) => g.chats), [byRepo]);

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;
  const selectedChat =
    activeTab?.kind === 'chat' ? (groups.find((g) => g.chatId === activeTab.id) ?? null) : null;
  const selected =
    selectedChat == null || activeTab?.kind !== 'chat'
      ? null
      : (selectedChat.lanes.find((l) => l.task.id === activeTab.focusId) ??
        primaryLane(selectedChat));

  // An open tab fills the centre; Kanban takes the centre's place without closing it.
  const showDetail =
    view !== 'board' &&
    activeTab != null &&
    (activeTab.kind === 'draft' || activeTab.kind === 'terminal' || selectedChat != null);

  /**
   * Which repository a new note belongs to: the chat in focus, else the open one.
   *
   * Notes are repo-scoped, so this has to be a real repository rather than a guess — a note
   * filed against the wrong repo is a note that never comes back.
   */
  const captureRepoId =
    (activeTab?.kind === 'terminal' ? activeTab.repoId : null) ?? selected?.task.repo_id ?? repo?.repoId ?? null;

  /** Ctrl+Shift+N with nothing open is a shortcut that appears to do nothing. */
  function openCapture(): void {
    if (captureRepoId == null) {
      setActionError('Open a repository first — quick notes are filed against one');
      return;
    }
    setCapture(true);
  }

  useEffect(() => {
    if (repo) {
      setRepoPaths((current) => ({ ...current, [repo.repoId]: repo.path }));
      setAgentOverride(null);
    }
  }, [repo]);

  useEffect(() => {
    if (!repo || requestId === 0) return;
    const id = crypto.randomUUID();
    setView('list');
    setTabs((current) => [
      ...current,
      { kind: 'draft', id, repoId: repo.repoId, repoPath: repo.path, agentId: defaultAgent },
    ]);
    setActiveId(id);
  }, [repo, requestId]);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 960px)');
    const sync = () => {
      setSidebarOpen(!mq.matches);
      if (mq.matches) setPanelOpen(false);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    localStorage.setItem(NAMES_KEY, JSON.stringify(aliases));
  }, [aliases]);

  // A closed or switched-away chat must not leave a file behind for the next note.
  useEffect(() => {
    setFileCtx(null);
  }, [activeId, view]);

  useEffect(() => {
    localStorage.setItem(BROWSER_KEY, browserOpen ? '1' : '0');
  }, [browserOpen]);

  useEffect(() => {
    localStorage.setItem(BROWSER_WIDTH_KEY, String(browserWidth));
  }, [browserWidth]);

  useEffect(() => {
    localStorage.setItem(PANEL_KEY, panelOpen ? '1' : '0');
  }, [panelOpen]);

  useEffect(() => {
    localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    const h = history.current;
    if (activeId == null) return;
    if (h.jumping) {
      h.jumping = false;
      return;
    }
    if (h.stack[h.index] === activeId) return;
    h.stack = [...h.stack.slice(0, h.index + 1), activeId];
    h.index = h.stack.length - 1;
    setHistoryTick((n) => n + 1);
  }, [activeId]);

  useEffect(() => {
    if (github.status.signedIn || githubSkipped) {
      setGithubWelcome(false);
      return;
    }
    if (github.ready && connection === 'live' && emptyLedger) {
      setGithubWelcome(true);
    }
  }, [github.ready, github.status.signedIn, githubSkipped, connection, emptyLedger]);

  useEffect(() => {
    setPendingLanes((current) =>
      current.filter((pending) => {
        if (pending.phase === 'failed') return true;
        const chat = groups.find((g) => g.chatId === pending.chatId);
        return !chat?.lanes.some((l) => l.agentId === pending.agentId);
      }),
    );
  }, [groups]);

  useEffect(() => {
    for (const group of groups) {
      if (group.title !== 'New chat') continue;
      const lane = primaryLane(group);
      const activity = lane.agent?.activity_text ?? '';
      const file = activity.match(/(?:Editing|Writing|Created|Modified)\s+(\S+)/u);
      if (!file) continue;
      const next = file[1]!.replace(/[\\/]/g, '/').split('/').pop() ?? file[1]!;
      if (next.length > 0) void api.taskRetitle(lane.task.id, next);
    }
  }, [groups]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const modKey = event.metaKey || event.ctrlKey;
      const typing = isTyping(event.target);

      if (modKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((open) => !open);
        return;
      }
      if (modKey && event.key.toLowerCase() === 't') {
        event.preventDefault();
        setPalette(false);
        void openDraftTab();
        return;
      }
      if (modKey && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        closeTab(activeId);
        return;
      }
      // Ctrl/Cmd+Shift+B — the browser pane. Shift-qualified because the bare chord is a
      // readline move, and a developer about to Ctrl+click their own app should not lose it.
      if (modKey && event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setBrowserOpen((open) => !open);
        return;
      }

      if (palette && event.key === 'Escape') {
        event.preventDefault();
        setPalette(false);
        return;
      }
      if (menu && event.key === 'Escape') {
        event.preventDefault();
        setMenu(null);
        return;
      }
      if (palette) return;
      // The agent modal owns its keys (Escape closes it); nothing behind it acts.
      if (agentModal) return;

      if (modKey && event.key >= '1' && event.key <= '9') {
        event.preventDefault();
        const tab = tabs[Number(event.key) - 1];
        if (tab) {
          setActiveId(tab.id);
        }
        return;
      }

      if (modKey && event.key === 'Enter' && !typing) {
        event.preventDefault();
        void decideGate(selected, 'approve', setActionError);
        return;
      }
      if (modKey && event.key === 'Backspace' && !typing) {
        event.preventDefault();
        void decideGate(selected, 'deny', setActionError);
        return;
      }

      if (typing) return;

      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        const delta = event.key === 'j' ? 1 : -1;
        const index = selectedChat ? flat.findIndex((c) => c.chatId === selectedChat.chatId) : -1;
        const next =
          flat[clamp((index < 0 ? (delta > 0 ? -1 : 0) : index) + delta, 0, flat.length - 1)];
        if (next) openLane(primaryLane(next));
        return;
      }

      // Issue #19 — Ctrl/Cmd+Shift+N writes a note without leaving what you were doing, and
      // Ctrl/Cmd+Shift+Q brings the list up. Both shift-qualified: bare Ctrl+N and Ctrl+Q are
      // conventional for something else in most tools, and this app is where people type.
      //
      // After the palette and agent-modal guards rather than with the other chords, because
      // unlike Ctrl+T these are about the thing already on screen — reopening the list behind
      // an open palette would move the ground under whatever the palette is about to do.
      if (modKey && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        openCapture();
        return;
      }
      if (modKey && event.shiftKey && event.key.toLowerCase() === 'q') {
        event.preventDefault();
        toggleNotes();
        return;
      }

      const pane = PANES.find((item) => item.chord === event.key);
      if (pane && selected) {
        event.preventDefault();
        openPanel(pane.id);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, agentModal, byRepo, defaultAgent, flat, menu, palette, panel, panelOpen, repo, repoPaths, selected, selectedChat, tabs]);

  function openPanel(next: PanelLane): void {
    setPanel(next);
    setPanelOpen(true);
  }

  function toggleNotes(): void {
    if (panelOpen && panel === 'notes') {
      setPanelOpen(false);
      return;
    }
    openPanel('notes');
  }

  /** The nearest entry in that direction whose tab is still open, or -1. */
  function historyTarget(delta: 1 | -1): number {
    const h = history.current;
    const open = new Set(tabs.map((t) => t.id));
    for (let i = h.index + delta; i >= 0 && i < h.stack.length; i += delta) {
      if (open.has(h.stack[i]!)) return i;
    }
    return -1;
  }

  function goHistory(delta: 1 | -1): void {
    const i = historyTarget(delta);
    if (i < 0) return;
    const h = history.current;
    const id = h.stack[i]!;
    h.index = i;
    if (id !== activeId) h.jumping = true;
    setView('list');
    setActiveId(id);
    setHistoryTick((n) => n + 1);
  }

  function rememberFolder(folder: { repoId: string; path: string }): void {
    setRepoPaths((current) => ({ ...current, [folder.repoId]: folder.path }));
    setHiddenProjects((current) => {
      if (!current.includes(folder.repoId)) return current;
      const next = current.filter((id) => id !== folder.repoId);
      saveIdList(HIDDEN_PROJECTS_KEY, next);
      return next;
    });
    setOpenedFolders((current) => {
      const next = [
        { repoId: folder.repoId, path: folder.path },
        ...current.filter((f) => f.repoId !== folder.repoId),
      ];
      saveOpenedFolders(next);
      return next;
    });
  }

  function onTerminalTitle(tabId: string, title: string): void {
    terminalTitles.current[tabId] = title;
    setTerminalAgents((current) => {
      const prev = current[tabId];
      if (prev == null) return current;
      const next = withTitle(prev, title, Date.now());
      return next === prev || next == null ? current : { ...current, [tabId]: next };
    });
  }

  function projectPath(repoId: string): string | null {
    return (
      repoPaths[repoId] ??
      openedFolders.find((f) => f.repoId === repoId)?.path ??
      (repo?.repoId === repoId ? repo.path : null)
    );
  }

  function projectActions(repoId: string): ProjectActions {
    const path = projectPath(repoId);
    return {
      onNewTerminal: () => {
        if (path == null) return;
        openTerminal({ repoId, repoPath: path }, shells[0]?.kind ?? 'default');
      },
      onOpenIn: (target) => {
        if (path == null) return;
        const opener = window.osade?.openFolderIn;
        if (!opener) {
          setActionError('Opening folders needs the desktop app');
          return;
        }
        opener(path, target).catch((err: Error) => setActionError(err.message));
      },
      onCopyPath: () => {
        if (path == null) return;
        navigator.clipboard.writeText(path).catch((err: Error) => setActionError(err.message));
      },
      onTogglePin: () =>
        setPinnedProjects((current) => {
          const next = current.includes(repoId) ? current.filter((id) => id !== repoId) : [repoId, ...current];
          saveIdList(PINNED_PROJECTS_KEY, next);
          return next;
        }),
      onRemove: () => {
        setOpenedFolders((current) => {
          const next = current.filter((f) => f.repoId !== repoId);
          saveOpenedFolders(next);
          return next;
        });
        setHiddenProjects((current) => {
          const next = current.includes(repoId) ? current : [...current, repoId];
          saveIdList(HIDDEN_PROJECTS_KEY, next);
          return next;
        });
      },
    };
  }

  async function openFolder(): Promise<void> {
    let picked: OpenRepo | null;
    try {
      picked = await pickRepo();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!picked) return;
    rememberFolder(picked);
    await openDraftTab({ repoId: picked.repoId, path: picked.path });
  }

  function onPanelPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panelDragOrigin.current = { x: event.clientX, width: panelWidth };
    setPanelDrag(true);
  }

  function onPanelPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const origin = panelDragOrigin.current;
    if (origin == null) return;
    setPanelWidth(clampPanel(origin.width + origin.x - event.clientX));
  }

  function onPanelPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (panelDragOrigin.current == null) return;
    panelDragOrigin.current = null;
    setPanelDrag(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function openLane(task: TaskView): void {
    setView('list');
    const chatId = task.chatId;
    setTabs((current) => {
      const existing = current.find((t) => t.kind === 'chat' && t.id === chatId);
      if (existing) {
        return current.map((t) =>
          t.kind === 'chat' && t.id === chatId ? { ...t, focusId: task.task.id } : t,
        );
      }
      return [...current, { kind: 'chat', id: chatId, focusId: task.task.id }];
    });
    setActiveId(chatId);
  }

  /** The repository the active tab is working in, when it knows. */
  function activeRepo(): { repoId: string | null; path: string | null } | null {
    if (activeTab?.kind === 'draft') return { repoId: activeTab.repoId, path: activeTab.repoPath };
    if (activeTab?.kind === 'terminal') return { repoId: activeTab.repoId, path: activeTab.cwd };
    if (selected) {
      const id = selected.task.repo_id;
      const path = repoPaths[id] ?? (selected.attachment === 'repo' ? selected.cwd : null);
      return { repoId: id, path };
    }
    return null;
  }

  async function openDraftTab(from?: {
    repoId: string;
    path?: string;
    isolate?: boolean;
    checkoutRef?: string;
    baseRef?: string;
  }): Promise<void> {
    // A new session belongs to the repo already in front of you: the one asked for, else the
    // active tab's, else the window's, else the most recent project in the sidebar. The folder
    // picker is only for a window that has no repository at all.
    const context = activeRepo();
    let repoId: string | null;
    let repoPath: string | null;
    if (from) {
      repoId = from.repoId;
      repoPath = from.path ?? null;
    } else if (context && (context.repoId != null || context.path != null)) {
      repoId = context.repoId;
      repoPath = context.path;
    } else {
      repoId = repo?.repoId ?? byRepo[0]?.repoId ?? null;
      repoPath = null;
    }
    if (repoPath == null && repoId != null) {
      repoPath = repoPaths[repoId] ?? (repo?.repoId === repoId ? repo.path : null);
    }

    if (repoPath == null && repoId != null) {
      try {
        repoPath = (await api.repoPath(repoId)).path;
        const known = { id: repoId, path: repoPath };
        setRepoPaths((current) => ({ ...current, [known.id]: known.path }));
      } catch {
        // An unknown or moved repo falls through to the picker.
      }
    }

    if (repoPath == null) {
      let picked: OpenRepo | null;
      try {
        picked = await pickRepo();
      } catch (err) {
        // A rejected repoOpen (e.g. "not inside a git repository") used to vanish
        // into an unhandled rejection and read as "the button does nothing".
        setActionError(err instanceof Error ? err.message : String(err));
        return;
      }
      if (!picked) return;
      repoId = picked.repoId;
      repoPath = picked.path;
      rememberFolder(picked);
    }

    setAgentModal({ repoId, repoPath, isolate: from?.isolate, checkoutRef: from?.checkoutRef, baseRef: from?.baseRef });
  }

  function openDraftWithAgent(pending: PendingDraft, agentId: string): void {
    setView('list');
    const tabId = crypto.randomUUID();
    setAgentModal(null);
    setTabs((current) => [
      ...current,
      {
        kind: 'draft',
        id: tabId,
        repoId: pending.repoId,
        repoPath: pending.repoPath,
        isolate: pending.isolate,
        checkoutRef: pending.checkoutRef,
        baseRef: pending.baseRef,
        agentId,
      },
    ]);
    setActiveId(tabId);
  }

  async function openPlan(): Promise<void> {
    let repoPath = repo?.path ?? (selected ? (repoPaths[selected.task.repo_id] ?? null) : null);
    if (repoPath == null) {
      const picked = await pickRepo();
      if (!picked) return;
      repoPath = picked.path;
      rememberFolder(picked);
    }
    const created = await api.orchestratorOpen(repoPath, defaultAgent ?? undefined);
    const task = chats.find((t) => t.task.id === created.taskId);
    if (task) openLane(task);
    else {
      setTabs((current) =>
        current.some((t) => t.kind === 'chat' && t.id === created.chatId)
          ? current.map((t) =>
              t.kind === 'chat' && t.id === created.chatId
                ? { ...t, focusId: created.taskId }
                : t,
            )
          : [...current, { kind: 'chat', id: created.chatId, focusId: created.taskId }],
      );
      setActiveId(created.chatId);
    }
  }

  function openTerminal(pending: PendingDraft, shell: ShellKind): void {
    setAgentModal(null);
    if (pending.repoPath == null) return;
    const option = shells.find((s) => s.kind === shell);
    const id = crypto.randomUUID();
    setView('list');
    setTabs((current) => [
      ...current,
      { kind: 'terminal', id, repoId: pending.repoId, cwd: pending.repoPath!, shell, title: option?.label ?? 'Terminal' },
    ]);
    setActiveId(id);
  }

  function closeTab(id: string | null): void {
    if (id == null) return;
    if (tabs.some((t) => t.id === id && t.kind === 'terminal')) {
      void api.terminalClose(id).catch(() => undefined);
    }
    delete terminalTitles.current[id];
    setTerminalAgents((current) => {
      if (!(id in current)) return current;
      const { [id]: _closed, ...rest } = current;
      return rest;
    });
    setTabs((current) => {
      const next = current.filter((t) => t.id !== id);
      setActiveId((active) => {
        if (active !== id) return active;
        return next[next.length - 1]?.id ?? null;
      });
      return next;
    });
  }

  async function submitDraft(
    tab: Extract<Tab, { kind: 'draft' }>,
    message: string,
    photos: ComposerPhoto[] = [],
  ): Promise<void> {
    if (tab.repoPath == null) throw new Error('Pick a repository first');
    const shown = optimisticLine(message, photos);
    setTabs((current) =>
      current.map((t) =>
        t.id === tab.id && t.kind === 'draft'
          ? { ...t, optimistic: shown, submitting: true }
          : t,
      ),
    );
    try {
      const ids = catalog.map((a) => a.id);
      const parsed = parseMentions(message, ids);
      // Agent availability validation — §OSADE §8.1.
      // Runs before any task is created so the user sees a clear error
      // rather than a broken lane appearing in the sidebar.
      const availability = validateMentionedAgents(parsed, catalog);
      if (!availability.ok) {
        throw new Error(unavailableAgentMessage(availability.unavailable));
      }
      const targets =
        parsed.targets.length > 0
          ? parsed.targets
          : [{ agentId: resolveNewChatAgent(tab.agentId, defaultAgent), text: parsed.shared || message }];
      const first = targets[0]!;
      const firstPrompt = lanePrompt(
        parsed,
        { agentId: first.agentId ?? 'claude', text: first.text },
        message,
      );
      if (firstPrompt.length === 0 && photos.length === 0) throw new Error('Write something to send');
      for (const target of targets) {
        const agentId = target.agentId ?? resolveNewChatAgent(tab.agentId, defaultAgent);
        const prompt = lanePrompt(parsed, { agentId, text: target.text }, message);
        if (prompt.length === 0 && photos.length === 0) continue;
        markPending(tab.id, agentId, '', 'starting');
      }
      const contextualFirst = firstPrompt || shown;
      const created = await api.taskCreate({
        repoPath: tab.repoPath,
        title: titleFrom(message),
        intent: contextualFirst,
        ...(first.agentId ? { agentId: first.agentId } : {}),
        ...(tab.baseRef ? { baseRef: tab.baseRef } : {}),
        ...(tab.isolate ? { isolate: true } : {}),
        ...(tab.checkoutRef ? { checkoutRef: tab.checkoutRef, isolate: true } : {}),
      });
      const notice =
        created.isolatedBecause != null
          ? `This chat is on its own branch because “${created.isolatedBecause.title}” is using the checkout.`
          : undefined;
      setTabs((current) =>
        current.map((t) =>
          t.id === tab.id
            ? {
                kind: 'chat',
                id: created.taskId,
                focusId: created.taskId,
                optimistic: shown,
                isolatedNotice: notice,
              }
            : t,
        ),
      );
      setActiveId(created.taskId);
      setPendingLanes((current) =>
        current.map((p) => (p.chatId === tab.id ? { ...p, chatId: created.taskId } : p)),
      );
      const firstAgent = first.agentId ?? resolveNewChatAgent(tab.agentId, defaultAgent);
      void launchAndSend(created.taskId, contextualFirst, photos).catch((err: Error) => {
        markPending(created.taskId, firstAgent, '', 'failed', err.message);
        setActionError(err.message);
      });
      for (const extra of targets.slice(1)) {
        if (!extra.agentId) continue;
        const extraPrompt = lanePrompt(parsed, extra, message);
        if (extraPrompt.length === 0 && photos.length === 0) continue;
        const contextualExtra = extraPrompt;
        void (async () => {
          const lane = await api.taskCreate({
            repoPath: tab.repoPath!,
            title: titleFrom(message),
            intent: contextualExtra || shown,
            chatId: created.taskId,
            agentId: extra.agentId,
            ...(tab.baseRef ? { baseRef: tab.baseRef } : {}),
            isolate: true,
          });
          await launchAndSend(lane.taskId, contextualExtra, photos);
        })().catch((err: Error) => {
          markPending(created.taskId, extra.agentId, '', 'failed', err.message);
          setActionError(err.message);
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPendingLanes((current) =>
        current.map((p) =>
          p.chatId === tab.id ? { ...p, phase: 'failed' as const, error: message } : p,
        ),
      );
      setTabs((current) =>
        current.map((t) =>
          t.id === tab.id && t.kind === 'draft' ? { ...t, submitting: false } : t,
        ),
      );
      throw err;
    }
  }

  async function sendOnChat(
    chat: ChatGroup,
    message: string,
    photos: ComposerPhoto[] = [],
  ): Promise<void> {
    const shown = optimisticLine(message, photos);
    setTabs((current) =>
      current.map((t) => (t.kind === 'chat' && t.id === chat.chatId ? { ...t, optimistic: shown } : t)),
    );
    const ids = catalog.map((a) => a.id);
    const parsed = parseMentions(message, ids);
    // Agent availability pre-flight (same guard as submitDraft).
    const availability = validateMentionedAgents(parsed, catalog);
    if (!availability.ok) {
      setActionError(unavailableAgentMessage(availability.unavailable));
      return;
    }
    const primary = primaryLane(chat);
    if (chat.title === 'New chat') {
      const next = titleFrom(message);
      if (next !== 'New chat') {
        for (const lane of chat.lanes) void api.taskRetitle(lane.task.id, next);
      }
    }
    const targets =
      parsed.targets.length > 0
        ? parsed.targets
        : [{ agentId: primary.agentId, text: parsed.shared || message }];
    const repoPath = repoPaths[chat.lanes[0]!.task.repo_id] ?? repo?.path ?? null;

    for (const target of targets) {
      const text = lanePrompt(parsed, target, message);
      if (text.length === 0 && photos.length === 0) {
        setActionError('Write something to send');
        continue;
      }
      void sendToLane(chat, target.agentId, text, repoPath, photos).catch((err: Error) =>
        setActionError(err.message),
      );
    }
  }

  async function sendToLane(
    chat: ChatGroup,
    agentId: string,
    text: string,
    repoPath: string | null,
    photos: ComposerPhoto[] = [],
  ): Promise<void> {
    const lane = laneTarget(chat.lanes, agentId);
    if (lane == null) {
      if (repoPath == null) throw new Error('Open this repository to add a lane');
      markPending(chat.chatId, agentId, '', 'starting');
      try {
        const created = await api.taskCreate({
          repoPath,
          title: chat.title,
          intent: text || optimisticLine('', photos),
          chatId: chat.chatId,
          agentId,
          baseRef: chat.lanes[0]?.task.base_ref,
          isolate: true,
        });
        await launchAndSend(created.taskId, text, photos);
      } catch (err) {
        markPending(chat.chatId, agentId, '', 'failed', (err as Error).message);
        throw err;
      }
      return;
    }
    const digest = laneDigest(lane, chat.lanes);
    try {
      await launchAndSend(lane.task.id, withDigest(text, digest), photos);
    } catch (err) {
      markPending(chat.chatId, agentId, '', 'failed', (err as Error).message);
      throw err;
    }
  }

  async function launchAndSend(
    taskId: string,
    text: string,
    photos: ComposerPhoto[] = [],
  ): Promise<void> {
    const planted = await plantPhotos(taskId, photos);
    const payload = await withNotes(taskId, photosPrompt(planted, text));
    if (payload.length === 0) throw new Error('Write something to send');
    const view = chats.find((t) => t.task.id === taskId);
    const live =
      view?.agent?.pane_alive === true &&
      view.agent.terminated !== true &&
      view.agent.substrate_pane_id != null;
    const sending = api.taskSend(taskId, payload);
    if (live) {
      await sending;
      return;
    }
    await Promise.all([api.taskLaunch(taskId), sending]);
  }

  /**
   * Issue #19 — put the repository's open notes in front of the message.
   *
   * This is the whole feature in one function: a note nobody reads is a note that does not
   * exist, and the agent is the only reader that matters.
   *
   * Read here, at send time, rather than cached in state. Every other message would then carry
   * whatever the panel happened to have loaded when it was last opened, and the one message
   * where the note is wrong is the one sent right after writing it. One loopback query on a
   * path that already plants photos and launches a worktree is not the cost worth optimising.
   *
   * A daemon that cannot answer must not cost you the message: on failure the prompt goes out
   * unchanged, and the absence of notes is a smaller problem than the absence of the message.
   */
  async function withNotes(taskId: string, payload: string): Promise<string> {
    const repoId = chats.find((t) => t.task.id === taskId)?.task.repo_id ?? repo?.repoId ?? null;
    if (repoId == null) return payload;
    try {
      return notesPrompt(await api.noteListOpen(repoId), payload);
    } catch (err) {
      window.osade?.log?.(`could not read quick notes: ${(err as Error).message}`);
      return payload;
    }
  }

  async function plantPhotos(taskId: string, photos: ComposerPhoto[]): Promise<string[]> {
    if (photos.length === 0) return [];
    const { paths } = await api.taskDropImages(
      taskId,
      photos.map((photo) => ({ name: photo.name, mime: photo.mime, data: photo.data })),
    );
    return paths;
  }

  function markPending(
    chatId: string,
    agentId: string,
    prompt: string,
    phase: PendingLane['phase'],
    error?: string,
  ): void {
    setPendingLanes((current) => {
      const rest = current.filter((p) => !(p.chatId === chatId && p.agentId === agentId));
      return [...rest, { chatId, agentId, prompt, phase, error }];
    });
  }

  async function addContextRepo(chatId: string, _primaryRepoId: string): Promise<void> {
    const folder = await window.osade?.chooseRepository();
    if (!folder) return;
    try {
      const opened = await api.chatContextAdd(chatId, folder);
      setRepoPaths((current) => ({ ...current, [opened.repoId]: opened.path }));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  function removeContextRepo(chatId: string, repoId: string): void {
    void api.chatContextRemove(chatId, repoId).catch((err: Error) => setActionError(err.message));
  }

  function onSidebarPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sidebarDragOrigin.current = { x: event.clientX, width: sidebarWidth };
    setSidebarDrag(true);
  }

  function onSidebarPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const origin = sidebarDragOrigin.current;
    if (origin == null) return;
    setSidebarWidth(clampSidebar(origin.width + event.clientX - origin.x));
  }

  function onSidebarPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (sidebarDragOrigin.current == null) return;
    sidebarDragOrigin.current = null;
    setSidebarDrag(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onBrowserPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    browserDragOrigin.current = { x: event.clientX, width: browserWidth };
    setBrowserDrag(true);
  }

  function onBrowserPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const origin = browserDragOrigin.current;
    if (origin == null) return;
    // Dragged leftwards, so the delta runs the other way: the pane's right edge is what is being
    // pulled, and the window's right edge is fixed.
    setBrowserWidth(clampBrowser(origin.width + origin.x - event.clientX));
  }

  function onBrowserPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (browserDragOrigin.current == null) return;
    browserDragOrigin.current = null;
    setBrowserDrag(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  if (githubWelcome && !github.status.signedIn && !githubSkipped && repo == null) {
    return (
      <div style={{ padding: '48px 28px', maxWidth: 520, height: '100%' }}>
        <p style={{ margin: 0, fontSize: 'var(--t-l)', fontWeight: 600, letterSpacing: '-0.02em' }}>
          Welcome to Osade
        </p>
        <p style={{ margin: '8px 0 22px', color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Agents work as open-source contributors. You stay on the gates.
        </p>
        <GitHubSignIn
          status={github.status}
          onSignedIn={(login) => github.setStatus({ signedIn: true, login })}
          onSkip={() => {
            localStorage.setItem(GITHUB_SKIP_KEY, '1');
            setGithubSkipped(true);
          }}
        />
      </div>
    );
  }

  const terminalRows = (repoId: string): TerminalAgentRow[] =>
    tabs.flatMap((tab) => {
      const agent = tab.kind === 'terminal' && tab.repoId === repoId ? terminalAgents[tab.id] : undefined;
      return agent ? [{ tabId: tab.id, ...agent }] : [];
    });
  const project = (repoId: string, label: string, chats: ChatGroup[]): ProjectGroup => ({
    repoId,
    label,
    chats,
    terminals: terminalRows(repoId),
    path: projectPath(repoId),
    pinned: pinnedProjects.includes(repoId),
  });
  const listed: ProjectGroup[] = byRepo.map((group) =>
    project(group.repoId, repoLabel(group.repoId, repo, group.chats[0]?.lanes[0]?.cwd ?? null, aliases), group.chats),
  );
  for (const folder of [...openedFolders].reverse()) {
    if (listed.some((p) => p.repoId === folder.repoId)) continue;
    listed.unshift(project(folder.repoId, repoLabel(folder.repoId, repo, folder.path, aliases), []));
  }
  if (repo && !listed.some((p) => p.repoId === repo.repoId)) {
    listed.unshift(project(repo.repoId, repoLabel(repo.repoId, repo, null, aliases), []));
  }
  // Pinned first, most recently pinned on top; the rest keep their order.
  const visible = listed.filter((p) => !hiddenProjects.includes(p.repoId));
  const projects = [
    ...pinnedProjects.flatMap((id) => visible.filter((p) => p.repoId === id)),
    ...visible.filter((p) => !p.pinned),
  ];
  const detailShown =
    showDetail && activeTab?.kind === 'chat' && selectedChat != null && selected != null;
  const terminalPanelShown =
    view === 'list' && showDetail && activeTab?.kind === 'terminal' && activeTab.repoId != null;
  const resizing = sidebarDrag || browserDrag || panelDrag;

  return (
    <div
      className="osade-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-0)',
        cursor: resizing ? 'col-resize' : undefined,
        userSelect: resizing ? 'none' : undefined,
      }}
    >
      <div
        className="osade-main"
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: [
            // Must mirror the children rendered below, or the grid wraps them into rows.
            sidebarOpen ? `${sidebarWidth}px` : null,
            sidebarOpen ? '6px' : null,
            'minmax(0, 1fr)',
            browserOpen ? '6px' : null,
            browserOpen ? `${browserWidth}px` : null,
            panelOpen ? '6px' : null,
            panelOpen ? `${panelWidth}px` : null,
          ]
            .filter(Boolean)
            .join(' '),
        }}
      >
      {sidebarOpen && (
        <ProjectSidebar
          projects={projects}
          editors={editors}
          projectActions={projectActions}
          selectedChatId={selectedChat?.chatId ?? null}
          collapsed={collapsed}
          onToggle={(key) =>
            setCollapsed((set) => {
              const next = new Set(set);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          renaming={renaming}
          onRename={setRenaming}
          onAlias={(repoId, next) =>
            setAliases((current) => {
              const copy = { ...current };
              if (next.length === 0) delete copy[repoId];
              else copy[repoId] = next;
              return copy;
            })
          }
          connection={connection}
          hasRepo={repo != null}
          view={view}
          onTasks={() => setView((current) => (current === 'board' ? 'list' : 'board'))}
          browserOpen={browserOpen}
          onBrowser={() => setBrowserOpen((open) => !open)}
          notesOpen={panelOpen && panel === 'notes'}
          onNotes={toggleNotes}
          onSearch={() => setPalette(true)}
          onHide={() => setSidebarOpen(false)}
          canBack={historyTarget(-1) >= 0}
          canForward={historyTarget(1) >= 0}
          onBack={() => goHistory(-1)}
          onForward={() => goHistory(1)}
          onOpenChat={(chat) => openLane(primaryLane(chat))}
          activeTabId={activeId}
          onOpenTerminal={(tabId) => {
            setView('list');
            setActiveId(tabId);
          }}
          onTerminalMenu={(id, x, y) => setMenu({ id, x, y, kind: 'terminal' })}
          onMenu={(id, x, y) => setMenu({ id, x, y })}
          onNewChat={(repoId) =>
            void openDraftTab({
              repoId,
              path: repoPaths[repoId] ?? (repo?.repoId === repoId ? repo.path : undefined),
            })
          }
          onOpenFolder={() => void openFolder()}
          error={repoError ?? actionError}
          settings={
            repo ? (
              <RepoSettings
                repoId={repo.repoId}
                defaultAgent={defaultAgent}
                catalog={catalog}
                onSaved={setAgentOverride}
                placement="up"
              />
            ) : null
          }
        />
      )}
      {sidebarOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={Math.round(sidebarWidth)}
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          onPointerDown={onSidebarPointerDown}
          onPointerMove={onSidebarPointerMove}
          onPointerUp={onSidebarPointerUp}
          onPointerCancel={onSidebarPointerUp}
          onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)}
          style={{
            cursor: 'col-resize',
            touchAction: 'none',
            background: sidebarDrag
              ? 'var(--focus)'
              : 'linear-gradient(to right, transparent 2px, var(--line) 2px, var(--line) 3px, transparent 3px)',
          }}
        />
      )}

          <aside className="workspace" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, height: '100%' }}>
        <TabStrip
          tabs={tabs}
          groups={groups}
          terminalAgents={terminalAgents}
          activeId={activeId}
          sidebarHidden={!sidebarOpen}
          onShowSidebar={() => setSidebarOpen(true)}
          onNew={() => void openDraftTab()}
          onCommand={() => setPalette(true)}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen((open) => !open)}
          onSelect={(id) => {
            setActiveId(id);
            setView('list');
          }}
          onClose={closeTab}
        />
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
          {/*
            Terminal tabs stay mounted while you look elsewhere: the daemon hands each byte over
            once, so unmounting the view would throw away the scrollback.
          */}
          {tabs.map((tab) =>
            tab.kind === 'terminal' ? (
              <div
                key={tab.id}
                style={{
                  position: 'absolute',
                  inset: 0,
                  padding: '6px 0 0 10px',
                  background: '#0f1214',
                  visibility: showDetail && activeTab?.id === tab.id ? 'visible' : 'hidden',
                }}
              >
                <ShellTerminal
                  id={tab.id}
                  cwd={tab.cwd}
                  shell={tab.shell}
                  visible={showDetail && activeTab?.id === tab.id}
                  onTitle={(title) => onTerminalTitle(tab.id, title)}
                />
              </div>
            ) : null,
          )}
          {view === 'list' && showDetail && activeTab?.kind === 'terminal' && activeTab.repoId != null && (
            <TerminalWorkspace
              key={activeTab.id}
              repoId={activeTab.repoId}
              panel={panel}
              onPanel={openPanel}
              panelHost={panelOpen ? panelHost : null}
              notesVersion={notesVersion}
              onCaptureNote={openCapture}
            />
          )}
          {view === 'board' ? (
            <Board
              chats={groups}
              selectedId={selectedChat?.chatId ?? null}
              onSelect={(chat) => openLane(primaryLane(chat))}
              onMenu={(id, x, y) => setMenu({ id, x, y })}
            />
          ) : activeTab?.kind === 'terminal' && showDetail ? null : !showDetail ? (
            <NothingSelected
              hasChats={groups.length > 0}
              onNew={() => void openDraftTab()}
              onSearch={() => setPalette(true)}
            />
          ) : activeTab?.kind === 'draft' ? (
            <DraftPane
              optimistic={activeTab.optimistic}
              submitting={Boolean(activeTab.submitting)}
              catalog={catalog}
              agentId={activeTab.agentId}
              pending={pendingLanes.filter((p) => p.chatId === activeTab.id)}
              onSend={(text, photos) => submitDraft(activeTab, text, photos)}
            />
          ) : selectedChat && selected ? (
            <Detail
              chat={selectedChat}
              focusId={selected.task.id}
              onFocus={(id) => {
                const task = selectedChat.lanes.find((l) => l.task.id === id);
                if (task) openLane(task);
              }}
              panel={panel}
              onPanel={openPanel}
              panelHost={panelHost}
              catalog={catalog}
              optimistic={activeTab?.kind === 'chat' ? activeTab.optimistic : undefined}
              isolatedNotice={activeTab?.kind === 'chat' ? activeTab.isolatedNotice : undefined}
              pending={pendingLanes.filter((p) => p.chatId === selectedChat.chatId)}
              onSend={(text, photos) => sendOnChat(selectedChat, text, photos)}
              contextRepos={contextReposForChat(chats, selectedChat.chatId)}
              onAddContextRepo={() => void addContextRepo(selectedChat.chatId, primaryLane(selectedChat).task.repo_id)}
              onRemoveContextRepo={(repoId) => removeContextRepo(selectedChat.chatId, repoId)}
              onNewIsolatedChat={(opts) => {
                const lane = primaryLane(selectedChat);
                const repoPath = repoPaths[lane.task.repo_id] ?? repo?.path ?? undefined;
                void openDraftTab({
                  repoId: lane.task.repo_id,
                  path: repoPath,
                  isolate: true,
                  checkoutRef: opts.checkoutRef,
                  baseRef: opts.baseRef,
                });
              }}
              onMoveToBranch={(checkoutRef) => {
                const id = selected.task.id;
                void api.taskMoveBranch(id, checkoutRef).then(
                  (created) => {
                    void api.taskLaunch(created.taskId).catch((err: Error) => setActionError(err.message));
                    const chatId = selectedChat.chatId;
                    setTabs((current) =>
                      current.map((t) =>
                        t.kind === 'chat' && t.id === chatId
                          ? { ...t, focusId: created.taskId }
                          : t,
                      ),
                    );
                  },
                  (err: Error) => setActionError(err.message),
                );
              }}
              onOpenPrLane={() => {
                const lane = primaryLane(selectedChat);
                const prBranch =
                  selectedChat.lanes.map((l) => l.scm?.pr_head_ref).find((ref) => ref && ref.length > 0) ??
                  lane.scm?.pr_head_ref;
                if (!prBranch) return;
                const repoPath = repoPaths[lane.task.repo_id] ?? repo?.path ?? null;
                if (repoPath == null) return;
                void (async () => {
                  const created = await api.taskCreate({
                    repoPath,
                    title: selectedChat.title,
                    intent: `Address review comments on ${prBranch}`,
                    chatId: selectedChat.chatId,
                    agentId: lane.agentId,
                    isolate: true,
                    checkoutRef: prBranch,
                  });
                  await launchAndSend(
                    created.taskId,
                    `Address the reviewer's requested changes on ${prBranch}.`,
                  );
                })().catch((err: Error) => setActionError(err.message));
              }}
              onCaptureNote={openCapture}
              notesVersion={notesVersion}
              onFileContextChange={setFileCtx}
            />

          ) : (
            <NothingSelected
              hasChats={groups.length > 0}
              onNew={() => void openDraftTab()}
              onSearch={() => setPalette(true)}
            />
          )}
        </div>
          </aside>

      {browserOpen && (
        <>
          {/*
            The pane's left edge. Six pixels, like the sidebar's, so the two read as the same
            kind of thing — and because the native view underneath paints over anything with a
            z-index, the handle has to live in the renderer's grid rather than on top of the page.
          */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize browser pane"
            aria-valuenow={Math.round(browserWidth)}
            aria-valuemin={BROWSER_MIN}
            aria-valuemax={BROWSER_MAX}
            onPointerDown={onBrowserPointerDown}
            onPointerMove={onBrowserPointerMove}
            onPointerUp={onBrowserPointerUp}
            onPointerCancel={onBrowserPointerUp}
            onDoubleClick={() => setBrowserWidth(BROWSER_DEFAULT)}
            style={{
              cursor: 'col-resize',
              touchAction: 'none',
              background: browserDrag
                ? 'var(--focus)'
                : 'linear-gradient(to right, transparent 2px, var(--line) 2px, var(--line) 3px, transparent 3px)',
            }}
          />
          <aside style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            <BrowserPane onClose={() => setBrowserOpen(false)} />
          </aside>
        </>
      )}

      {panelOpen && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize side panel"
            aria-valuenow={Math.round(panelWidth)}
            aria-valuemin={PANEL_MIN}
            aria-valuemax={PANEL_MAX}
            onPointerDown={onPanelPointerDown}
            onPointerMove={onPanelPointerMove}
            onPointerUp={onPanelPointerUp}
            onPointerCancel={onPanelPointerUp}
            onDoubleClick={() => setPanelWidth(PANEL_DEFAULT)}
            style={{
              cursor: 'col-resize',
              touchAction: 'none',
              background: panelDrag
                ? 'var(--focus)'
                : 'linear-gradient(to right, transparent 2px, var(--line) 2px, var(--line) 3px, transparent 3px)',
            }}
          />
          {/* The open chat portals its Files, Checks, Changes, Rules and Notes in here. */}
          <aside className="right-panel" ref={setPanelHost}>
            {!detailShown && !terminalPanelShown && (
              <>
                <PanelTabs panel={panel} onPanel={setPanel} disabled />
                <p className="right-panel-empty">Open a chat or a project terminal to see its files and changes.</p>
              </>
            )}
          </aside>
        </>
      )}
      </div>

      <StatusBar
        summary={summarise({ needsYou: needsYou.length, working: working.length, total: groups.length })}
        working={working.length}
        total={groups.length}
        connected={connection === 'live'}
        github={github.status}
        onGithubSignedIn={(login) => github.setStatus({ signedIn: true, login })}
      />

      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        selected={selected}
        repo={repo}
        chats={groups.map((g) => ({ id: g.chatId, title: chatLabel(g) }))}
        view={view}
        browserOpen={browserOpen}
        onOpenChat={(id) => {
          const chat = groups.find((g) => g.chatId === id);
          if (chat) openLane(primaryLane(chat));
        }}
        onNewChat={() => {
          setPalette(false);
          void openDraftTab();
        }}
        onPlan={() => {
          setPalette(false);
          void openPlan().catch((err: Error) => setActionError(err.message));
        }}
        onBoard={() => setView((current) => (current === 'board' ? 'list' : 'board'))}
        onBrowser={() => setBrowserOpen((current) => !current)}
        onQuickNote={openCapture}
        onNotes={() => {
          setView('list');
          openPanel('notes');
        }}
        onError={setActionError}
      />

      {menu?.kind === 'terminal' && (
        <RowMenu
          x={menu.x}
          y={menu.y}
          label="Delete terminal"
          onClose={() => setMenu(null)}
          onDelete={() => {
            const id = menu.id;
            setMenu(null);
            // Ends the shell and whatever runs in it, and forgets its saved output.
            closeTab(id);
          }}
        />
      )}

      {menu && menu.kind !== 'terminal' && (
        <RowMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onDelete={() => {
            const id = menu.id;
            setMenu(null);
            const task = chats.find((t) => t.task.id === id);
            void api.taskArchive(id).then(
              () => {
                const chatId = task?.chatId;
                const leftover = chats.filter((t) => t.chatId === chatId && t.task.id !== id);
                if (chatId && leftover.length === 0) closeTab(chatId);
              },
              (err: Error) => setActionError(err.message),
            );
          }}
        />
      )}

      {agentModal && (
        <AgentPicker
          agents={catalog}
          shells={shells}
          defaultId={resolveNewChatAgent(null, defaultAgent)}
          repoName={
            agentModal.repoId != null
              ? (repo?.repoId === agentModal.repoId
                  ? repo.name
                  : (repoPaths[agentModal.repoId] ?? agentModal.repoId))
              : null
          }
          onPick={(agentId) => openDraftWithAgent(agentModal, agentId)}
          onPickShell={(shell) => openTerminal(agentModal, shell)}
          onClose={() => setAgentModal(null)}
        />
      )}

      {/*
        Quick capture — issue #19. At the root rather than inside the detail pane, because it
        has to work from anywhere: the point is writing a note down without losing your place,
        and a popover scoped to one pane is a popover that is closed when you are in another.
      */}
      {capture && captureRepoId != null && (
        <QuickCapture
          repoId={captureRepoId}
          file={fileCtx?.file ?? null}
          line={fileCtx?.line ?? null}
          onClose={() => setCapture(false)}
          onSaved={() => setNotesVersion((n) => n + 1)}
        />
      )}
    </div>
  );
}

function TabStrip({
  tabs,
  groups,
  terminalAgents,
  activeId,
  sidebarHidden,
  onShowSidebar,
  onNew,
  onCommand,
  panelOpen,
  onTogglePanel,
  onSelect,
  onClose,
}: {
  tabs: Tab[];
  groups: ChatGroup[];
  terminalAgents: Record<string, TerminalAgent>;
  activeId: string | null;
  sidebarHidden?: boolean;
  onShowSidebar?: () => void;
  onNew: () => void;
  onCommand: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}): JSX.Element {
  return (
    <div className="osade-tabs" role="tablist" aria-label="Open sessions">
      {sidebarHidden && onShowSidebar && (
        <button
          type="button"
          className="tab-sidebar-toggle"
          onClick={onShowSidebar}
          title="Show sidebar"
          aria-label="Show sidebar"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
            <path d="M6 2.5v11" />
          </svg>
          <span>Sidebar</span>
        </button>
      )}
      {tabs.map((tab) => {
        const chat = tab.kind === 'chat' ? groups.find((g) => g.chatId === tab.id) : null;
        const termAgent = tab.kind === 'terminal' ? terminalAgents[tab.id] : undefined;
        const title =
          tab.kind === 'draft'
            ? 'New chat'
            : tab.kind === 'terminal'
              ? (termAgent?.label ?? tab.title)
              : (chat?.title ?? 'Chat');
        const agentId =
          tab.kind === 'draft' ? tab.agentId : chat ? primaryLane(chat).agentId : null;
        const tone = chat
          ? STATUS[chat.status].tone
          : termAgent
            ? terminalAgentTone(termAgent.status)
            : tab.kind === 'draft'
              ? 'needs'
              : 'rest';
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            title={title}
            className="osade-tab"
            onClick={() => onSelect(tab.id)}
          >
            {termAgent ? (
              <AgentMark name={termAgent.agent} size={14} />
            ) : tab.kind === 'terminal' ? (
              <ShellIcon shell={tab.shell} size={14} />
            ) : agentId ? (
              <AgentMark name={agentId} size={14} />
            ) : (
              <span className="session-dot" data-tone={tone} />
            )}
            {tone === 'live' && (
              <span className="dock-status-dot dock-status-live" data-tone="live" title="Agent active" />
            )}
            <span className="osade-tab-title">{title}</span>
            <span
              role="button"
              aria-label={`Close ${title}`}
              title={`Close ${title}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
              className="osade-tab-close"
            >
              ×
            </span>
          </button>
        );
      })}
      {tabs.length === 0 ? (
        <button type="button" className="tab-sidebar-toggle" onClick={onNew} aria-label="New chat">
          + New chat
        </button>
      ) : (
        <button type="button" className="osade-tab-add" onClick={onNew} aria-label="New chat" title="New chat (⌘T)">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      )}
      <button
        type="button"
        className="tab-command-button"
        onClick={onCommand}
        title={`Open command center (${chord('k')})`}
        aria-label="Open command center"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="7" cy="7" r="4.3" />
          <path d="m10.3 10.3 3.2 3.2" />
        </svg>
        <span>Command</span>
        <kbd>{chord('k')}</kbd>
      </button>
      <button
        type="button"
        className="tab-panel-toggle"
        onClick={onTogglePanel}
        aria-pressed={panelOpen}
        title={panelOpen ? 'Hide side panel' : 'Show side panel'}
        aria-label={panelOpen ? 'Hide side panel' : 'Show side panel'}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
          <path d="M10 2.5v11" />
        </svg>
      </button>
    </div>
  );
}

function RowMenu({
  x,
  y,
  label = 'Delete',
  onClose,
  onDelete,
}: {
  x: number;
  y: number;
  label?: string;
  onClose: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <div
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 30 }}
    >
      <div
        role="menu"
        onClick={(event) => event.stopPropagation()}
        style={{
          position: 'fixed',
          left: x,
          top: y,
          minWidth: 140,
          background: 'var(--bg-2)',
          border: '0.5px solid var(--line)',
          borderRadius: 'var(--radius)',
          padding: '4px 0',
        }}
      >
        <button
          role="menuitem"
          onClick={onDelete}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            borderRadius: 0,
            padding: '6px 12px',
          }}
        >
          {label}
        </button>
      </div>
    </div>
  );
}

function NothingSelected({
  hasChats,
  onNew,
  onSearch,
}: {
  hasChats: boolean;
  onNew?: () => void;
  onSearch?: () => void;
}): JSX.Element {
  return (
    <div className="workspace-empty">
      <div className="workspace-empty-card">
        <div className="workspace-empty-logo" aria-hidden="true">
          <img src={osadeLogo} alt="Osade" className="workspace-empty-logo-img" />
        </div>
        <h1>Agent workspace</h1>
        <p>
          {hasChats
            ? 'Open a session from the sidebar, or start one and direct an agent from here.'
            : 'Start a session to direct an agent, watch the work, and review what changed.'}
        </p>
        <div className="workspace-empty-actions">
          {onNew && (
            <button type="button" className="primary" onClick={onNew}>
              New chat <kbd>{chord('t')}</kbd>
            </button>
          )}
          {onSearch && (
            <button type="button" onClick={onSearch}>
              Search <kbd>{chord('k')}</kbd>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function groupByRepo(tasks: TaskView[]): { repoId: string; chats: ChatGroup[] }[] {
  const map = new Map<string, TaskView[]>();
  for (const task of tasks) {
    const list = map.get(task.task.repo_id) ?? [];
    list.push(task);
    map.set(task.task.repo_id, list);
  }
  return [...map.entries()].map(([repoId, list]) => ({
    repoId,
    chats: groupChats(list).sort((a, b) => chatActivity(b) - chatActivity(a)),
  }));
}

function optimisticLine(message: string, photos: ComposerPhoto[]): string {
  const n = photos.length;
  const tag = n === 0 ? '' : `(${n} ${n === 1 ? 'photo' : 'photos'})`;
  const body = message.trim();
  if (body.length === 0) return tag;
  return tag.length > 0 ? `${body}\n${tag}` : body;
}

function repoLabel(
  repoId: string,
  repo: OpenRepo | null,
  worktreePath: string | null,
  aliases: Record<string, string>,
): string {
  const alias = aliases[repoId]?.trim();
  if (alias) return alias;
  const folder = worktreePath ? folderFromWorktree(worktreePath) : null;
  if (folder) return folder;
  if (repo?.repoId === repoId) return repo.name || repo.slug || repoId;
  return repoId;
}

/** `~/.osade/worktrees/<folder>/<taskId>` — the folder is the repo's directory name. */
function folderFromWorktree(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1] ?? '';
  if (last.startsWith('t_')) return parts[parts.length - 2] ?? null;
  return last;
}

interface OpenedFolder {
  repoId: string;
  path: string;
}

function loadOpenedFolders(): OpenedFolder[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(OPENED_FOLDERS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (f): f is OpenedFolder =>
        typeof f === 'object' && f != null && typeof f.repoId === 'string' && typeof f.path === 'string',
    );
  } catch {
    return [];
  }
}

const SHELL_KINDS: readonly ShellKind[] = ['default', 'powershell', 'cmd', 'gitbash'];

function loadTerminalTabs(): { tabs: TerminalTab[]; activeId: string | null } {
  try {
    const raw = JSON.parse(localStorage.getItem(TERMINAL_TABS_KEY) ?? 'null') as {
      tabs?: unknown;
      activeId?: unknown;
    } | null;
    const tabs = (Array.isArray(raw?.tabs) ? raw.tabs : []).flatMap((t: unknown): TerminalTab[] => {
      const tab = t as Partial<TerminalTab> | null;
      if (
        tab == null ||
        typeof tab.id !== 'string' ||
        typeof tab.cwd !== 'string' ||
        typeof tab.title !== 'string' ||
        !SHELL_KINDS.includes(tab.shell as ShellKind)
      ) {
        return [];
      }
      return [
        {
          kind: 'terminal',
          id: tab.id,
          repoId: typeof tab.repoId === 'string' ? tab.repoId : null,
          cwd: tab.cwd,
          shell: tab.shell as ShellKind,
          title: tab.title,
        },
      ];
    });
    const activeId =
      typeof raw?.activeId === 'string' && tabs.some((t) => t.id === raw.activeId) ? raw.activeId : null;
    return { tabs, activeId };
  } catch {
    return { tabs: [], activeId: null };
  }
}

function saveTerminalTabs(tabs: TerminalTab[], activeId: string | null): void {
  try {
    const active = tabs.some((t) => t.id === activeId) ? activeId : null;
    localStorage.setItem(TERMINAL_TABS_KEY, JSON.stringify({ tabs, activeId: active }));
  } catch {
    // localStorage can throw in a private session.
  }
}

function loadIdList(key: string): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveIdList(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // localStorage can throw in a private session.
  }
}

function saveOpenedFolders(folders: OpenedFolder[]): void {
  try {
    localStorage.setItem(OPENED_FOLDERS_KEY, JSON.stringify(folders));
  } catch {
    // localStorage can throw in a private session.
  }
}

function loadSidebarWidth(): number {
  try {
    const n = Number(localStorage.getItem(SIDEBAR_KEY));
    if (Number.isFinite(n)) return clampSidebar(n);
  } catch {
    // localStorage can throw in a private session.
  }
  return SIDEBAR_DEFAULT;
}

function clampSidebar(n: number): number {
  const room = typeof window === 'undefined' ? SIDEBAR_MAX : window.innerWidth - 280;
  return clamp(n, SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, room)));
}

/**
 * The browser pane's remembered state — issue #13.
 *
 * localStorage like the sidebar's, and for the same reason: a pane you have to re-open and
 * re-navigate on every launch is a pane you stop using. It is a *view*, not durable product
 * state, so it does not belong in the ledger or the database (§5.4 is for changes, not settings).
 *
 * Open or closed, and how wide — but **not** the URL. The pane starts at
 * `http://localhost:3000` every time it is opened, because the thing you want to look at is
 * whatever you just started, and a remembered URL is a remembered *yesterday*.
 */
function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function loadBrowserWidth(): number {
  try {
    const raw = localStorage.getItem(BROWSER_WIDTH_KEY);
    // The key's presence is the check, not the value's type. `Number(null)` is `0`, so a profile
    // that has never opened the pane returns a *valid* zero — which clamps straight down to the
    // minimum, and a first run would get the smallest pane instead of the default.
    if (raw != null && raw.trim() !== '') {
      const n = Number(raw);
      if (Number.isFinite(n)) return clampBrowser(n);
    }
  } catch {
    // localStorage can throw in a private session.
  }
  return BROWSER_DEFAULT;
}

function clampBrowser(n: number): number {
  return clampBrowserWidth(n, typeof window === 'undefined' ? BROWSER_MAX : window.innerWidth);
}

function loadPanelWidth(): number {
  try {
    const raw = localStorage.getItem(PANEL_WIDTH_KEY);
    if (raw != null && raw.trim() !== '') {
      const n = Number(raw);
      if (Number.isFinite(n)) return clampPanel(n);
    }
  } catch {
    // localStorage can throw in a private session.
  }
  return PANEL_DEFAULT;
}

function clampPanel(n: number): number {
  const room = typeof window === 'undefined' ? PANEL_MAX : window.innerWidth - 480;
  return clamp(n, PANEL_MIN, Math.min(PANEL_MAX, Math.max(PANEL_MIN, room)));
}

function loadAliases(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) out[key] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function loadCollapsed(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? new Set(raw.filter((x) => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

async function pickRepo(): Promise<OpenRepo | null> {
  const folder = await window.osade?.chooseRepository();
  if (!folder) return null;
  return api.repoOpen(folder);
}

function decideGate(
  selected: TaskView | null,
  decision: 'approve' | 'deny',
  onError: (message: string) => void,
): Promise<void> {
  const gate = selected?.openGates.find((g) => g.decided_at == null);
  if (!gate) return Promise.resolve();
  return api.gateDecide(gate.id, decision).then(
    () => undefined,
    (err: Error) => onError(err.message),
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function clamp(n: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, n));
}

/** The shells the daemon can open here; empty until it answers, so the menu shows agents only. */
function useShellOptions(live: boolean): ShellOption[] {
  const [shells, setShells] = useState<ShellOption[]>([]);
  useEffect(() => {
    if (!live) return;
    let stale = false;
    void api.terminalShells().then(
      (next) => {
        if (!stale) setShells(next);
      },
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [live]);
  return shells;
}
