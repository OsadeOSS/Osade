import { useCallback, useEffect, useState, type JSX } from 'react';

import type { QuickNoteView } from '@osade/contract';

import { api } from './api.js';
import { partitionNotes } from './quick-notes.js';
import { ago } from './status.js';

/**
 * Quick notes — issue #19. "Noticed, not fixing yet."
 *
 * Deliberately small: a line of text, where it was noticed, and a circle to tick it off. No
 * tags, no due dates, no drag-to-reorder — the issue rules those out, and they are right: a
 * notepad that grows a priority column is a task tracker, and a task tracker you did not choose
 * is one you stop opening.
 *
 * Refetches after every write rather than patching local state. §18.1: the renderer renders
 * what the daemon says, and a note you can see in the panel but that is not in the database is
 * a note the next prompt will not carry.
 */
export function QuickNotes({
  repoId,
  refreshKey,
  onCapture,
  onOpenFile,
}: {
  repoId: string;
  /** Bumped by the app after a quick-capture save, so an open panel is not one note behind. */
  refreshKey: number;
  onCapture: () => void;
  /** Jump the Files lane to a note's file, so "where was that?" is one click. */
  onOpenFile?: (file: string, line: number | null) => void;
}): JSX.Element {
  const [notes, setNotes] = useState<QuickNoteView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const refresh = useCallback(() => {
    let cancelled = false;
    void api
      .noteList(repoId)
      .then((list) => {
        if (!cancelled) {
          setNotes(list);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  useEffect(refresh, [refresh, refreshKey]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    try {
      await action();
      setError(null);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const { open, resolved } = partitionNotes(notes);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 0 8px',
        }}
      >
        <span style={{ fontSize: 'var(--t-s)', fontWeight: 600 }}>
          {open.length === 0 ? 'Quick notes' : `Quick notes · ${open.length}`}
        </span>
        <button type="button" onClick={onCapture} style={{ marginLeft: 'auto', padding: '2px 8px' }}>
          + Note
        </button>
      </div>

      {error != null && (
        <p className="mono" style={{ margin: '0 0 8px', color: 'var(--st-fail)', fontSize: 'var(--t-xs)' }}>
          {error}
        </p>
      )}

      {open.length === 0 && resolved.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 'var(--t-s)', lineHeight: 1.5 }}>
          Nothing left for later. Hit <kbd>Ctrl+Shift+N</kbd> the next time you notice something
          and are not ready to chase it — the agent reads these with every message.
        </p>
      ) : (
        <>
          {open.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              busy={busy}
              editing={editing === note.id}
              draft={draft}
              onDraft={setDraft}
              onEdit={() => {
                setEditing(note.id);
                setDraft(note.text);
              }}
              onCancelEdit={() => setEditing(null)}
              onCommit={() => {
                const text = draft;
                setEditing(null);
                if (text.trim() === note.text) return;
                void run(() => api.noteEdit(note.id, text));
              }}
              onResolve={() => void run(() => api.noteResolve(note.id, true))}
              onDelete={() => void run(() => api.noteDelete(note.id))}
              onOpenFile={onOpenFile}
            />
          ))}

          {resolved.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowResolved((openNow) => !openNow)}
                style={{
                  marginTop: 10,
                  padding: '2px 0',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--ink-3)',
                  fontSize: 'var(--t-xs)',
                }}
              >
                {showResolved ? '▾' : '▸'} {resolved.length} resolved
              </button>
              {showResolved &&
                resolved.map((note) => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    busy={busy}
                    editing={editing === note.id}
                    draft={draft}
                    onDraft={setDraft}
                    onEdit={() => {
                      setEditing(note.id);
                      setDraft(note.text);
                    }}
                    onCancelEdit={() => setEditing(null)}
                    onCommit={() => {
                      const text = draft;
                      setEditing(null);
                      if (text.trim() === note.text) return;
                      void run(() => api.noteEdit(note.id, text));
                    }}
                    onResolve={() => void run(() => api.noteResolve(note.id, false))}
                    onDelete={() => void run(() => api.noteDelete(note.id))}
                    onOpenFile={onOpenFile}
                  />
                ))}
            </>
          )}
        </>
      )}
    </section>
  );
}

function NoteRow({
  note,
  busy,
  editing,
  draft,
  onDraft,
  onEdit,
  onCancelEdit,
  onCommit,
  onResolve,
  onDelete,
  onOpenFile,
}: {
  note: QuickNoteView;
  busy: boolean;
  editing: boolean;
  draft: string;
  onDraft: (text: string) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onCommit: () => void;
  onResolve: () => void;
  onDelete: () => void;
  onOpenFile?: (file: string, line: number | null) => void;
}): JSX.Element {
  const done = note.resolvedAt != null;
  const where = note.file == null ? null : `${note.file}${note.line == null ? '' : `:${note.line}`}`;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '18px minmax(0, 1fr) auto',
        columnGap: 8,
        rowGap: 2,
        alignItems: 'start',
        padding: '7px 0',
        borderBottom: '0.5px solid var(--line)',
        opacity: done ? 0.55 : 1,
      }}
    >
      <button
        type="button"
        aria-label={done ? 'Reopen note' : 'Resolve note'}
        aria-pressed={done}
        disabled={busy}
        onClick={onResolve}
        style={{
          width: 18,
          height: 18,
          padding: 0,
          marginTop: 1,
          borderRadius: 999,
          fontSize: 11,
          lineHeight: 1,
          color: done ? 'var(--ink-3)' : 'var(--ink-2)',
        }}
      >
        {done ? '✓' : '○'}
      </button>

      <div style={{ minWidth: 0 }}>
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            rows={2}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onCommit();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancelEdit();
              }
            }}
            style={{ fontSize: 'var(--t-s)', minHeight: 44, resize: 'vertical' }}
          />
        ) : (
          <button
            type="button"
            onClick={onEdit}
            title="Edit"
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: 'transparent',
              border: 'none',
              padding: 0,
              fontSize: 'var(--t-s)',
              lineHeight: 1.45,
              color: done ? 'var(--ink-3)' : 'var(--ink)',
              textDecoration: done ? 'line-through' : undefined,
            }}
          >
            {note.text}
          </button>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 2 }}>
          {where != null && (
            <button
              type="button"
              className="mono"
              onClick={() => onOpenFile?.(note.file!, note.line)}
              title="Open this file"
              style={{
                padding: 0,
                background: 'transparent',
                border: 'none',
                fontSize: 'var(--t-xs)',
                color: 'var(--ink-3)',
                textDecoration: 'underline',
              }}
            >
              {where}
            </button>
          )}
          <span className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-3)' }}>
            {ago(note.createdAt)}
          </span>
        </div>
      </div>

      <button
        type="button"
        aria-label="Delete note"
        disabled={busy}
        onClick={onDelete}
        style={{ padding: '0 4px', background: 'transparent', border: 'none', color: 'var(--ink-3)' }}
      >
        ×
      </button>
    </div>
  );
}
