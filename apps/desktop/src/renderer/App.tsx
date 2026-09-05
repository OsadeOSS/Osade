import { useState, type JSX } from 'react';

import type { TaskStatus, TaskView } from '@osade/contract';

import { GateCard } from './GateCard.js';
import { useLedger } from './useLedger.js';
import { VerifyPlanReview } from './VerifyPlanReview.js';

/**
 * The ledger — OSADE.md §19.
 *
 * A record of machine work on a public commons, not a generic dark SaaS board. Ruled rows in a
 * fixed grid, a status gutter on the left like porcelain output, evidence inline.
 *
 * §18.1 — App.tsx is a composition root only.
 */

/** §19.3 — fixed-width, fixed-position glyphs, so the gutter scans peripherally. */
const GLYPH: Record<TaskStatus, string> = {
  awaiting_approval: '⚑',
  needs_input: '⚑',
  review_changes_requested: '⚑',
  awaiting_review: '⚑',
  implementing: '●',
  verifying: '●',
  verify_failed: '✗',
  ci_failed: '✗',
  pr_open: '○',
  queued: '○',
  idle: '○',
  stopped: '○',
  merged: '✓',
  archived: '✓',
};

function toneFor(status: TaskStatus): string {
  if (status === 'verify_failed' || status === 'ci_failed') return 'var(--st-fail)';
  if (status === 'implementing' || status === 'verifying') return 'var(--st-live)';
  if (
    status === 'awaiting_approval' ||
    status === 'needs_input' ||
    status === 'review_changes_requested' ||
    status === 'awaiting_review'
  ) {
    return 'var(--st-needs)';
  }
  return 'var(--st-rest)';
}

/** §19.4 — active voice, sentence case, an action keeps its name through the whole flow. */
const LABEL: Record<TaskStatus, string> = {
  awaiting_approval: 'needs approval',
  needs_input: 'needs you',
  review_changes_requested: 'changes requested',
  awaiting_review: 'ready for review',
  implementing: 'implementing',
  verifying: 'verifying',
  verify_failed: 'verification failed',
  ci_failed: 'CI failed',
  pr_open: 'pull request open',
  queued: 'queued',
  idle: 'idle',
  stopped: 'stopped',
  merged: 'merged',
  archived: 'archived',
};

export function App(): JSX.Element {
  const { tasks, connection, error } = useLedger();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const needsYou = tasks.filter((t) => t.needsYou);
  const rest = tasks.filter((t) => !t.needsYou);
  const selected = tasks.find((t) => t.task.id === selectedId) ?? null;

  // §14.2 — gate requests are the top of the ledger, above everything else.
  const openGates = tasks.flatMap((task) =>
    task.openGates.filter((g) => g.decided_at == null).map((gate) => ({ gate, task })),
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', height: '100%' }}>
      <main style={{ overflow: 'auto', borderRight: '1px solid var(--rule)' }}>
        <Header connection={connection} error={error} count={tasks.length} />

        {openGates.length > 0 && (
          <div style={{ padding: '14px 18px 4px' }}>
            {openGates.map(({ gate, task }) => (
              <GateCard
                key={gate.id}
                gate={gate}
                task={task}
                // §5.4 — no local mutation. The decision writes to the database and comes
                // back over the websocket like every other change.
                onDecided={() => {}}
              />
            ))}
          </div>
        )}

        {tasks.length === 0 ? (
          <Empty connection={connection} />
        ) : (
          <>
            {needsYou.map((task) => (
              <Row
                key={task.task.id}
                task={task}
                selected={task.task.id === selectedId}
                onSelect={setSelectedId}
              />
            ))}
            {needsYou.length > 0 && rest.length > 0 && <Divider />}
            {rest.map((task) => (
              <Row
                key={task.task.id}
                task={task}
                selected={task.task.id === selectedId}
                onSelect={setSelectedId}
              />
            ))}
          </>
        )}
      </main>

      <Detail task={selected} />
    </div>
  );
}

function Header({
  connection,
  error,
  count,
}: {
  connection: string;
  error: string | null;
  count: number;
}): JSX.Element {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        padding: '14px 18px',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <span style={{ fontSize: 'var(--t-l)', fontWeight: 600 }}>Ledger</span>
      <span style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-xs)' }}>
        {count} {count === 1 ? 'task' : 'tasks'}
      </span>
      <span style={{ flex: 1 }} />
      <span
        className="mono"
        style={{
          fontSize: 'var(--t-xs)',
          color: connection === 'live' ? 'var(--st-live)' : 'var(--st-rest)',
        }}
      >
        {error ?? connection}
      </span>
    </header>
  );
}

function Divider(): JSX.Element {
  // §19.3 — a rule separates lanes of meaning. It never decorates.
  return (
    <div
      style={{
        borderTop: '1px solid var(--rule)',
        margin: '10px 0',
      }}
    />
  );
}

function Row({
  task,
  selected,
  onSelect,
}: {
  task: TaskView;
  selected: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <div
      onClick={() => onSelect(task.task.id)}
      style={{
        display: 'grid',
        gridTemplateColumns: '20px 150px 1fr auto',
        alignItems: 'baseline',
        gap: 12,
        padding: '9px 18px',
        borderBottom: '1px solid var(--rule)',
        background: selected ? 'var(--field)' : 'transparent',
        cursor: 'default',
      }}
    >
      <span className="mono" style={{ color: toneFor(task.status) }}>
        {GLYPH[task.status]}
      </span>
      <span style={{ color: toneFor(task.status), fontSize: 'var(--t-s)' }}>
        {LABEL[task.status]}
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {task.task.title}
      </span>
      <span
        className="mono"
        style={{
          color: 'var(--ink-soft)',
          fontSize: 'var(--t-xs)',
          maxWidth: 280,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {task.agent?.activity_text ?? ''}
      </span>
    </div>
  );
}

function Empty({ connection }: { connection: string }): JSX.Element {
  // §19.4 — empty states name the next action.
  return (
    <div style={{ padding: 28, color: 'var(--ink-soft)', maxWidth: 520 }}>
      <p style={{ marginTop: 0 }}>
        {connection === 'live'
          ? 'No tasks yet.'
          : 'Waiting for the daemon. Agents keep running while this window is closed.'}
      </p>
      <p className="mono" style={{ fontSize: 'var(--t-xs)' }}>
        osade task create &lt;repo&gt; &lt;title&gt;
      </p>
    </div>
  );
}

function Detail({ task }: { task: TaskView | null }): JSX.Element {
  if (!task) {
    return (
      <aside style={{ padding: 28, color: 'var(--ink-soft)' }}>
        <p style={{ marginTop: 0 }}>Select a row.</p>
      </aside>
    );
  }

  return (
    <aside style={{ padding: '18px 20px', overflow: 'auto' }}>
      <h1 style={{ fontSize: 'var(--t-l)', fontWeight: 600, margin: '0 0 4px' }}>
        {task.task.title}
      </h1>
      <p style={{ color: toneFor(task.status), margin: '0 0 18px' }}>{LABEL[task.status]}</p>

      <Field label="branch" value={task.task.branch} mono />
      <Field label="base" value={`${task.task.base_sha.slice(0, 12)} on ${task.task.base_ref}`} mono />
      <Field label="worktree" value={task.task.worktree_path} mono />
      <Field label="herdr" value={task.task.herdr_workspace_id ?? '—'} mono />
      <Field label="pane" value={task.agent?.herdr_pane_id ?? '—'} mono />
      <Field label="agent state" value={task.agent?.herdr_state ?? '—'} />
      <Field label="last event" value={task.agent?.last_event ?? '—'} />
      <Field label="open gates" value={String(task.openGates.length)} />

      {/* §5.2 — probe_failures surface as a degraded-confidence note and nothing else. */}
      {(task.agent?.probe_failures ?? 0) > 0 && (
        <p style={{ color: 'var(--st-rest)', fontSize: 'var(--t-xs)' }}>
          degraded confidence: {task.agent?.probe_failures} failed probes
        </p>
      )}

      <section style={{ marginTop: 18, borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
        <h2 style={{ fontSize: 'var(--t-s)', fontWeight: 600, margin: '0 0 4px' }}>Verification</h2>
        <VerifyPlanReview taskId={task.task.id} />
      </section>

      <button
        onClick={() => void window.osade?.openInHerdr()}
        style={{
          marginTop: 18,
          padding: '6px 12px',
          border: '1px solid var(--rule)',
          borderRadius: 'var(--radius)',
          background: 'var(--field)',
          color: 'var(--ink)',
          font: 'inherit',
          cursor: 'pointer',
        }}
      >
        Open in herdr
      </button>
      <p style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-xs)' }}>
        Osade does not embed the terminal (ADR 0001). This attaches a real herdr client.
      </p>
    </aside>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '4px 0', alignItems: 'baseline' }}>
      <span style={{ width: 96, color: 'var(--ink-soft)', fontSize: 'var(--t-xs)' }}>{label}</span>
      <span
        className={mono ? 'mono' : undefined}
        style={{ fontSize: 'var(--t-xs)', wordBreak: 'break-all' }}
      >
        {value}
      </span>
    </div>
  );
}
