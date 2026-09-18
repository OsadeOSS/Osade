import { useEffect, useState, type JSX } from 'react';

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
import { lanePhase, startingLine, type PendingLane } from './delivery.js';
import { Files } from './Files.js';
import { GateCard } from './GateCard.js';
import { LaneTerminal } from './LaneTerminal.js';
import {
  nextOpenedTerminal,
  retainLaneTerminal,
  terminalSurfaceVisible,
} from './lane-terminal.js';
import { chatLabel, type ChatGroup } from './lanes.js';
import type { CatalogAgent } from './RepoSettings.js';
import { GLYPH, STATUS, TONE_COLOUR, ago, statusCopyFor } from './status.js';
import { Transcript } from './Transcript.js';
import { VerifyPlanReview } from './VerifyPlanReview.js';

export type Lane = 'transcript' | 'files' | 'checks' | 'diff' | 'rules';

const PANES: { id: Lane; label: string; chord: string }[] = [
  { id: 'transcript', label: 'Chat', chord: '1' },
  { id: 'files', label: 'Files', chord: '2' },
  { id: 'checks', label: 'Checks', chord: '3' },
  { id: 'diff', label: 'Diff', chord: '4' },
  { id: 'rules', label: 'Rules', chord: '5' },
];

export function Detail({
  chat,
  focusId,
  onFocus,
  lane,
  onLane,
  catalog,
  optimistic,
  isolatedNotice,
  pending = [],
  onSend,
  onNewIsolatedChat,
  onMoveToBranch,
  onOpenPrLane,
}: {
  chat: ChatGroup;
  focusId: string;
  onFocus: (taskId: string) => void;
  lane: Lane;
  onLane: (lane: Lane) => void;
  catalog: CatalogAgent[];
  optimistic?: string;
  isolatedNotice?: string;
  pending?: PendingLane[];
  onSend: (text: string, photos?: ComposerPhoto[]) => Promise<void>;
  onNewIsolatedChat: (opts: { checkoutRef?: string; baseRef?: string }) => void;
  onMoveToBranch: (checkoutRef: string) => void;
  onOpenPrLane: () => void;
}): JSX.Element {
  const [filter, setFilter] = useState<string | null>(null);
  const [chatSurface, setChatSurface] = useState<'chat' | 'terminal'>('chat');
  const [openedTerminal, setOpenedTerminal] = useState<string | null>(null);
  const [laneAttach, setLaneAttach] = useState<ComposerAttach | null>(null);
  const [attachDismissed, setAttachDismissed] = useState(false);
  const [modHeld, setModHeld] = useState(false);
  const [branchOfferDismissed, setBranchOfferDismissed] = useState(false);
  const focused = chat.lanes.find((t) => t.task.id === focusId) ?? chat.lanes[0]!;
  const rememberedTerminal = nextOpenedTerminal(openedTerminal, focused.task.id, chatSurface);
  if (rememberedTerminal !== openedTerminal) setOpenedTerminal(rememberedTerminal);
  const terminalVisible = terminalSurfaceVisible(lane, chatSurface);
  const keepTerminal = retainLaneTerminal(rememberedTerminal, focused.task.id);
  const copy = statusCopyFor(chat.status, focused.agent?.external_block);
  const colour = TONE_COLOUR[copy.tone];
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
    function onKey(event: KeyboardEvent): void {
      setModHeld(event.metaKey || event.ctrlKey);
    }
    function onUp(event: KeyboardEvent): void {
      if (!event.metaKey && !event.ctrlKey) setModHeld(false);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', () => setModHeld(false));
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  useEffect(() => {
    setAttachDismissed(false);
    setLaneAttach(null);
  }, [lane, focused.task.id]);

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
    const payload =
      lane === 'transcript' || attachDismissed ? text : prependAttach(text, laneAttach);
    await onSend(payload, photos);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-0)',
      }}
    >
      <header style={{ padding: '14px 16px 12px', borderBottom: '0.5px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <h1
            style={{
              fontSize: 'var(--t-l)',
              fontWeight: 600,
              lineHeight: 1.3,
              margin: 0,
              flex: 1,
              minWidth: 0,
            }}
          >
            {chatLabel(chat)}
          </h1>
          <span
            style={{
              flexShrink: 0,
              fontSize: 'var(--t-xs)',
              color: colour,
              border: '0.5px solid var(--line)',
              background: 'var(--bg-2)',
              borderRadius: 'var(--radius)',
              padding: '2px 8px',
            }}
          >
            {copy.label}
          </span>
          <BranchControl
            task={focused}
            onNewIsolatedChat={onNewIsolatedChat}
            onMoveToBranch={onMoveToBranch}
          />
        </div>
        <LaneStrip chat={chat} focusId={focused.task.id} onFocus={onFocus} pending={pending} />
      </header>

      {openGates.length > 0 ? (
        <section
          style={{
            background: 'var(--bg-1)',
            borderBottom: '0.5px solid var(--line)',
            borderLeft: '2px solid var(--st-needs)',
            padding: '12px 16px',
          }}
        >
          {openGates.map(({ gate, task }) => (
            <div key={gate.id}>
              <p className="mono" style={{ margin: '0 0 6px', fontSize: 'var(--t-xs)', color: agentColor(task.agentId) }}>
                {task.agentId} · {task.task.branch}
              </p>
              <GateCard gate={gate} task={task} onDecided={() => {}} />
            </div>
          ))}
        </section>
      ) : (
        copy.next && (
          <section
            style={{
              padding: '10px 16px',
              borderBottom: '0.5px solid var(--line)',
              color: 'var(--ink-2)',
              fontSize: 'var(--t-s)',
            }}
          >
            {copy.next}
            {chat.status === 'blocked_external' && focused.agent?.external_block
              ? ` ${focused.agent.external_block}`
              : ''}
          </section>
        )
      )}

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

      <nav
        style={{
          display: 'flex',
          gap: 2,
          padding: '8px 12px 0',
          borderBottom: '0.5px solid var(--line)',
        }}
      >
        {PANES.map((item) => {
          const selected = lane === item.id;
          const count =
            item.id === 'transcript'
              ? openGates.length
              : item.id === 'checks'
                ? failingChecks
                : 0;
          return (
            <button
              key={item.id}
              data-lane={item.id}
              onClick={() => onLane(item.id)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: selected ? '1px solid var(--focus)' : '1px solid transparent',
                borderRadius: 0,
                marginBottom: -1,
                color: selected ? 'var(--ink)' : 'var(--ink-2)',
                padding: '6px 10px 8px',
              }}
            >
              {item.label}
              {count > 0 ? (
                <span style={{ marginLeft: 6, color: 'var(--st-fail)', fontSize: 'var(--t-xs)' }}>
                  {count}
                </span>
              ) : (
                modHeld && (
                  <kbd style={{ marginLeft: 6, border: 'none', padding: 0, color: 'var(--ink-3)' }}>
                    ⌘{item.chord}
                  </kbd>
                )
              )}
            </button>
          );
        })}
      </nav>

      <div
        data-chat-scroll={lane === 'transcript' && chatSurface === 'chat' ? '' : undefined}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: lane === 'files' || lane === 'diff' || terminalVisible ? 'hidden' : 'auto',
          padding: lane === 'files' || lane === 'diff' || terminalVisible ? 0 : '14px 16px',
        }}
      >
        {lane === 'transcript' && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              flexShrink: 0,
              padding: terminalVisible ? '8px 12px 0' : 0,
              marginBottom: 12,
            }}
          >
            <FilterChip label="Chat" active={chatSurface === 'chat'} onClick={() => setChatSurface('chat')} />
            <FilterChip
              label="Terminal"
              active={chatSurface === 'terminal'}
              onClick={() => setChatSurface('terminal')}
            />
          </div>
        )}
        {lane === 'transcript' && chatSurface === 'chat' && (
          <>
            {chat.lanes.length > 1 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
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
            {pending.map((p) => (
              <div key={`pending-${p.agentId}`} style={{ marginBottom: 12 }}>
                <div className="mono" style={{ fontSize: 'var(--t-xs)', color: agentColor(p.agentId) }}>
                  {p.agentId}
                </div>
                <p style={{ margin: '4px 0', fontSize: 'var(--t-s)' }}>{p.prompt}</p>
                <p
                  style={{
                    margin: 0,
                    fontSize: 'var(--t-s)',
                    color: p.phase === 'failed' ? 'var(--st-fail)' : 'var(--ink-2)',
                  }}
                >
                  {p.phase === 'failed' ? (p.error ?? 'failed') : startingLine(p.agentId)}
                </p>
              </div>
            ))}
            <Transcript
              tasks={filter ? chat.lanes.filter((t) => t.agentId === filter) : chat.lanes}
              extraUser={optimistic}
              followTaskId={focused.task.id}
              isolatedNotice={isolatedNotice}
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
        {lane === 'files' && (
          <Files key={focused.task.id} task={focused} onAttach={setLaneAttach} />
        )}
        {lane === 'checks' && (
          <>
            <VerifyPlanReview
              taskId={focused.task.id}
              runs={focused.latestVerifyRuns}
              onAttach={setLaneAttach}
            />
            <VerifyRuns runs={focused.latestVerifyRuns} />
          </>
        )}
        {lane === 'diff' && (
          <Changes key={focused.task.id} task={focused} lanes={chat.lanes} onAttach={setLaneAttach} />
        )}
        {lane === 'rules' && (
          <Conventions repoId={focused.task.repo_id} onAttach={setLaneAttach} />
        )}
      </div>

      {!terminalVisible && (
      <Composer
        key={chat.chatId}
        autoFocus={lane === 'transcript'}
        catalog={catalog}
        attach={!attachDismissed && lane !== 'transcript' ? laneAttach : null}
        onDismissAttach={() => setAttachDismissed(true)}
        held={
          focused.status === 'implementing' ||
          focused.status === 'verifying' ||
          focused.status === 'queued'
        }
        placeholder="Message. Enter to send, Shift+Enter for a new line. @name to pick a lane."
        onSend={handleSend}
      />
      )}
    </div>
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
      onClick={onClick}
      style={{
        padding: '2px 8px',
        fontSize: 'var(--t-xs)',
        border: '0.5px solid',
        borderColor: active ? (color ?? 'var(--line)') : 'var(--line)',
        color: color ?? 'var(--ink-2)',
        background: active ? 'var(--bg-2)' : 'transparent',
      }}
    >
      {label}
    </button>
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-0)',
      }}
    >
      <header style={{ padding: '14px 16px 12px', borderBottom: '0.5px solid var(--line)' }}>
        <h1 style={{ fontSize: 'var(--t-l)', fontWeight: 600, margin: 0 }}>New chat</h1>
        {agentId && (
          <div
            className="mono"
            style={{ marginTop: 6, fontSize: 'var(--t-s)', color: agentColor(agentId) }}
          >
            {agentId}
          </div>
        )}
        <p style={{ margin: '6px 0 0', color: 'var(--ink-2)', fontSize: 'var(--t-s)' }}>
          {attachCheckoutHint()} {isolatedWorktreeHint()} @mention an agent on its own line to
          pick a lane.
        </p>
      </header>
      <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>
        {pending.map((p) => (
          <div key={`pending-${p.agentId}`} style={{ marginBottom: 12 }}>
            <div className="mono" style={{ fontSize: 'var(--t-xs)', color: agentColor(p.agentId) }}>
              {p.agentId}
            </div>
            <p style={{ margin: '4px 0', fontSize: 'var(--t-s)' }}>{p.prompt}</p>
            <p
              style={{
                margin: 0,
                fontSize: 'var(--t-s)',
                color: p.phase === 'failed' ? 'var(--st-fail)' : 'var(--ink-2)',
              }}
            >
              {p.phase === 'failed' ? (p.error ?? 'failed') : startingLine(p.agentId)}
            </p>
          </div>
        ))}
        <Transcript tasks={[]} extraUser={optimistic} />
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
