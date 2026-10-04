import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';

import type { VerifyRun } from '@osade/contract';

import { agentColor } from './agent-color.js';
import { api } from './api.js';
import { attachCheckoutHint, isolatedWorktreeHint } from './branch-copy.js';
import { BranchControl } from './BranchControl.js';
import { Changes } from './Changes.js';
import { Composer } from './Composer.js';
import { prependAttach, type ComposerAttach } from './compose-attach.js';
import type { ComposerPhoto } from './compose-photos.js';
import { Conventions } from './Conventions.js';
import { lanePhase, type PendingLane } from './delivery.js';
import { Files } from './Files.js';
import { GateCard } from './GateCard.js';
import { LaneTerminal } from './LaneTerminal.js';
import { QuickNotes } from './QuickNotesPanel.js';
import {
  nextOpenedTerminal,
  retainLaneTerminal,
  terminalSurfaceVisible,
} from './lane-terminal.js';
import type { ChatGroup } from './lanes.js';
import type { CatalogAgent } from './RepoSettings.js';
import { GLYPH, STATUS, TONE_COLOUR, ago } from './status.js';
import type { ContextRepo } from './repo-context.js';
import { Transcript } from './Transcript.js';
import { VerifyPlanReview } from './VerifyPlanReview.js';

export type Lane = 'transcript' | 'files' | 'checks' | 'diff' | 'rules' | 'notes';
/** A view in the right-hand panel; the chat itself always holds the centre. */
export type PanelLane = Exclude<Lane, 'transcript'>;

/**
 * Issue #19 — the file a quick note is about.
 *
 * `file` is repository-relative. It is not an absolute path and not a worktree path, because
 * the Files lane hands out paths relative to the task's cwd and the whole point of filing a
 * note against a file is being able to read it back from a *different* worktree later.
 */
export interface FileContext {
  file: string | null;
  line: number | null;
}

export const PANES: { id: PanelLane; label: string; chord: string }[] = [
  { id: 'files', label: 'Files', chord: '2' },
  { id: 'checks', label: 'Checks', chord: '3' },
  { id: 'diff', label: 'Changes', chord: '4' },
  { id: 'rules', label: 'Rules', chord: '5' },
  { id: 'notes', label: 'Notes', chord: '6' },
];

export function Detail({
  chat,
  focusId,
  onFocus,
  panel,
  onPanel,
  panelHost,
  catalog,
  optimistic,
  isolatedNotice,
  pending = [],
  onSend,
  onNewIsolatedChat,
  onMoveToBranch,
  onOpenPrLane,
contextRepos = [],
  onAddContextRepo,
  onRemoveContextRepo,
  onCaptureNote,
  notesVersion,
  onFileContextChange,
}: {
  chat: ChatGroup;
  focusId: string;
  onFocus: (taskId: string) => void;
  panel: PanelLane;
  onPanel: (panel: PanelLane) => void;
  /** The right-hand panel's element; this chat's Files, Changes, Checks, Rules and Notes go there. */
  panelHost: HTMLElement | null;
  catalog: CatalogAgent[];
  optimistic?: string;
  isolatedNotice?: string;
  pending?: PendingLane[];
  onSend: (text: string, photos?: ComposerPhoto[]) => Promise<void>;
  onNewIsolatedChat: (opts: { checkoutRef?: string; baseRef?: string }) => void;
  onMoveToBranch: (checkoutRef: string) => void;
  onOpenPrLane: () => void;
contextRepos?: ContextRepo[];
  onAddContextRepo?: () => void;
  onRemoveContextRepo?: (repoId: string) => void;
  /** Issue #19 — open the quick-capture popover. */
  onCaptureNote: () => void;
  /** Issue #19 — bumped after a quick-capture save, so this lane refetches. */
  notesVersion: number;
  /** Issue #19 — hand the open file up so the capture popover can stamp a note with it. */
  onFileContextChange: (open: FileContext | null) => void;
}): JSX.Element {
  const [filter, setFilter] = useState<string | null>(null);
  const [chatSurface, setChatSurface] = useState<'chat' | 'terminal'>('chat');
  /**
   * What the centre shows instead of the conversation, like an editor tab in Orca: the file
   * opened from the Files tree, or the diff picked in Changes. Null is the conversation.
   */
  const [viewer, setViewer] = useState<'file' | 'diff' | null>(null);
  const [fileHost, setFileHost] = useState<HTMLDivElement | null>(null);
  const [diffHost, setDiffHost] = useState<HTMLDivElement | null>(null);
  /** Which of the two has something to show, so the centre switch only offers real views. */
  const [opened, setOpened] = useState<{ file: boolean; diff: boolean }>({ file: false, diff: false });
  /**
   * Files and Changes stay mounted once visited, because their viewer lives in the centre: leaving
   * the panel view must not close the file you are reading.
   */
  const [seen, setSeen] = useState<{ files: boolean; diff: boolean }>({ files: false, diff: false });
  const [openedTerminal, setOpenedTerminal] = useState<string | null>(null);
  const [laneAttach, setLaneAttach] = useState<ComposerAttach | null>(null);
  const [attachDismissed, setAttachDismissed] = useState(false);
  const [branchOfferDismissed, setBranchOfferDismissed] = useState(false);
  /** Issue #19 — a note's file and line, to open in the Files lane when the note is clicked. */
  const [noteTarget, setNoteTarget] = useState<{ file: string; line: number | null; n: number } | null>(
    null,
  );
  /**
   * Issue #19 — what this chat's Files lane is reading, handed up to the quick-capture popover.
   *
   * Held here rather than in a module-level event because this component knows the two things
   * that make the answer true: which lane is focused, and which task it belongs to. A note is
   * only about a file if that file was on screen when the note was written, and `Files`
   * unmounting on `{panel === 'files' && …}` is exactly the moment that stops being true.
   */
  const [fileContext, setFileContext] = useState<FileContext | null>(null);
  // Files stays mounted while its viewer is hidden, so what it reports only counts while the file
  // is actually in the centre. The last report is kept to restore when it comes back.
  const lastFile = useRef<FileContext | null>(null);
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  const reportFile = useCallback((open: FileContext | null) => {
    lastFile.current = open;
    setFileContext(viewerRef.current === 'file' ? open : null);
  }, []);
  useEffect(() => {
    setFileContext(viewer === 'file' ? lastFile.current : null);
  }, [viewer]);
  const focused = chat.lanes.find((t) => t.task.id === focusId) ?? chat.lanes[0]!;
  if (panel === 'files' && !seen.files) setSeen({ ...seen, files: true });
  if (panel === 'diff' && !seen.diff) setSeen({ ...seen, diff: true });

  // Another lane is another working tree: its files and diffs start closed.
  useEffect(() => {
    setViewer(null);
    setOpened({ file: false, diff: false });
    setSeen({ files: false, diff: false });
  }, [focused.task.id]);

  function showFile(): void {
    setOpened((current) => ({ ...current, file: true }));
    setViewer('file');
  }

  function showDiff(): void {
    setOpened((current) => ({ ...current, diff: true }));
    setViewer('diff');
  }

  /** Back to the conversation or its terminal; the open file's context leaves the composer. */
  function showSurface(surface: 'chat' | 'terminal'): void {
    setViewer(null);
    setChatSurface(surface);
    setLaneAttach(null);
  }

  // A note must never inherit a file from a lane the reader is not looking at. Two ways that
  // happens in this app, both handled here: switching tabs away from Files unmounts the lane
  // (which clears it through the Files teardown above), and switching *lanes* moves the answer
  // to a different task's working tree entirely.
  useEffect(() => {
    setFileContext(null);
  }, [focused.task.id]);

  useEffect(() => {
    onFileContextChange(fileContext);
  }, [fileContext, onFileContextChange]);
  const rememberedTerminal = nextOpenedTerminal(openedTerminal, focused.task.id, chatSurface);
  if (rememberedTerminal !== openedTerminal) setOpenedTerminal(rememberedTerminal);
  const terminalVisible = viewer == null && terminalSurfaceVisible('transcript', chatSurface);
  const keepTerminal = retainLaneTerminal(rememberedTerminal, focused.task.id);
  const openGates = chat.lanes.flatMap((t) =>
    t.openGates.filter((g) => g.decided_at == null).map((gate) => ({ gate, task: t })),
  );
  const failingChecks = focused.latestVerifyRuns.filter(
    (run) => run.finished_at != null && run.exit_code !== 0,
  ).length;
  const showBranchOffer =
    focused.attachment === 'repo' && focused.status === 'implementing' && !branchOfferDismissed;
  const prBranch = chat.lanes.map((l) => l.scm?.pr_head_ref).find((ref) => ref && ref.length > 0);
  const hasLaneOnPr =
    prBranch != null &&
    chat.lanes.some(
      (l) => l.task.archived_at == null && (l.branch === prBranch || l.task.checkout_ref === prBranch),
    );
  const showPrLaneOffer =
    chat.status === 'review_changes_requested' && prBranch != null && !hasLaneOnPr;

  useEffect(() => {
    setAttachDismissed(false);
    setLaneAttach(null);
  }, [panel, focused.task.id]);

  const gates =
    openGates.length > 0 ? (
      <section className="gate-stack">
        {openGates.map(({ gate, task }) => (
          <div key={gate.id}>
            <p className="mono" style={{ margin: '0 0 6px', fontSize: 'var(--t-xs)', color: agentColor(task.agentId) }}>
              {task.agentId} · {task.task.branch}
            </p>
            <GateCard gate={gate} task={task} onDecided={() => {}} />
          </div>
        ))}
      </section>
    ) : null;

  async function handleSend(text: string, photos: ComposerPhoto[] = []): Promise<void> {
    const match = text.match(/^\/branch(?:\s+(.*))?$/iu);
    if (match) {
      const name = match[1]?.trim();
      await api.taskBranchOut({
        taskId: focused.task.id,
        branch: name || undefined,
        carryChanges: true,
      });
      return;
    }
    const payload = attachDismissed ? text : prependAttach(text, laneAttach);
    await onSend(payload, photos);
  }

  return (
    <div className="workspace" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {chat.lanes.length > 1 && (
        <div className="lane-strip-row">
          <LaneStrip chat={chat} focusId={focused.task.id} onFocus={onFocus} pending={pending} />
        </div>
      )}

      {/* Approvals live in the side panel; with the panel hidden they come back here. */}
      {panelHost == null && gates}

      {showPrLaneOffer && prBranch && (
        <section
          style={{
            padding: '10px 16px',
            borderBottom: '0.5px solid var(--line)',
            background: 'var(--bg-1)',
            fontSize: 'var(--t-s)',
          }}
        >
          <p style={{ margin: '0 0 8px' }}>
            A reviewer asked for changes on <span className="mono">{prBranch}</span>. Open a lane
            on that branch — not a fork.
          </p>
          <button className="primary" onClick={onOpenPrLane}>
            Open a lane on {prBranch}
          </button>
        </section>
      )}

      {showBranchOffer && (
        <section
          style={{
            padding: '10px 16px',
            borderBottom: '0.5px solid var(--line)',
            background: 'var(--bg-1)',
            fontSize: 'var(--t-s)',
          }}
        >
          <p style={{ margin: '0 0 8px' }}>
            This chat is on your real checkout. Move it to a worktree before the agent writes, or
            it will edit files in place.
          </p>
          <button
            className="primary"
            onClick={() => {
              void api
                .taskBranchOut({ taskId: focused.task.id, carryChanges: true })
                .then(() => setBranchOfferDismissed(true))
                .catch(() => setBranchOfferDismissed(true));
            }}
          >
            Use a worktree
          </button>
          <button onClick={() => setBranchOfferDismissed(true)} style={{ marginLeft: 8 }}>
            Keep working here
          </button>
        </section>
      )}

      <div className="center-switch">
        <FilterChip
          label="Chat"
          active={viewer == null && chatSurface === 'chat'}
          onClick={() => showSurface('chat')}
        />
        <FilterChip
          label="Terminal"
          active={viewer == null && chatSurface === 'terminal'}
          onClick={() => showSurface('terminal')}
        />
        {opened.file && <FilterChip label="File" active={viewer === 'file'} onClick={showFile} />}
        {opened.diff && <FilterChip label="Diff" active={viewer === 'diff'} onClick={showDiff} />}
        <span style={{ marginLeft: 'auto' }}>
          <BranchControl
            task={focused}
            focusTaskId={focusId}
            onNewIsolatedChat={onNewIsolatedChat}
            onMoveToBranch={onMoveToBranch}
          />
        </span>
      </div>

      <div ref={setFileHost} className="center-viewer" style={{ display: viewer === 'file' ? 'flex' : 'none' }} />
      <div ref={setDiffHost} className="center-viewer" style={{ display: viewer === 'diff' ? 'flex' : 'none' }} />

      <div
        data-chat-scroll={viewer == null && chatSurface === 'chat' ? '' : undefined}
        style={{
          flex: 1,
          minHeight: 0,
          display: viewer == null ? 'flex' : 'none',
          flexDirection: 'column',
          overflow: terminalVisible ? 'hidden' : 'auto',
          padding: terminalVisible ? 0 : '24px 28px 40px',
        }}
      >
        {chatSurface === 'chat' && (
          <>
            {chat.lanes.length > 1 && (
              <div className="reading-tools">
                <FilterChip label="All" active={filter == null} onClick={() => setFilter(null)} />
                {chat.lanes.map((task) => (
                  <FilterChip
                    key={task.task.id}
                    label={task.agentId}
                    color={agentColor(task.agentId)}
                    active={filter === task.agentId}
                    onClick={() => setFilter(task.agentId)}
                  />
                ))}
              </div>
            )}
            {contextRepos.length > 0 && (
              <div
                style={{
                  marginBottom: 12,
                  padding: '8px 10px',
                  background: 'var(--bg-2)',
                  border: '0.5px solid var(--line)',
                  borderRadius: 8,
                  fontSize: 'var(--t-xs)',
                  color: 'var(--ink-2)',
                }}
              >
                <p style={{ margin: '0 0 6px', color: 'var(--ink)' }}>
                  Read-only context repos (agents edit only the primary worktree):
                </p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {contextRepos.map((repo) => (
                    <li key={repo.repoId} style={{ marginBottom: 4 }}>
                      <span className="mono">{repo.name}</span>
                      {onRemoveContextRepo && (
                        <button
                          type="button"
                          onClick={() => onRemoveContextRepo(repo.repoId)}
                          style={{ marginLeft: 8, fontSize: 'var(--t-xs)' }}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Transcript
              tasks={filter ? chat.lanes.filter((t) => t.agentId === filter) : chat.lanes}
              extraUser={optimistic}
              followTaskId={focused.task.id}
              isolatedNotice={isolatedNotice}
              pending={pending}
              onOpenDiff={(taskId) => {
                onFocus(taskId);
                onPanel('diff');
                showDiff();
              }}
            />
          </>
        )}
        {keepTerminal && (
          <div
            style={{
              display: terminalVisible ? 'flex' : 'none',
              flex: 1,
              minHeight: 0,
              flexDirection: 'column',
            }}
          >
            <LaneTerminal taskId={focused.task.id} visible={terminalVisible} />
          </div>
        )}
      </div>

      {!terminalVisible && (
      <>
        {onAddContextRepo && (
          <div className="context-note">
            <span>Agents edit only this chat&apos;s primary worktree.</span>
            <button type="button" onClick={onAddContextRepo}>
              Add read-only context repo
            </button>
          </div>
        )}
      <Composer
        key={chat.chatId}
        autoFocus
        catalog={catalog}
        attach={!attachDismissed ? laneAttach : null}
        onDismissAttach={() => setAttachDismissed(true)}
        held={
          focused.status === 'implementing' ||
          focused.status === 'verifying' ||
          focused.status === 'queued'
        }
        placeholder="Message. Enter to send, Shift+Enter for a new line. @name to pick a lane."
        onSend={handleSend}
      />
      </>
      )}

      {panelHost &&
        createPortal(
          <>
            <PanelTabs panel={panel} onPanel={onPanel} counts={{ checks: failingChecks }} />
            {gates}
            <div
              className="right-panel-body"
              style={{
                overflow: panel === 'files' || panel === 'diff' ? 'hidden' : 'auto',
                padding: panel === 'files' || panel === 'diff' ? 0 : 16,
              }}
            >
              {seen.files && (
                <div className="right-panel-pane" style={{ display: panel === 'files' ? 'flex' : 'none' }}>
                  <Files
                    key={focused.task.id}
                    task={focused}
                    onAttach={viewer === 'file' ? setLaneAttach : undefined}
                    openPath={noteTarget}
                    onOpenChange={reportFile}
                    notesRevision={notesVersion}
                    viewerHost={fileHost}
                    onShow={showFile}
                  />
                </div>
              )}
              {panel === 'checks' && (
                <>
                  <VerifyPlanReview
                    taskId={focused.task.id}
                    runs={focused.latestVerifyRuns}
                    onAttach={setLaneAttach}
                  />
                  <VerifyRuns runs={focused.latestVerifyRuns} />
                </>
              )}
              {seen.diff && (
                <div className="right-panel-pane" style={{ display: panel === 'diff' ? 'flex' : 'none' }}>
                  <Changes
                    key={focused.task.id}
                    task={focused}
                    lanes={chat.lanes}
                    onAttach={viewer === 'diff' ? setLaneAttach : undefined}
                    viewerHost={diffHost}
                    onShow={showDiff}
                  />
                </div>
              )}
              {panel === 'rules' && (
                <Conventions repoId={focused.task.repo_id} onAttach={setLaneAttach} />
              )}
              {panel === 'notes' && (
                <QuickNotes
                  repoId={focused.task.repo_id}
                  refreshKey={notesVersion}
                  onCapture={onCaptureNote}
                  onOpenFile={(file, line) => {
                    // `n` is a counter, not a flag: clicking the same note twice has to open it
                    // twice, and a file path alone would look unchanged the second time.
                    setNoteTarget({ file, line, n: (noteTarget?.n ?? 0) + 1 });
                    onPanel('files');
                  }}
                />
              )}
            </div>
          </>,
          panelHost,
        )}
    </div>
  );
}

/** The right panel's icon row: Files, Checks, Changes, Rules, Notes. */
export function PanelTabs({
  panel,
  onPanel,
  counts = {},
  disabled = false,
}: {
  panel: PanelLane;
  onPanel: (panel: PanelLane) => void;
  counts?: Partial<Record<PanelLane, number>>;
  disabled?: boolean;
}): JSX.Element {
  return (
    <nav className="panel-tabs" role="tablist" aria-label="Session views">
      {PANES.map((item) => {
        const count = counts[item.id] ?? 0;
        return (
          <button
            key={item.id}
            type="button"
            data-lane={item.id}
            role="tab"
            aria-selected={!disabled && panel === item.id}
            aria-label={item.label}
            title={`${item.label} (${item.chord})`}
            className="panel-tab"
            disabled={disabled}
            onClick={() => onPanel(item.id)}
          >
            <LaneIcon id={item.id} />
            {count > 0 && <span className="lane-count">{count}</span>}
          </button>
        );
      })}
    </nav>
  );
}

function LaneStrip({
  chat,
  focusId,
  onFocus,
  pending,
}: {
  chat: ChatGroup;
  focusId: string;
  onFocus: (id: string) => void;
  pending: PendingLane[];
}): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
      {chat.lanes.map((task) => {
        const copy = STATUS[task.status];
        const selected = task.task.id === focusId;
        const colour = agentColor(task.agentId);
        const phase = lanePhase(
          task,
          pending.find((p) => p.agentId === task.agentId),
        );
        return (
          <button
            key={task.task.id}
            onClick={() => onFocus(task.task.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 8px',
              border: '0.5px solid',
              borderColor: selected ? colour : 'var(--line)',
              background: selected ? 'var(--bg-2)' : 'var(--bg-1)',
              color: colour,
              fontSize: 'var(--t-xs)',
            }}
          >
            <span style={{ color: TONE_COLOUR[copy.tone] }}>{GLYPH[copy.tone]}</span>
            <span>{task.agentId}</span>
            {phase ? (
              <span className="mono" style={{ color: phase === 'failed' ? 'var(--st-fail)' : 'var(--ink-3)' }}>
                {phase}
              </span>
            ) : (
              <span className="mono" style={{ color: 'var(--ink-3)' }}>
                {task.task.branch}
              </span>
            )}
          </button>
        );
      })}
      {pending.map((p) => (
        <button
          key={`pending-${p.agentId}`}
          type="button"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 8px',
            border: '0.5px solid var(--line)',
            background: 'var(--bg-1)',
            color: agentColor(p.agentId),
            fontSize: 'var(--t-xs)',
          }}
        >
          <span>{p.agentId}</span>
          <span className="mono" style={{ color: p.phase === 'failed' ? 'var(--st-fail)' : 'var(--ink-3)' }}>
            {p.phase}
          </span>
        </button>
      ))}
    </div>
  );
}

function FilterChip({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color?: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={active}
      onClick={onClick}
      style={{ borderColor: active && color ? color : undefined, color: color ?? undefined }}
    >
      {label}
    </button>
  );
}

function LaneIcon({ id }: { id: Lane }): JSX.Element {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    'aria-hidden': true as const,
  };
  if (id === 'files') {
    return (
      <svg {...common}>
        <path d="M3 2.5h6l4 4V13.5H3z" />
        <path d="M9 2.5V6.5h4" />
      </svg>
    );
  }
  if (id === 'checks') {
    return (
      <svg {...common}>
        <path d="M3 8.5 6.2 12 13 4.5" />
      </svg>
    );
  }
  if (id === 'diff') {
    return (
      <svg {...common}>
        <circle cx="4.5" cy="3.5" r="1.5" />
        <circle cx="4.5" cy="12.5" r="1.5" />
        <circle cx="11.5" cy="5.5" r="1.5" />
        <path d="M4.5 5v6M11.5 7c0 2.5-2 3-7 4" />
      </svg>
    );
  }
  if (id === 'rules') {
    return (
      <svg {...common}>
        <path d="M3.5 4h9M3.5 8h9M3.5 12h6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M3 4.5h10M3 8h7M3 11.5h5" />
    </svg>
  );
}

export function DraftPane({
  optimistic,
  submitting,
  catalog,
  pending = [],
  agentId = null,
  onSend,
}: {
  optimistic?: string;
  submitting: boolean;
  catalog: CatalogAgent[];
  pending?: PendingLane[];
  agentId?: string | null;
  onSend: (text: string, photos?: ComposerPhoto[]) => Promise<void>;
}): JSX.Element {
  return (
    <div className="workspace" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <header className="workspace-head">
        <h1 className="workspace-title">New chat</h1>
        {agentId && (
          <div className="mono" style={{ marginTop: 6, fontSize: 'var(--t-s)', color: agentColor(agentId) }}>
            {agentId}
          </div>
        )}
        <p style={{ margin: '6px 0 0', color: 'var(--ink-2)', fontSize: 'var(--t-s)' }}>
          {attachCheckoutHint()} {isolatedWorktreeHint()} Use @claude, @codex, @opencode, or @pi inline or on
          their own line.
        </p>
      </header>
      <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }} data-chat-scroll="">
        <Transcript tasks={[]} extraUser={optimistic} pending={pending} />
      </div>
      <Composer
        autoFocus
        disabled={submitting}
        catalog={catalog}
        placeholder="What are we working on?"
        onSend={onSend}
      />
    </div>
  );
}

function VerifyRuns({ runs }: { runs: VerifyRun[] }): JSX.Element | null {
  if (runs.length === 0) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 'var(--t-s)', fontWeight: 600 }}>Latest runs</h2>
      {runs.map((run) => (
        <div
          key={run.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 8,
            padding: '6px 0',
            borderBottom: '0.5px solid var(--line)',
            fontSize: 'var(--t-s)',
          }}
        >
          <code className="mono" style={{ fontSize: 'var(--t-xs)' }}>
            {run.cmd}
          </code>
          <span className="mono" style={{ color: 'var(--ink-2)', fontSize: 'var(--t-xs)' }}>
            {run.exit_code == null
              ? 'Running'
              : run.exit_code === 0
                ? 'Passed'
                : `Exit ${run.exit_code}`}
            {run.finished_at ? ` · ${ago(run.finished_at)}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
