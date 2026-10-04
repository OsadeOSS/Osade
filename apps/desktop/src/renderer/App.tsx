import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type PointerEvent as ReactPointerEvent } from 'react';

import type { TaskView } from '@osade/contract';

import { AgentMark } from './agent-icon.js';
import { AgentPicker, resolveNewChatAgent } from './AgentPicker.js';
import osadeLogo from './assets/osade.png';
import { Board } from './Board.js';
import { BROWSER_DEFAULT, BROWSER_MAX, BROWSER_MIN, clampBrowserWidth } from './browser-view.js';
import { BrowserPane } from './BrowserPane.js';
import { CommandPalette } from './CommandPalette.js';
import { photosPrompt, type ComposerPhoto } from './compose-photos.js';
import { Detail, DraftPane, type FileContext, type Lane } from './Detail.js';
import { api } from './api.js';
import { attachCheckoutHint, isolatedWorktreeHint } from './branch-copy.js';
import { chord } from './chords.js';
import { type PendingLane } from './delivery.js';
import { GitHubSignIn, useGithub } from './GitHubSignIn.js';
import {
  chatActivity,
  chatLabel,
  displayBranch,
  groupChats,
  laneDigest,
  primaryLane,
  showPinnedNeedsYou,
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
import { contextReposForChat } from './repo-context.js';
import { RepoSettings, useAgentCatalog } from './RepoSettings.js';
import { STATUS, TONE_COLOUR, ago, summarise } from './status.js';
import { titleFrom } from './title.js';
import { useLedger } from './useLedger.js';
import { useRepo, type OpenRepo } from './useRepo.js';

const LANES: Lane[] = ['transcript', 'files', 'checks', 'diff', 'rules', 'notes'];
const COLLAPSE_KEY = 'osade.repo-collapsed';
const NAMES_KEY = 'osade.repo-names';
const GITHUB_SKIP_KEY = 'osade.github-skipped';
const SIDEBAR_KEY = 'osade.sidebar-width';
const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 640;
const SIDEBAR_DEFAULT = 320;
const BROWSER_KEY = 'osade.browser-open';
const BROWSER_WIDTH_KEY = 'osade.browser-width';

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
  | { kind: 'chat'; id: string; focusId?: string; optimistic?: string; isolatedNotice?: string };

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
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lane, setLane] = useState<Lane>('transcript');
  const [view, setView] = useState<'list' | 'board'>('list');
  const [palette, setPalette] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
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
  const flat = useMemo(() => byRepo.flatMap((g) => g.chats), [byRepo]);

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;
  const selectedChat =
    activeTab?.kind === 'chat' ? (groups.find((g) => g.chatId === activeTab.id) ?? null) : null;
  const selected =
    selectedChat == null || activeTab?.kind !== 'chat'
      ? null
      : (selectedChat.lanes.find((l) => l.task.id === activeTab.focusId) ??
        primaryLane(selectedChat));

  // List + an open tab: sidebar beside the chat. Kanban is the whole window.
  const showDetail =
    view !== 'board' &&
    activeTab != null &&
    (activeTab.kind === 'draft' || selectedChat != null);
  const showWorkspace = view !== 'board';
  const sidebarVisible = view === 'board' || sidebarOpen;

  /**
   * Which repository a new note belongs to: the chat in focus, else the open one.
   *
   * Notes are repo-scoped, so this has to be a real repository rather than a guess — a note
   * filed against the wrong repo is a note that never comes back.
   */
  const captureRepoId = selected?.task.repo_id ?? repo?.repoId ?? null;

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
    setLane('transcript');
  }, [repo, requestId]);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 960px)');
    const sync = () => setSidebarOpen(!mq.matches);
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
          setLane('transcript');
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
        setView('list');
        setLane((current) => (current === 'notes' ? 'transcript' : 'notes'));
        return;
      }

      const digit = event.key >= '1' && event.key <= '6';
      if (digit && selected) {
        event.preventDefault();
        setLane(LANES[Number(event.key) - 1]!);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, agentModal, defaultAgent, flat, menu, palette, repo, selected, selectedChat, tabs]);

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
    setLane('transcript');
  }

  async function openDraftTab(from?: {
    repoId: string;
    path?: string;
    isolate?: boolean;
    checkoutRef?: string;
    baseRef?: string;
  }): Promise<void> {
    let repoId = from?.repoId ?? repo?.repoId ?? null;
    let repoPath = from?.path ?? repo?.path ?? null;

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
      setRepoPaths((current) => ({ ...current, [picked.repoId]: picked.path }));
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
    setLane('transcript');
  }

  async function openPlan(): Promise<void> {
    let repoPath = repo?.path ?? (selected ? (repoPaths[selected.task.repo_id] ?? null) : null);
    if (repoPath == null) {
      const picked = await pickRepo();
      if (!picked) return;
      repoPath = picked.path;
      setRepoPaths((current) => ({ ...current, [picked.repoId]: picked.path }));
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
      setLane('transcript');
    }
  }

  function closeTab(id: string | null): void {
    if (id == null) return;
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

  return (
    <div
      className="osade-shell"
      style={{
        display: 'grid',
        gridTemplateColumns: [
          // Must mirror the children rendered below, or the grid wraps them into rows.
          showWorkspace && sidebarOpen ? `${sidebarWidth}px` : null,
          showWorkspace && sidebarOpen ? '6px' : null,
          'minmax(0, 1fr)',
          browserOpen ? '6px' : null,
          browserOpen ? `${browserWidth}px` : null,
        ]
          .filter(Boolean)
          .join(' '),
        height: '100%',
        background: 'var(--bg-0)',
        cursor: sidebarDrag || browserDrag ? 'col-resize' : undefined,
        userSelect: sidebarDrag || browserDrag ? 'none' : undefined,
      }}
    >
      {sidebarVisible && (
      <main
        className="osade-sidebar"
        style={{
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg-1)',
          minWidth: 0,
          height: '100%',
        }}
      >
        <Header
          repo={repo}
          branch={
            repo
              ? (chats.find((t) => t.task.repo_id === repo.repoId && t.attachment === 'repo')
                  ?.branch ?? repo.currentBranch)
              : null
          }
          summary={summarise({
            needsYou: needsYou.length,
            working: working.length,
            total: groups.length,
          })}
          view={view}
          onView={setView}
          browserOpen={browserOpen}
          onBrowser={() => setBrowserOpen((open) => !open)}
          onNew={() => void openDraftTab()}
          onSearch={() => setPalette(true)}
          onHide={showWorkspace ? () => setSidebarOpen(false) : undefined}
          settings={
            repo ? (
              <RepoSettings
                repoId={repo.repoId}
                defaultAgent={defaultAgent}
                catalog={catalog}
                onSaved={setAgentOverride}
              />
            ) : null
          }
        />
        {(repoError ?? actionError) && (
          <div
            title={repoError ?? actionError ?? undefined}
            style={{
              padding: '6px 16px',
              fontSize: 'var(--t-xs)',
              color: 'var(--st-fail)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              borderBottom: '0.5px solid var(--line)',
            }}
          >
            {repoError ?? actionError}
          </div>
        )}

        <div style={{ flex: 1, overflow: view === 'board' ? 'hidden' : 'auto', minHeight: 0 }}>
          {chats.length === 0 && tabs.length === 0 ? (
            <Empty
              connection={connection}
              repo={repo}
              onNew={() => void openDraftTab()}
            />
          ) : view === 'board' ? (
            <Board
              chats={groups}
              selectedId={selectedChat?.chatId ?? null}
              onSelect={(chat) => openLane(primaryLane(chat))}
              onMenu={(id, x, y) => setMenu({ id, x, y })}
            />
          ) : (
            <>
              <div className="sidebar-kicker">Conversations</div>
              {showPinnedNeedsYou(needsYou.length, groups.length) && (
                <section>
                  <h2 style={groupHeadStyle('var(--st-needs)')}>Needs you · {needsYou.length}</h2>
                  {needsYou.map((chat) => (
                    <ChatRow
                      key={`need-${chat.chatId}`}
                      chat={chat}
                      selected={selectedChat?.chatId === chat.chatId}
                      onSelect={() => openLane(primaryLane(chat))}
                      onMenu={(x, y) =>
                        setMenu({ id: primaryLane(chat).task.id, x, y })
                      }
                    />
                  ))}
                </section>
              )}

              {byRepo.map((group) => {
                const closed = collapsed.has(group.repoId);
                const sample = group.chats[0]?.lanes[0];
                const label = repoLabel(group.repoId, repo, sample?.cwd ?? null, aliases);
                const hideRepoHead =
                  repo != null && byRepo.length === 1 && group.repoId === repo.repoId;
                const groupBranch =
                  group.chats.flatMap((c) => c.lanes).find((t) => t.attachment === 'repo')
                    ?.branch ?? sample?.branch;
                return (
                  <section key={group.repoId}>
                    {!hideRepoHead && (
                    <h2 style={groupHeadStyle('var(--ink-2)')}>
                      <button
                        onClick={() =>
                          setCollapsed((set) => {
                            const next = new Set(set);
                            if (next.has(group.repoId)) next.delete(group.repoId);
                            else next.add(group.repoId);
                            return next;
                          })
                        }
                        style={{
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          color: 'inherit',
                          font: 'inherit',
                        }}
                      >
                        {closed ? '▸' : '▾'}
                      </button>
                      {renaming === group.repoId ? (
                        <input
                          autoFocus
                          defaultValue={label}
                          aria-label="Repository name"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              const next = event.currentTarget.value.trim();
                              setAliases((current) => {
                                const copy = { ...current };
                                if (next.length === 0) delete copy[group.repoId];
                                else copy[group.repoId] = next;
                                return copy;
                              });
                              setRenaming(null);
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              setRenaming(null);
                            }
                          }}
                          onBlur={(event) => {
                            const next = event.currentTarget.value.trim();
                            setAliases((current) => {
                              const copy = { ...current };
                              if (next.length === 0) delete copy[group.repoId];
                              else copy[group.repoId] = next;
                              return copy;
                            });
                            setRenaming(null);
                          }}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            font: 'inherit',
                            fontWeight: 600,
                            padding: '2px 6px',
                          }}
                        />
                      ) : (
                        <span
                          title="Double-click or right-click to rename"
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setRenaming(group.repoId);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setRenaming(group.repoId);
                          }}
                          style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        >
                          {label}
                        </span>
                      )}
                      {groupBranch ? (
                        <span className="branch-tail" title={groupBranch}>
                          {groupBranch}
                        </span>
                      ) : null}
                      <button
                        title="New chat"
                        onClick={() =>
                          void openDraftTab({
                            repoId: group.repoId,
                            path: repo?.repoId === group.repoId ? repo.path : undefined,
                          })
                        }
                        style={{ marginLeft: 'auto', padding: '2px 8px' }}
                      >
                        +
                      </button>
                    </h2>
                    )}
                    {(hideRepoHead || !closed) &&
                      group.chats.map((chat) => (
                        <ChatRow
                          key={chat.chatId}
                          chat={chat}
                          selected={selectedChat?.chatId === chat.chatId}
                          onSelect={() => openLane(primaryLane(chat))}
                          onMenu={(x, y) =>
                            setMenu({ id: primaryLane(chat).task.id, x, y })
                          }
                        />
                      ))}
                  </section>
                );
              })}
            </>
          )}
        </div>

        <SidebarFoot
          className="osade-foot"
          working={working.length}
          total={groups.length}
          connected={connection === 'live'}
          github={github.status}
          onGithubSignedIn={(login) => github.setStatus({ signedIn: true, login })}
        />
      </main>
      )}

      {showWorkspace && (
        <>
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
          activeId={activeId}
          sidebarHidden={!sidebarOpen}
          onShowSidebar={() => setSidebarOpen(true)}
          onNew={() => void openDraftTab()}
          onCommand={() => setPalette(true)}
          onSelect={(id) => {
            setActiveId(id);
            setLane('transcript');
          }}
          onClose={closeTab}
        />
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {!showDetail ? (
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
              lane={lane}
              onLane={setLane}
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
        </>
      )}

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
          setLane('notes');
        }}
        onError={setActionError}
      />

      {menu && (
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
          defaultId={resolveNewChatAgent(null, defaultAgent)}
          repoName={
            agentModal.repoId != null
              ? (repo?.repoId === agentModal.repoId
                  ? repo.name
                  : (repoPaths[agentModal.repoId] ?? agentModal.repoId))
              : null
          }
          onPick={(agentId) => openDraftWithAgent(agentModal, agentId)}
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
  activeId,
  sidebarHidden,
  onShowSidebar,
  onNew,
  onCommand,
  onSelect,
  onClose,
}: {
  tabs: Tab[];
  groups: ChatGroup[];
  activeId: string | null;
  sidebarHidden?: boolean;
  onShowSidebar?: () => void;
  onNew: () => void;
  onCommand: () => void;
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
        const title = tab.kind === 'draft' ? 'New chat' : (chat?.title ?? 'Chat');
        const agentId =
          tab.kind === 'draft' ? tab.agentId : chat ? primaryLane(chat).agentId : null;
        const tone = chat ? STATUS[chat.status].tone : tab.kind === 'draft' ? 'needs' : 'rest';
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
            {agentId ? (
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
    </div>
  );
}

function ChatRow({
  chat,
  selected,
  onSelect,
  onMenu,
}: {
  chat: ChatGroup;
  selected: boolean;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
}): JSX.Element {
  const copy = STATUS[chat.status];
  const colour = TONE_COLOUR[copy.tone];
  const primary = primaryLane(chat);
  const stacked = chat.lanes.length > 1;
  const behind = stacked ? chat.lanes[1] : null;
  const branch = displayBranch(primary.branch);
  const age = ago(chatActivity(chat));
  const extraLanes = chat.lanes.length - 3;

  return (
    <div
      data-task-id={primary.task.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className="ledger-row"
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: '3px 22px minmax(0, 1fr)',
        gridTemplateRows: 'auto auto',
        columnGap: 9,
        rowGap: 3,
        alignItems: 'center',
        minHeight: 52,
        padding: '8px 12px 8px 10px',
        borderBottom: '0.5px solid var(--line)',
        cursor: 'default',
      }}
    >
      <span
        style={{
          gridColumn: 1,
          gridRow: '1 / 3',
          background: colour,
          alignSelf: 'stretch',
          borderRadius: 2,
          opacity: copy.tone === 'rest' ? 0.35 : 1,
        }}
        aria-hidden="true"
      />
      <span
        style={{
          gridColumn: 2,
          gridRow: '1 / 3',
          position: 'relative',
          width: 22,
          height: 22,
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        {behind && (
          <span
            style={{
              position: 'absolute',
              right: -2,
              bottom: -2,
              width: 15,
              height: 15,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-2)',
              border: '1px solid var(--bg-1)',
              borderRadius: 3,
            }}
          >
            <AgentMark name={behind.agentId} size={13} />
          </span>
        )}
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 17,
            height: 17,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 3,
          }}
        >
          <AgentMark name={primary.agentId} size={15} />
        </span>
      </span>
      <div
        style={{
          gridColumn: 3,
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          minWidth: 0,
        }}
      >
        <div
          title={chatLabel(chat)}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: '13px',
            fontWeight: selected ? 600 : 500,
            lineHeight: 1.3,
            color: 'var(--ink)',
          }}
        >
          {chatLabel(chat)}
        </div>
        {age && (
          <span
            className="mono"
            style={{
              flexShrink: 0,
              fontSize: '11px',
              color: 'var(--ink-3)',
              lineHeight: 1.3,
            }}
          >
            {age}
          </span>
        )}
      </div>
      <div
        style={{
          gridColumn: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 0,
        }}
      >
        <span className="branch-clip" title={primary.branch} style={{ fontSize: '11px' }}>
          <span>{branch}</span>
        </span>
        {stacked && (
          <span
            style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}
            title={chat.lanes.map((lane) => lane.agentId).join(', ')}
          >
            {chat.lanes.slice(0, 3).map((lane) => (
              <span
                key={lane.task.id}
                style={{
                  width: 12,
                  height: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AgentMark name={lane.agentId} size={12} />
              </span>
            ))}
            {extraLanes > 0 && (
              <span className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-3)' }}>
                {chat.lanes.length}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function RowMenu({
  x,
  y,
  onClose,
  onDelete,
}: {
  x: number;
  y: number;
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
          Delete
        </button>
      </div>
    </div>
  );
}

function Header({
  repo,
  branch,
  summary,
  view,
  onView,
  browserOpen,
  onBrowser,
  onNew,
  onSearch,
  onHide,
  settings,
}: {
  repo: { name: string; slug: string | null } | null;
  branch?: string | null;
  summary: string;
  view: 'list' | 'board';
  onView: (view: 'list' | 'board') => void;
  browserOpen: boolean;
  onBrowser: () => void;
  onNew: () => void;
  onSearch: () => void;
  onHide?: () => void;
  settings: JSX.Element | null;
}): JSX.Element {
  return (
    <header
      style={{
        padding: '12px 14px 10px 14px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--bg-1)',
        minWidth: 0,
      }}
    >
      <div className="osade-brand">
        <div className="osade-mark" title="Osade">
          <img src={osadeLogo} alt="Osade" className="osade-logo" />
        </div>
        {onHide && (
          <button
            type="button"
            className="osade-hide-btn"
            onClick={onHide}
            aria-label="Hide sidebar"
            title="Hide sidebar"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
              <path d="M6 2.5v11" />
            </svg>
            <span>Hide</span>
          </button>
        )}
      </div>
      <div className="osade-repo-row">
        <svg className="repo-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M2 3.5h4.5l1.5 2H14v7.5H2z" />
        </svg>
        <div className="osade-repo" title={repo?.slug ?? repo?.name ?? 'Osade'}>
          {repo ? repo.name : 'No repository'}
        </div>
        {branch ? (
          <span className="branch-tail" title={branch}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="4" cy="4" r="2" />
              <circle cx="4" cy="12" r="2" />
              <circle cx="12" cy="7" r="2" />
              <path d="M4 6v4M4 8a4 4 0 0 1 4-4h2" />
            </svg>
            <span>{branch}</span>
          </span>
        ) : null}
      </div>
      <div className="osade-summary">{summary}</div>
      <button
        data-new-task
        onClick={onNew}
        className="primary osade-new-chat-btn"
        title={`New chat (${chord('t')})`}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
        <span>New chat</span>
        <kbd>{chord('t')}</kbd>
      </button>
      <div className="osade-actions">
        <button
          type="button"
          className="osade-action-btn"
          onClick={onSearch}
          title={`Search chats (${chord('k')})`}
          aria-label="Search chats"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5 14 14" />
          </svg>
          <span className="osade-action-label">Search</span>
        </button>
        <button
          type="button"
          className="osade-action-btn"
          title={view === 'board' ? 'Switch to List view' : 'Switch to Kanban board'}
          aria-label={view === 'board' ? 'Switch to List view' : 'Switch to Kanban board'}
          onClick={() => onView(view === 'board' ? 'list' : 'board')}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            {view === 'board' ? <path d="M3 4.5h10M3 8h10M3 11.5h10" /> : <path d="M3 3h4v10H3zM9 3h4v6H9z" />}
          </svg>
          <span className="osade-action-label">{view === 'board' ? 'List' : 'Kanban'}</span>
        </button>
        <button
          type="button"
          className="osade-action-btn"
          aria-pressed={browserOpen}
          title={`Browser view (${chord('b')})`}
          aria-label="Browser view"
          onClick={onBrowser}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <path d="M2 6h12" />
          </svg>
          <span className="osade-action-label">Browser</span>
        </button>
        {settings}
      </div>
    </header>
  );
}

function SidebarFoot({
  working,
  total,
  connected,
  github,
  onGithubSignedIn,
  className,
}: {
  working: number;
  total: number;
  connected: boolean;
  github: { signedIn: boolean; login: string | null };
  onGithubSignedIn: (login: string) => void;
  className?: string;
}): JSX.Element {
  return (
    <div className={className} style={{ position: 'relative', background: 'var(--bg-1)' }}>
      <div className="status-dock" aria-label="Application status">
        <DockRow
          icon="agents"
          label="Agents"
          value={working === 0 ? 'Idle' : `${working} running`}
          tone={working === 0 ? 'var(--ink-3)' : 'var(--st-live)'}
          statusDot={working > 0 ? 'live' : 'idle'}
        />
        <DockRow
          icon="chats"
          label="Chats"
          value={String(total)}
        />
        <DockRow
          icon="daemon"
          label="Daemon"
          value={connected ? 'Connected' : 'Reconnecting'}
          tone={connected ? 'var(--st-live)' : 'var(--st-fail)'}
          statusDot={connected ? 'live' : 'fail'}
        />
        {github.signedIn ? (
          <DockRow
            icon="github"
            label="GitHub"
            value={github.login ?? 'Signed in'}
            tone="var(--ink)"
            statusDot="live"
          />
        ) : (
          <details>
            <summary className="dock-row">
              <div className="dock-row-lead">
                <DockIcon name="github" />
                <span className="dock-label">GitHub</span>
              </div>
              <div className="dock-row-val">
                <span className="dock-badge-action">Sign in</span>
              </div>
            </summary>
            <div
              style={{
                position: 'absolute',
                left: 8,
                right: 8,
                bottom: '100%',
                marginBottom: 6,
                zIndex: 20,
                background: 'var(--bg-1)',
                border: '0.5px solid var(--line)',
                borderRadius: 'var(--radius)',
                padding: 12,
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.4)',
              }}
            >
              <GitHubSignIn status={github} onSignedIn={onGithubSignedIn} />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function DockRow({
  icon,
  label,
  value,
  tone,
  statusDot,
}: {
  icon: 'agents' | 'chats' | 'daemon' | 'github';
  label: string;
  value: string;
  tone?: string;
  statusDot?: 'live' | 'fail' | 'idle';
}): JSX.Element {
  return (
    <div className="dock-row">
      <div className="dock-row-lead">
        <DockIcon name={icon} />
        <span className="dock-label">{label}</span>
      </div>
      <div className="dock-row-val">
        {statusDot && (
          <span
            className={`dock-status-dot ${statusDot === 'live' ? 'dock-status-live' : ''}`}
            data-tone={statusDot}
            aria-hidden="true"
          />
        )}
        <span className="dock-value" style={{ color: tone }}>{value}</span>
      </div>
    </div>
  );
}

function DockIcon({ name }: { name: 'agents' | 'chats' | 'daemon' | 'github' }): JSX.Element {
  const common = {
    className: 'dock-ico',
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    'aria-hidden': true as const,
  };
  if (name === 'chats') {
    return (
      <svg {...common}>
        <path d="M2.5 4h11v6.2H5.8L2.5 13z" />
      </svg>
    );
  }
  if (name === 'daemon') {
    return (
      <svg {...common}>
        <rect x="2.5" y="3" width="11" height="4.5" rx="1" />
        <rect x="2.5" y="9" width="11" height="4.5" rx="1" />
        <circle cx="5" cy="5.25" r="0.8" fill="currentColor" />
        <circle cx="5" cy="11.25" r="0.8" fill="currentColor" />
      </svg>
    );
  }
  if (name === 'github') {
    return (
      <svg {...common} fill="currentColor" stroke="none">
        <path d="M8 2.2a5.8 5.8 0 0 0-1.83 11.3c.29.05.4-.12.4-.28v-1.02c-1.62.35-1.96-.7-1.96-.7-.26-.67-.64-.85-.64-.85-.53-.36.04-.35.04-.35.58.04.89.6.89.6.52.88 1.36.63 1.69.48.05-.38.2-.63.37-.78-1.3-.15-2.66-.65-2.66-2.9 0-.64.23-1.16.6-1.57-.06-.15-.26-.75.06-1.56 0 0 .5-.16 1.62.6a5.6 5.6 0 0 1 2.94 0c1.12-.76 1.62-.6 1.62-.6.32.81.12 1.41.06 1.56.38.41.6.93.6 1.57 0 2.26-1.37 2.75-2.67 2.9.21.18.4.53.4 1.07v1.58c0 .16.1.34.4.28A5.8 5.8 0 0 0 8 2.2z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" />
    </svg>
  );
}

function Empty({
  connection,
  repo,
  onNew,
}: {
  connection: string;
  repo: { name: string } | null;
  onNew: () => void;
}): JSX.Element {
  if (connection !== 'live') {
    return (
      <div style={{ padding: '48px 28px', maxWidth: 480 }}>
        <p style={{ marginTop: 0, fontSize: 'var(--t-l)', fontWeight: 600 }}>Connecting to the daemon…</p>
        <p style={{ color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 0 }}>
          Agents keep running while this window is closed, so nothing has been lost. This should
          only take a moment.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '48px 28px', maxWidth: 520 }}>
      <p style={{ marginTop: 0, fontSize: 'var(--t-l)', fontWeight: 600 }}>
        {repo ? `No chats in ${repo.name} yet` : 'No chats yet'}
      </p>
      <p style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>
        {attachCheckoutHint()} {isolatedWorktreeHint()} Osade stops before anything is published.
      </p>
      <button className="primary" onClick={onNew} style={{ marginTop: 4 }}>
        New chat
      </button>
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
        <div className="workspace-empty-agents">
          <span>@claude</span>
          <span>@codex</span>
          <span>@opencode</span>
          <span>@pi</span>
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

function groupHeadStyle(color: string): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    position: 'sticky',
    top: 0,
    zIndex: 1,
    margin: 0,
    padding: '8px 12px 8px 16px',
    fontSize: 'var(--t-xs)',
    fontWeight: 600,
    color,
    background: 'var(--bg-1)',
    borderBottom: '0.5px solid var(--line)',
  };
}
