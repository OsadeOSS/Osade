import { useState, type JSX } from 'react';

import { api, type PlanStep } from './api.js';

/**
 * The verification plan review — OSADE.md §10.1.
 *
 * INVARIANT: the plan is **shown to the user and editable before first use**. Never run an
 * inferred command silently the first time. This component is the reason the daemon refuses to
 * run a plan whose `needsReview` is still set — the two halves of the same rule.
 *
 * Each step shows its `source` and `evidence`, because a plan derived from evidence is only
 * trustworthy if you can see the evidence.
 */

const SOURCE_LABEL: Record<PlanStep['source'], string> = {
  ci: 'CI config',
  manifest: 'manifest',
  doc: 'contributing docs',
  user: 'you',
};

export function VerifyPlanReview({ taskId }: { taskId: string }): JSX.Element {
  const [steps, setSteps] = useState<PlanStep[] | null>(null);
  const [needsReview, setNeedsReview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function run<T>(action: () => Promise<T>, after?: (value: T) => void): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      after?.(await action());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (steps == null) {
    return (
      <div style={{ padding: '12px 0' }}>
        <button
          disabled={busy}
          onClick={() =>
            void run(
              () => api.verifyPlanDerive(taskId),
              (plan) => {
                setSteps(plan.steps);
                setNeedsReview(plan.needsReview);
              },
            )
          }
          style={buttonStyle}
        >
          Derive a verification plan
        </button>
        {error && <Err message={error} />}
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <p style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-xs)' }}>
        No verification steps found in this repository. Add one to run checks before review.
      </p>
    );
  }

  return (
    <div style={{ padding: '8px 0' }}>
      {needsReview && (
        <p style={{ color: 'var(--st-needs)', fontSize: 'var(--t-xs)', margin: '0 0 8px' }}>
          Review this before it runs. Osade inferred it and has not run any of it yet.
        </p>
      )}

      {steps.map((step, i) => (
        <div
          key={step.name}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 8,
            padding: '6px 0',
            borderBottom: '1px solid var(--rule)',
          }}
        >
          <div>
            <code className="mono" style={{ fontSize: 'var(--t-xs)' }}>
              {step.cmd}
            </code>
            <div style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-xs)' }}>
              from {SOURCE_LABEL[step.source]} · {step.evidence}
            </div>
          </div>
          <label
            style={{
              color: 'var(--ink-soft)',
              fontSize: 'var(--t-xs)',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <input
              type="checkbox"
              checked={step.required}
              onChange={(e) => {
                const next = [...steps];
                next[i] = { ...step, required: e.target.checked };
                setSteps(next);
                setNeedsReview(true);
              }}
            />
            required
          </label>
        </div>
      ))}

      {error && <Err message={error} />}
      {result && (
        <p className="mono" style={{ fontSize: 'var(--t-xs)' }}>
          {result}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          disabled={busy}
          style={buttonStyle}
          onClick={() =>
            void run(
              () => api.verifyPlanConfirm(taskId, steps),
              () => setNeedsReview(false),
            )
          }
        >
          {needsReview ? 'Confirm plan' : 'Save changes'}
        </button>
        <button
          disabled={busy || needsReview}
          title={needsReview ? 'Confirm the plan before running it' : undefined}
          style={buttonStyle}
          onClick={() =>
            void run(
              () => api.verifyRun(taskId),
              (r) => setResult(r.passed ? 'Verification passed.' : 'Verification failed.'),
            )
          }
        >
          Run verification
        </button>
      </div>
    </div>
  );
}

function Err({ message }: { message: string }): JSX.Element {
  // §19.4 — failures state what broke, in the interface's voice, never apologising.
  return (
    <p className="mono" style={{ color: 'var(--st-fail)', fontSize: 'var(--t-xs)' }}>
      {message}
    </p>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: '5px 12px',
  border: '1px solid var(--rule)',
  borderRadius: 'var(--radius)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  font: 'inherit',
  cursor: 'pointer',
};
