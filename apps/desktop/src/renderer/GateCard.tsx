import { useState, type JSX } from 'react';

import type { GateRequest, TaskView } from '@osade/contract';

import { api } from './api.js';

/**
 * The gate card — OSADE.md §14.2.
 *
 * Gate requests are the top of the ledger, above everything else. A card shows: the exact
 * action, a rendered diff or the exact comment text, which task it came from, the verification
 * state, and Approve / Deny / Edit-and-approve.
 *
 * **Editing rewrites the payload and re-hashes** (§11.2), so an approval is bound to the exact
 * bytes shown here rather than to whatever is executed later.
 *
 * §14.2 — batch approval is allowed for `gate.commit` only. Never batch a public write, which
 * is why there is no select-all here.
 */

/** Public writes get a heavier treatment: this is speech in someone else's space. */
const PUBLIC_WRITES = new Set([
  'gate.pr_open',
  'gate.pr_update',
  'gate.pr_comment',
  'gate.issue_comment',
  'gate.review_submit',
]);

export function GateCard({
  gate,
  task,
  onDecided,
}: {
  gate: GateRequest;
  task: TaskView;
  onDecided: () => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => pretty(gate.payload_json));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPublic = PUBLIC_WRITES.has(gate.gate);
  // §10.2 — verification is required before gate.pr_open can be approved. Surfaced rather
  // than enforced here: the daemon owns the policy, the UI explains it.
  const verifyBlocks = gate.gate === 'gate.pr_open' && task.status === 'verify_failed';

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDecided();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      style={{
        border: '1px solid var(--rule)',
        borderLeft: `3px solid var(--st-needs)`,
        padding: '14px 16px',
        marginBottom: 12,
        background: 'var(--field)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span className="mono" style={{ color: 'var(--st-needs)' }}>
          ⚑
        </span>
        <strong>{describe(gate.gate)}</strong>
        <span style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-xs)' }}>
          {task.task.title}
        </span>
      </header>

      {isPublic && (
        <p style={{ color: 'var(--st-needs)', fontSize: 'var(--t-xs)', margin: '0 0 8px' }}>
          This leaves your machine and is published under your name.
        </p>
      )}

      {verifyBlocks && (
        <p style={{ color: 'var(--st-fail)', fontSize: 'var(--t-xs)', margin: '0 0 8px' }}>
          Verification is failing for this task.
        </p>
      )}

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          rows={10}
          className="mono"
          style={{
            width: '100%',
            fontSize: 'var(--t-xs)',
            padding: 8,
            border: '1px solid var(--rule)',
            borderRadius: 'var(--radius)',
            background: 'var(--paper)',
            color: 'var(--ink)',
            resize: 'vertical',
          }}
        />
      ) : (
        <pre
          className="mono"
          style={{
            fontSize: 'var(--t-xs)',
            margin: 0,
            padding: 8,
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
            maxHeight: 260,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {pretty(gate.payload_json)}
        </pre>
      )}

      {error && (
        <p style={{ color: 'var(--st-fail)', fontSize: 'var(--t-xs)' }} className="mono">
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {editing ? (
          <>
            <Button
              disabled={busy}
              tone="needs"
              onClick={() => void run(() => api.gateEditAndApprove(gate.id, parse(draft)))}
            >
              Approve edited
            </Button>
            <Button disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {/* §19.4 — an action keeps its name through the whole flow. */}
            <Button
              disabled={busy}
              tone="live"
              onClick={() => void run(() => api.gateDecide(gate.id, 'approve'))}
            >
              {approveLabel(gate.gate)}
            </Button>
            <Button disabled={busy} onClick={() => void run(() => api.gateDecide(gate.id, 'deny'))}>
              Deny
            </Button>
            <Button disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </Button>
          </>
        )}
      </div>

      <p style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-xs)', margin: '8px 0 0' }}>
        Approving binds this exact text. If it changes before it runs, Osade refuses it.
      </p>
    </section>
  );
}

function Button({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'live' | 'needs';
}): JSX.Element {
  const color =
    tone === 'live' ? 'var(--st-live)' : tone === 'needs' ? 'var(--st-needs)' : 'var(--ink)';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '5px 12px',
        border: `1px solid ${tone ? color : 'var(--rule)'}`,
        borderRadius: 'var(--radius)',
        background: 'var(--paper)',
        color,
        font: 'inherit',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

/** §19.4 — the button that says "Open pull request" produces "Pull request opened". */
function approveLabel(gate: string): string {
  switch (gate) {
    case 'gate.pr_open':
      return 'Open pull request';
    case 'gate.push':
      return 'Push';
    case 'gate.pr_comment':
    case 'gate.issue_comment':
      return 'Post comment';
    case 'gate.review_submit':
      return 'Submit review';
    case 'gate.undo_turn':
      return 'Undo turn';
    default:
      return 'Approve';
  }
}

function describe(gate: string): string {
  return approveLabel(gate) === 'Approve' ? gate.replace('gate.', '') : approveLabel(gate);
}

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Let the daemon reject it rather than guessing at a shape here.
    return text;
  }
}
