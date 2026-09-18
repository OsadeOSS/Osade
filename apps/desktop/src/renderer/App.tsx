import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type PointerEvent as ReactPointerEvent } from 'react';

import type { TaskView } from '@osade/contract';

import { AgentMark } from './agent-icon.js';
import { AgentPicker, resolveNewChatAgent } from './AgentPicker.js';
import { Board } from './Board.js';
import { CommandPalette } from './CommandPalette.js';
import { photosPrompt, type ComposerPhoto } from './compose-photos.js';
import { Detail, DraftPane, type Lane } from './Detail.js';
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
import { lanePrompt, parseMentions } from './mentions.js';
import { RepoSettings, useAgentCatalog } from './RepoSettings.js';
import { STATUS, TONE_COLOUR, ago, summarise } from './status.js';
import { titleFrom } from './title.js';
import { useLedger } from './useLedger.js';
import { useRepo, type OpenRepo } from './useRepo.js';

const LANES: Lane[] = ['transcript', 'files', 'checks', 'diff', 'rules'];
const COLLAPSE_KEY = 'osade.repo-collapsed';
const NAMES_KEY = 'osade.repo-names';
const GITHUB_SKIP_KEY = 'osade.github-skipped';
const SIDEBAR_KEY = 'osade.sidebar-width';
const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 640;
const SIDEBAR_DEFAULT = 320;

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
  const sidebarDragOrigin = useRef<{ x: number; width: number } | null>(null);

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
    localStorage.setItem(NAMES_KEY, JSON.stringify(aliases));
  }, [aliases]);

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

      const digit = event.key >= '1' && event.key <= '5';
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
        markPending(tab.id, agentId, prompt || shown, 'starting');
      }
      const created = await api.taskCreate({
        repoPath: tab.repoPath,
        title: titleFrom(message),
        intent: firstPrompt || shown,
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
      void launchAndSend(created.taskId, firstPrompt, photos).catch((err: Error) => setActionError(err.message));
      for (const extra of targets.slice(1)) {
        if (!extra.agentId) continue;
        const extraPrompt = lanePrompt(parsed, extra, message);
        if (extraPrompt.length === 0 && photos.length === 0) continue;
        void (async () => {
          const lane = await api.taskCreate({
            repoPath: tab.repoPath!,
            title: titleFrom(message),
            intent: extraPrompt || shown,
            chatId: created.taskId,
            agentId: extra.agentId,
            ...(tab.baseRef ? { baseRef: tab.baseRef } : {}),
            isolate: true,
          });
          await launchAndSend(lane.taskId, extraPrompt, photos);
        })().catch((err: Error) => {
          markPending(created.taskId, extra.agentId, extraPrompt || shown, 'failed', err.message);
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
    const lane = chat.lanes.find((l) => l.agentId === agentId);
    if (lane == null) {
      if (repoPath == null) throw new Error('Open this repository to add a lane');
      markPending(chat.chatId, agentId, text || optimisticLine('', photos), 'starting');
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
        markPending(chat.chatId, agentId, text, 'failed', (err as Error).message);
        throw err;
      }
      return;
    }
    const digest = laneDigest(lane, chat.lanes);
    await launchAndSend(lane.task.id, withDigest(text, digest), photos);
  }

  async function launchAndSend(
    taskId: string,
    text: string,
    photos: ComposerPhoto[] = [],
  ): Promise<void> {
    const planted = await plantPhotos(taskId, photos);
    const payload = photosPrompt(planted, text);
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
      style={{
        display: 'grid',
        gridTemplateColumns: showDetail
          ? `${sidebarWidth}px 6px minmax(0, 1fr)`
          : 'minmax(0, 1fr)',
        height: '100%',
        background: 'var(--bg-0)',
        cursor: sidebarDrag ? 'col-resize' : undefined,
        userSelect: sidebarDrag ? 'none' : undefined,
      }}
    >
      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg-1)',
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
          onNew={() => void openDraftTab()}
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
          working={working.length}
          total={groups.length}
          connected={connection === 'live'}
          github={github.status}
          onGithubSignedIn={(login) => github.setStatus({ signedIn: true, login })}
        />
      </main>

      {showDetail && (
        <>
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

          <aside style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <TabStrip
          tabs={tabs}
          groups={groups}
          activeId={activeId}
          onSelect={(id) => {
            setActiveId(id);
            setLane('transcript');
          }}
          onClose={closeTab}
        />
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {activeTab?.kind === 'draft' ? (
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
            />
          ) : (
            <NothingSelected hasChats={groups.length > 0} />
          )}
        </div>
          </aside>
        </>
      )}

      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        selected={selected}
        repo={repo}
        chats={groups.map((g) => ({ id: g.chatId, title: chatLabel(g) }))}
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
        onBoard={() => setView('board')}
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
    </div>
  );
}

function TabStrip({
  tabs,
  groups,
  activeId,
  onSelect,
  onClose,
}: {
  tabs: Tab[];
  groups: ChatGroup[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}): JSX.Element | null {
  if (tabs.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        overflowX: 'auto',
        borderBottom: '0.5px solid var(--line)',
        background: 'var(--bg-1)',
        padding: '6px 8px 0',
      }}
    >
      {tabs.map((tab) => {
        const chat = tab.kind === 'chat' ? groups.find((g) => g.chatId === tab.id) : null;
        const title = tab.kind === 'draft' ? 'New chat' : (chat?.title ?? 'Chat');
        const dirty = tab.kind === 'draft';
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              maxWidth: 180,
              background: active ? 'var(--bg-0)' : 'transparent',
              border: 'none',
              borderBottom: active ? '1px solid var(--focus)' : '1px solid transparent',
              borderRadius: 0,
              marginBottom: 0,
              padding: '7px 10px 8px',
              fontSize: 'var(--t-s)',
              color: active ? 'var(--ink)' : 'var(--ink-2)',
            }}
          >
            {dirty && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--st-needs)',
                  flexShrink: 0,
                }}
              />
            )}
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {title}
            </span>
            <span
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
              style={{ marginLeft: 'auto', color: 'var(--ink-3)', fontSize: 'var(--t-xs)' }}
            >
              ×
            </span>
          </button>
        );
      })}
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
        gridTemplateColumns: '2px 22px minmax(0, 1fr)',
        gridTemplateRows: 'auto auto',
        columnGap: 8,
        rowGap: 2,
        alignItems: 'center',
        minHeight: 52,
        padding: '8px 14px 8px 0',
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
          borderRadius: 1,
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
              right: 0,
              bottom: 0,
              width: 16,
              height: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-2)',
              borderRadius: 2,
            }}
          >
            <AgentMark name={behind.agentId} size={14} />
          </span>
        )}
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 16,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-2)',
            borderRadius: 2,
            boxShadow: stacked ? '0 0 0 1px var(--bg-0)' : undefined,
          }}
        >
          <AgentMark name={primary.agentId} size={14} />
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
            fontSize: 'var(--t-m)',
            lineHeight: 1.3,
            fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
          }}
        >
          {chatLabel(chat)}
        </div>
        {age && (
          <span
            className="mono"
            style={{
              flexShrink: 0,
              fontSize: 'var(--t-xs)',
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
        <span className="branch-clip" title={primary.branch}>
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
  onNew,
  settings,
}: {
  repo: { name: string; slug: string | null } | null;
  branch?: string | null;
  summary: string;
  view: 'list' | 'board';
  onView: (view: 'list' | 'board') => void;
  onNew: () => void;
  settings: JSX.Element | null;
}): JSX.Element {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 14px 12px 16px',
        borderBottom: '0.5px solid var(--line)',
        background: 'var(--bg-1)',
        minWidth: 0,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
            title={repo?.slug ?? undefined}
          >
            {repo ? repo.name : 'Osade'}
          </div>
          {branch ? (
            <span className="branch-tail" title={branch} style={{ marginLeft: 'auto', flexShrink: 0 }}>
              {branch}
            </span>
          ) : null}
        </div>
        <div
          style={{
            color: 'var(--ink-2)',
            fontSize: 'var(--t-xs)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {summary}
        </div>
      </div>
      <button
        type="button"
        title={view === 'board' ? 'List' : 'Kanban'}
        onClick={() => onView(view === 'board' ? 'list' : 'board')}
        style={{ flexShrink: 0, fontSize: 'var(--t-xs)' }}
      >
        {view === 'board' ? 'List' : 'Kanban'}
      </button>
      {settings ? <div style={{ flexShrink: 0 }}>{settings}</div> : null}
      <button data-new-task onClick={onNew} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
        New chat <kbd>{chord('t')}</kbd>
      </button>
    </header>
  );
}

function SidebarFoot({
  working,
  total,
  connected,
  github,
  onGithubSignedIn,
}: {
  working: number;
  total: number;
  connected: boolean;
  github: { signedIn: boolean; login: string | null };
  onGithubSignedIn: (login: string) => void;
}): JSX.Element {
  return (
    <div
      style={{
        background: 'var(--bg-1)',
        borderTop: '0.5px solid var(--line)',
        padding: '6px 0',
        position: 'relative',
      }}
    >
      <FootRow label="Agents" value={working === 0 ? 'Idle' : `${working} running`} />
      <FootRow label="Chats" value={String(total)} />
      <FootRow
        label="Daemon"
        value={connected ? 'Connected' : 'Reconnecting'}
        tone={connected ? 'var(--st-live)' : 'var(--st-fail)'}
      />
      {github.signedIn ? (
        <FootRow label="GitHub" value={github.login ?? 'Signed in'} />
      ) : (
        <details>
          <summary
            style={{
              padding: '2px 16px',
              fontSize: 'var(--t-xs)',
              cursor: 'pointer',
            }}
          >
            Sign in with GitHub
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
            }}
          >
            <GitHubSignIn status={github} onSignedIn={onGithubSignedIn} />
          </div>
        </details>
      )}
    </div>
  );
}

function FootRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '2px 16px',
        fontSize: 'var(--t-xs)',
        color: 'var(--ink-2)',
      }}
    >
      <span>{label}</span>
      <span
        className="mono"
        style={{
          color: tone ?? 'var(--ink)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginLeft: 12,
          minWidth: 0,
        }}
      >
        {value}
      </span>
    </div>
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

function NothingSelected({ hasChats }: { hasChats: boolean }): JSX.Element {
  return (
    <div style={{ padding: '48px 28px', color: 'var(--ink-2)', maxWidth: 420 }}>
      <p style={{ margin: 0, lineHeight: 1.5, fontSize: 'var(--t-m)' }}>
        {hasChats
          ? 'Pick a chat to see what it has done, and what it needs from you.'
          : 'Nothing to show yet.'}
      </p>
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
