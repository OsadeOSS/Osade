import { useEffect, useRef, useState, type JSX } from 'react';

import { api } from './api.js';

/**
 * Quick capture — issue #19. The fast path, and the reason the feature exists.
 *
 * A floating popover, not a modal, on purpose: the whole premise is that you noticed something
 * *while doing something else* and refuse to context-switch. A modal takes the work away from
 * you to write down that you would rather not stop working. So it opens over the top, focuses
 * the field, and `Escape` puts everything back exactly as it was.
 *
 * Where it captures the file from, and why that is a plain prop rather than a context: the file
 * being read lives in the Files lane's own state, and threading a "currently open file" through
 * `App` → `Detail` → `Files` to reach a popover that is not their child would couple three
 * unrelated components to each other. The caller knows; this does not need to.
 */
export function QuickCapture({
  repoId,
  file,
  line,
  onClose,
  onSaved,
}: {
  repoId: string;
  file: string | null;
  line: number | null;
  onClose: () => void;
  /** The caller refetches, so the panel and this popover cannot disagree. */
  onSaved: () => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  // Escape anywhere in the popover dismisses it. Capture-phase, because the textarea's own
  // keydown would otherwise stop at the field and a person would have to click the backdrop.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  async function save(): Promise<void> {
    if (text.trim().length === 0 || saving) return;
    setSaving(true);
    try {
      await api.noteCreate({ repoId, text, file, line });
      setError(null);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(8, 10, 12, 0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        role="dialog"
        aria-label="New quick note"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 520,
          maxWidth: '92vw',
          background: 'var(--bg-1)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius)',
          padding: 10,
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-3)', marginBottom: 6 }}
        >
          {file == null ? 'no file open' : `${file}${line == null ? '' : `:${line}`}`}
        </div>
        <textarea
          ref={ref}
          autoFocus
          rows={2}
          value={text}
          disabled={saving}
          placeholder="Noticed something. Come back to it later."
          aria-label="Note"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.stopPropagation();
              void save();
            }
          }}
          style={{ fontSize: 'var(--t-m)', minHeight: 48, resize: 'vertical' }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 8,
          }}
        >
          {error != null ? (
            <span
              className="mono"
              style={{ flex: 1, minWidth: 0, fontSize: 'var(--t-xs)', color: 'var(--st-fail)' }}
            >
              {error}
            </span>
          ) : (
            <span className="mono" style={{ flex: 1, fontSize: 'var(--t-xs)', color: 'var(--ink-3)' }}>
              Enter saves · Shift+Enter for a new line · Esc dismisses
            </span>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={saving || text.trim().length === 0}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
