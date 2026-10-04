import {
  useEffect,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import type { TaskView } from '@osade/contract';

import { api } from './api.js';
import { hunkAttach, type ComposerAttach } from './compose-attach.js';
import { composeAppend } from './compose-event.js';
import { flagColour, parseUnified } from './highlight.js';
import { PrOpen } from './PrOpen.js';
import type { WorkTarget } from './work-target.js';

type Flag = 'M' | 'A' | 'D' | '?';

interface ChangeFile {
  path: string;
  flag: Flag;
  insertions: number;
  deletions: number;
}

interface Pick {
  path: string;
  vs: 'working' | 'outgoing';
}

/**
 * Diff lane — VS Code Source Control shape: working-tree changes, then commits not yet pushed.
 *
 * Laid out like Orca: the list is the side panel, and the picked file's diff renders into
 * `viewerHost`, a slot in the centre column.
 */
export function Changes({
  target,
  task,
  lanes,
  onAttach,
  viewerHost,
  onShow,
}: {
  target: WorkTarget;
  /** The lane, when there is one: its pull request section. A terminal tab's folder has none. */
  task?: TaskView;
  lanes?: TaskView[];
  onAttach?: (attach: ComposerAttach | null) => void;
  /** The centre column's slot for the diff. Nothing renders there until it exists. */
  viewerHost: HTMLElement | null;
  /** A file was picked: bring the centre over to its diff. */
  onShow?: () => void;
}): JSX.Element {
  const [files, setFiles] = useState<ChangeFile[]>([]);
  const [outgoing, setOutgoing] = useState<{
    ahead: number;
    commits: { sha: string; subject: string }[];
    files: ChangeFile[];
  } | null>(null);
  const [picked, setPicked] = useState<Pick | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [marked, setMarked] = useState<Set<number>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const stamp = target.stamp;

  useEffect(() => {
    let cancelled = false;

    async function refresh(): Promise<void> {
      try {
        const next = await api.taskChangesList(target.source);
        if (cancelled) return;
        setFiles(next.files);
        setOutgoing(next.outgoing);
        setError(null);
        setPicked((current) => {
          if (current) return current;
          const first = next.files[0] ?? next.outgoing?.files[0];
          if (!first) return null;
          return { path: first.path, vs: next.files[0] ? 'working' : 'outgoing' };
        });
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }

    void refresh();
    const tick = window.setInterval(() => void refresh(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [stamp, target.key]);

  useEffect(() => {
    if (picked == null) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    void api
      .taskChangesDiff(target.source, picked.path, picked.vs)
      .then((next) => {
        if (!cancelled) setDiff(next.diff);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [picked, stamp, target.key]);

  useEffect(() => {
    setMarked(new Set());
    setCursor(0);
  }, [picked?.path, picked?.vs, diff]);

  const lines = parseUnified(diff ?? '');

  useEffect(() => {
    if (!onAttach) return;
    if (picked == null) {
      onAttach(null);
      return;
    }
    onAttach(hunkAttach(picked.path, lines, cursor));
  }, [onAttach, picked, cursor, diff]);

  function toggleLine(index: number): void {
    setMarked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function ask(): void {
    if (picked == null) return;
    const selected = [...marked].sort((a, b) => a - b).map((i) => lines[i]?.text ?? '');
    const body = selected.length > 0 ? selected.join('\n') : (diff ?? '');
    composeAppend(`About ${picked.path}:\n\`\`\`diff\n${body}\n\`\`\``);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '8px 0 12px' }}>
          <Group title="Changes" count={files.length}>
            {files.length === 0 && (
              <p style={{ margin: '4px 12px', color: 'var(--ink-3)', fontSize: 'var(--t-xs)' }}>
                No changes since this chat started
              </p>
            )}
            {files.map((row) => (
              <ChangeRow
                key={`w:${row.path}`}
                row={row}
                active={picked?.vs === 'working' && picked.path === row.path}
                onClick={() => {
                  setPicked({ path: row.path, vs: 'working' });
                  onShow?.();
                }}
              />
            ))}
          </Group>
          <Group
            title={
              outgoing == null
                ? 'Outgoing'
                : outgoing.ahead === 0
                  ? 'Outgoing'
                  : `Outgoing · ${outgoing.ahead}`
            }
            count={outgoing?.files.length ?? 0}
          >
            {outgoing == null && (
              <p style={{ margin: '4px 12px', color: 'var(--ink-3)', fontSize: 'var(--t-xs)' }}>
                No upstream branch
              </p>
            )}
            {outgoing?.ahead === 0 && (
              <p style={{ margin: '4px 12px', color: 'var(--ink-3)', fontSize: 'var(--t-xs)' }}>
                No new commits
              </p>
            )}
            {outgoing?.commits.map((commit) => (
              <div
                key={commit.sha}
                className="mono"
                style={{
                  padding: '3px 12px',
                  fontSize: 'var(--t-xs)',
                  color: 'var(--ink-2)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={commit.subject}
              >
                <span style={{ color: 'var(--st-needs)' }}>{commit.sha}</span> {commit.subject}
              </div>
            ))}
            {outgoing?.files.map((row) => (
              <ChangeRow
                key={`o:${row.path}`}
                row={row}
                active={picked?.vs === 'outgoing' && picked.path === row.path}
                onClick={() => {
                  setPicked({ path: row.path, vs: 'outgoing' });
                  onShow?.();
                }}
              />
            ))}
          </Group>
          {error && (
            <p style={{ margin: '8px 12px', color: 'var(--st-fail)', fontSize: 'var(--t-xs)' }}>{error}</p>
          )}
        </div>
        {viewerHost &&
          createPortal(
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', background: 'var(--bg-0)' }}>
          {picked == null ? (
            <p style={{ margin: 0, padding: '12px 16px', color: 'var(--ink-2)' }}>No changes</p>
          ) : diff == null ? (
            <p style={{ margin: 0, padding: '12px 16px', color: 'var(--ink-2)' }}>Opening {picked.path}…</p>
          ) : diff.length === 0 ? (
            <p style={{ margin: 0, padding: '12px 16px', color: 'var(--ink-2)' }}>
              {picked.path} has no line diff
            </p>
          ) : (
            <div>
              <div
                className="mono"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  fontSize: 'var(--t-xs)',
                  color: 'var(--ink-2)',
                  borderBottom: '0.5px solid var(--line)',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--bg-0)',
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {picked.path}
                  {picked.vs === 'outgoing' ? ' · unpushed' : ''}
                </span>
                <button type="button" onClick={ask} style={{ fontSize: 'var(--t-xs)', flexShrink: 0 }}>
                  {marked.size > 0 ? `Ask · ${marked.size}` : 'Ask'}
                </button>
              </div>
              <pre className="mono" style={{ margin: 0, fontSize: 'var(--t-s)' }}>
                {lines.map((line, i) => (
                  <div
                    key={i}
                    className={`diff-${line.kind}`}
                    onClick={() => {
                      setCursor(i);
                      toggleLine(i);
                    }}
                    style={{
                      padding: '0 12px',
                      whiteSpace: 'pre',
                      cursor: 'pointer',
                      background: marked.has(i) ? 'var(--bg-3)' : undefined,
                    }}
                  >
                    {line.text.length === 0 ? ' ' : line.text}
                  </div>
                ))}
              </pre>
            </div>
          )}
        </div>,
            viewerHost,
          )}
      </div>
      {task && (
        <div
          style={{
            flexShrink: 0,
            maxHeight: 220,
            overflow: 'auto',
            borderTop: '0.5px solid var(--line)',
            padding: '10px 16px 14px',
          }}
        >
          <details>
            <summary style={{ cursor: 'default', fontSize: 'var(--t-s)' }}>Open pull request</summary>
            <div style={{ marginTop: 10 }}>
              <PrOpen task={task} lanes={lanes} />
            </div>
          </details>
          {task.scm?.pr_url && (
            <p className="mono" style={{ margin: '8px 0 0', fontSize: 'var(--t-xs)', color: 'var(--ink-2)' }}>
              {task.scm.pr_url}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}): JSX.Element {
  return (
    <section style={{ marginBottom: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 12px',
          fontSize: 'var(--t-xs)',
          fontWeight: 600,
          color: 'var(--ink-2)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        <span>{title}</span>
        {count > 0 && <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>{count}</span>}
      </div>
      {children}
    </section>
  );
}

function ChangeRow({
  row,
  active,
  onClick,
}: {
  row: ChangeFile;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  const name = row.path.includes('/') ? row.path.slice(row.path.lastIndexOf('/') + 1) : row.path;
  const folder = row.path.includes('/') ? row.path.slice(0, row.path.lastIndexOf('/')) : '';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '3px 12px',
        border: 'none',
        borderRadius: 0,
        background: active ? 'var(--bg-2)' : 'transparent',
        color: flagColour(row.flag) ?? 'var(--ink)',
        textAlign: 'left',
        fontSize: 'var(--t-s)',
      }}
    >
      <span
        className="mono"
        style={{ width: 12, flexShrink: 0, fontSize: 'var(--t-xs)', color: flagColour(row.flag) }}
      >
        {row.flag === '?' ? 'U' : row.flag}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
        {folder ? (
          <span style={{ color: 'var(--ink-3)', marginLeft: 6, fontSize: 'var(--t-xs)' }}>{folder}</span>
        ) : null}
      </span>
      <span className="mono" style={{ fontSize: 'var(--t-xs)', flexShrink: 0 }}>
        {row.insertions > 0 && <span style={{ color: 'var(--st-live)' }}>+{row.insertions}</span>}
        {row.insertions > 0 && row.deletions > 0 ? ' ' : ''}
        {row.deletions > 0 && <span style={{ color: 'var(--st-fail)' }}>−{row.deletions}</span>}
      </span>
    </button>
  );
}
