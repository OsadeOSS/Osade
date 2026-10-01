import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import type { TaskView } from '@osade/contract';

import { api } from './api.js';
import { composeAppend } from './compose-event.js';
import { fileAttach, lineRangeFromOffsets, lineSpan, type ComposerAttach } from './compose-attach.js';
import { fuzzyPath } from './files-search.js';
import { flagColour, highlight } from './highlight.js';
import { useFileOpenReminder } from './useFileOpenReminder.js';

const TREE_KEY = 'osade.files-tree-width';
const TREE_DEFAULT = 200;

type Flag = 'M' | 'A' | 'D' | '?';

export interface FsEntry {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  flag: Flag | null;
  insertions: number;
  deletions: number;
}

/**
 * Files lane — tree of this chat's cwd, editable contents with Dark+ colouring, dirty files marked.
 *
 * Refresh is tied to agent facts (CDC already pushed those) plus a 2s tick while this lane is
 * open. Open-file contents are not overwritten while the buffer is dirty.
 */
export function Files({
  task,
  onAttach,
  openPath,
  onOpenChange,
  notesRevision = 0,
}: {
  task: TaskView;
  onAttach?: (attach: ComposerAttach | null) => void;
  /**
   * Issue #19 — a quick note's file, to open here when the note is clicked.
   *
   * `n` is a counter rather than nothing so that asking for the same file twice opens it
   * twice; a bare path would be indistinguishable from "no change" the second time and the
   * click would look broken.
   */
  openPath?: { file: string; n: number; line: number | null } | null;
  /**
   * Issue #19 — bumped after any note is written or resolved, so a banner for a note the user
   * just ticked off retires instead of lingering over the file.
   */
  notesRevision?: number;
  /**
   * Issue #19 — what this lane is reading, reported up so a quick note can be stamped with it.
   *
   * A callback, not a window event, and that is the whole correction. This component unmounts
   * the moment you leave the Files tab, so anything published globally outlives it: switch to
   * Chat, press the note chord, and you would file a note against a file you closed. Reporting
   * to the owner instead lets `Detail` drop the context at the same moment this lane goes away,
   * so a note only ever carries a file that was actually on screen when you wrote it.
   */
  onOpenChange?: (open: { file: string | null; line: number | null } | null) => void;
}): JSX.Element {
  const [width, setWidth] = useState(() => loadWidth());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [listed, setListed] = useState<Record<string, FsEntry[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [mdPreview, setMdPreview] = useState(true);
  const [file, setFile] = useState<{
    path: string;
    text: string | null;
    binary: boolean;
    truncated: boolean;
  } | null>(null);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ start: number; width: number } | null>(null);
  const dirty = file != null && !file.binary && !file.truncated && text !== saved;
  const stamp = `${task.task.id}:${task.cwd}:${task.agent?.last_event_at ?? 0}:${task.status}`;
  const drafts = useRef(new Map<string, string>());
  const tabs = preview && !pinned.includes(preview) ? [...pinned, preview] : pinned;
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const { note: reminder, dismiss: reminderDismiss } = useFileOpenReminder(
    task.task.repo_id,
    preview,
    notesRevision,
  );
  useEffect(() => {
    setRange(null);
  }, [preview]);

  // Report what is being read, so a quick note can be stamped with where it was noticed.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => {
    const report = onOpenChangeRef.current;
    report?.({ file: preview, line: range?.from ?? null });
  }, [preview, range]);

  // And un-report on the way out, so a closed Files lane does not leave a file behind.
  useEffect(() => {
    const report = onOpenChangeRef.current;
    return () => report?.(null);
  }, []);

  // Issue #19 — a note was clicked in the Notes lane; open its file, at its line.
  const openTarget = openPath?.file ?? null;
  const openSeq = openPath?.n ?? 0;
  const openLine = openPath?.line ?? null;
  const [seek, setSeek] = useState<{ line: number; n: number } | null>(null);
  useEffect(() => {
    if (openTarget == null) return;
    setSelected(openTarget);
    setSeek(openLine == null ? null : { line: openLine, n: openSeq });
  }, [openTarget, openSeq, openLine]);

  useEffect(() => {
    if (!onAttach) return;
    if (preview == null) {
      onAttach(null);
      return;
    }
    onAttach(fileAttach(preview, text, range));
  }, [onAttach, preview, text, range]);

  useEffect(() => {
    let cancelled = false;

    async function refresh(): Promise<void> {
      try {
        const dirs = [...expanded];
        const result = await api.taskFsList(task.task.id, dirs);
        const next: Record<string, FsEntry[]> = {};
        for (const row of result.listings) next[row.dir] = row.entries;
        if (!cancelled) {
          setListed(next);
          setError(null);
        }
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
  }, [stamp, expanded, task.task.id]);

  useEffect(() => {
    if (selected == null) {
      setFile(null);
      setText('');
      setSaved('');
      return;
    }
    let cancelled = false;
    void api
      .taskFsRead(task.task.id, selected)
      .then((next) => {
        if (cancelled) return;
        setFile(next);
        const disk = next.text ?? '';
        const draft = drafts.current.get(selected);
        setText(draft ?? disk);
        setSaved(disk);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, stamp, task.task.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function save(): Promise<void> {
    if (selected == null || file == null || file.binary || file.truncated || text === saved) return;
    setSaving(true);
    try {
      await api.taskFsWrite(task.task.id, selected, text);
      drafts.current.delete(selected);
      setSaved(text);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function openFile(path: string, pin: boolean): void {
    if (pin) {
      setPinned((current) => (current.includes(path) ? current : [...current, path]));
      setPreview((current) => (current === path ? null : current));
    } else if (!pinned.includes(path)) {
      setPreview(path);
    }
    setSelected(path);
  }

  function closeTab(path: string): void {
    const nextPinned = pinned.filter((p) => p !== path);
    const nextPreview = preview === path ? null : preview;
    setPinned(nextPinned);
    setPreview(nextPreview);
    if (selected === path) setSelected(nextPinned.at(-1) ?? nextPreview);
  }

  function toggleDir(path: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function onDragStart(event: ReactMouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    drag.current = { start: event.clientX, width };
    function move(ev: MouseEvent): void {
      if (!drag.current) return;
      const next = Math.min(420, Math.max(140, drag.current.width + (ev.clientX - drag.current.start)));
      setWidth(next);
    }
    function up(): void {
      drag.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setWidth((current) => {
        try {
          localStorage.setItem(TREE_KEY, String(current));
        } catch {
          // ignore
        }
        return current;
      });
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  const hits = filter.trim().length === 0
    ? null
    : Object.values(listed)
        .flat()
        .filter((entry) => entry.kind === 'file' && fuzzyPath(filter, entry.path));

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <div
        style={{
          width,
          flexShrink: 0,
          overflow: 'auto',
          borderRight: '0.5px solid var(--line)',
          padding: '8px 0',
        }}
      >
        <div style={{ padding: '0 8px 8px' }}>
          <input
            value={filter}
            placeholder="Filter files"
            onChange={(event) => setFilter(event.target.value)}
            style={{ width: '100%', fontSize: 'var(--t-s)' }}
          />
        </div>
        {hits ? (
          hits.length === 0 ? (
            <p style={{ margin: '4px 12px', color: 'var(--ink-3)', fontSize: 'var(--t-xs)' }}>No matches</p>
          ) : (
            hits.map((entry) => (
              <TreeRow
                key={entry.path}
                entry={entry}
                depth={0}
                open={false}
                active={selected === entry.path}
                onClick={() => openFile(entry.path, false)}
                onPin={() => openFile(entry.path, true)}
              />
            ))
          )
        ) : (
          <Tree
            entries={listed[''] ?? []}
            listed={listed}
            expanded={expanded}
            selected={selected}
            depth={0}
            onDir={toggleDir}
            onFile={(path) => openFile(path, false)}
            onPin={(path) => openFile(path, true)}
          />
        )}
        {error && (
          <p style={{ margin: '8px 12px', color: 'var(--st-fail)', fontSize: 'var(--t-xs)' }}>{error}</p>
        )}
      </div>
      <div
        onMouseDown={onDragStart}
        style={{
          width: 5,
          cursor: 'col-resize',
          flexShrink: 0,
          background: 'transparent',
        }}
      />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {reminder != null && (
          // Issue #19 — the passive reminder. A note filed against the file that just opened.
          // A banner, not a toast, and never a message: a note that interrupts the reading you
          // opened the file to do has defeated itself.
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              padding: '6px 12px',
              fontSize: 'var(--t-s)',
              color: 'var(--st-needs)',
              background: 'var(--bg-1)',
              borderBottom: '0.5px solid var(--line)',
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              You left a note here: “{reminder.text}”
            </span>
            <button
              type="button"
              onClick={reminderDismiss}
              style={{ padding: '0 6px', flexShrink: 0, fontSize: 'var(--t-xs)' }}
            >
              Dismiss
            </button>
          </div>
        )}
        {tabs.length > 0 && (
          <div
            style={{
              display: 'flex',
              overflowX: 'auto',
              flexShrink: 0,
              borderBottom: '0.5px solid var(--line)',
            }}
          >
            {tabs.map((path) => {
              const active = selected === path;
              const previewTab = preview === path && !pinned.includes(path);
              const tabDirty = drafts.current.has(path);
              return (
                <div
                  key={path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 6px 4px 10px',
                    borderRight: '0.5px solid var(--line)',
                    background: active ? 'var(--bg-0)' : 'transparent',
                    fontStyle: previewTab ? 'italic' : 'normal',
                    flexShrink: 0,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setSelected(path)}
                    title={path}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      fontSize: 'var(--t-xs)',
                      color: active ? 'var(--ink)' : 'var(--ink-2)',
                    }}
                  >
                    {fileName(path)}
                    {tabDirty ? ' ·' : ''}
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${path}`}
                    onClick={() => closeTab(path)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: '0 2px',
                      color: 'var(--ink-3)',
                      fontSize: 'var(--t-xs)',
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <FileBody
          file={file}
          selected={selected}
          text={text}
          dirty={dirty}
          saving={saving}
          mdPreview={mdPreview}
          onMdPreview={setMdPreview}
          onChange={(next) => {
            if (selected) {
              if (next === saved) drafts.current.delete(selected);
              else drafts.current.set(selected, next);
            }
            setText(next);
          }}
          onSave={() => void save()}
          onAsk={() => {
            if (selected) composeAppend(selected);
          }}
          onSelectRange={(start, end) => setRange(lineRangeFromOffsets(text, start, end))}
          seek={seek}
        />
      </div>
    </div>
  );
}

function Tree({
  entries,
  listed,
  expanded,
  selected,
  depth,
  onDir,
  onFile,
  onPin,
}: {
  entries: FsEntry[];
  listed: Record<string, FsEntry[]>;
  expanded: Set<string>;
  selected: string | null;
  depth: number;
  onDir: (path: string) => void;
  onFile: (path: string) => void;
  onPin: (path: string) => void;
}): JSX.Element {
  return (
    <>
      {entries.map((entry) => {
        const open = entry.kind === 'dir' && expanded.has(entry.path);
        return (
          <div key={entry.path}>
            <TreeRow
              entry={entry}
              depth={depth}
              open={open}
              active={selected === entry.path}
              onClick={() => (entry.kind === 'dir' ? onDir(entry.path) : onFile(entry.path))}
              onPin={() => {
                if (entry.kind === 'file') onPin(entry.path);
              }}
            />
            {open && (
              <Tree
                entries={listed[entry.path] ?? []}
                listed={listed}
                expanded={expanded}
                selected={selected}
                depth={depth + 1}
                onDir={onDir}
                onFile={onFile}
                onPin={onPin}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function TreeRow({
  entry,
  depth,
  open,
  active,
  onClick,
  onPin,
}: {
  entry: FsEntry;
  depth: number;
  open: boolean;
  active: boolean;
  onClick: () => void;
  onPin: () => void;
}): JSX.Element {
  const colour = flagColour(entry.flag);
  return (
    <button
      onClick={onClick}
      onDoubleClick={onPin}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        padding: '2px 10px 2px',
        paddingLeft: 10 + depth * 12,
        border: 'none',
        borderRadius: 0,
        background: active ? 'var(--bg-2)' : 'transparent',
        color: colour ?? 'var(--ink)',
        textAlign: 'left',
        fontSize: 'var(--t-s)',
      }}
    >
      <span style={{ color: 'var(--ink-3)', width: 8, flexShrink: 0 }}>
        {entry.kind === 'dir' ? (open ? '⌄' : '›') : ''}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {entry.name}
      </span>
      <Diffstat entry={entry} />
    </button>
  );
}

function Diffstat({ entry }: { entry: FsEntry }): JSX.Element | null {
  if (entry.flag === '?') {
    return (
      <span className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--st-live)', flexShrink: 0 }}>
        U
      </span>
    );
  }
  if (entry.insertions === 0 && entry.deletions === 0) return null;
  return (
    <span className="mono" style={{ fontSize: 'var(--t-xs)', flexShrink: 0 }}>
      {entry.insertions > 0 && <span style={{ color: 'var(--st-live)' }}>+{entry.insertions}</span>}
      {entry.insertions > 0 && entry.deletions > 0 ? ' ' : ''}
      {entry.deletions > 0 && <span style={{ color: 'var(--st-fail)' }}>−{entry.deletions}</span>}
    </span>
  );
}

function FileBody({
  file,
  selected,
  text,
  dirty,
  saving,
  mdPreview,
  onMdPreview,
  onChange,
  onSave,
  onAsk,
  onSelectRange,
  seek,
}: {
  file: { path: string; text: string | null; binary: boolean; truncated: boolean } | null;
  selected: string | null;
  text: string;
  dirty: boolean;
  saving: boolean;
  mdPreview: boolean;
  onMdPreview: (next: boolean) => void;
  onChange: (next: string) => void;
  onSave: () => void;
  onAsk: () => void;
  onSelectRange?: (start: number, end: number) => void;
  /** Issue #19 — select this line, because a note says which one and "42" is not a place. */
  seek?: { line: number; n: number } | null;
}): JSX.Element {
  if (selected == null) {
    return (
      <p style={{ margin: 0, padding: '12px 16px', color: 'var(--ink-2)' }}>Select a file</p>
    );
  }
  if (file == null) {
    return (
      <p style={{ margin: 0, padding: '12px 16px', color: 'var(--ink-2)' }}>Opening {selected}…</p>
    );
  }
  const markdown = isMarkdown(file.path);
  if (file.binary) {
    return (
      <div style={{ padding: '12px 16px' }}>
        <p style={{ margin: 0, color: 'var(--ink-2)' }}>{file.path} is binary</p>
        <button type="button" onClick={onAsk} style={{ marginTop: 8, fontSize: 'var(--t-xs)' }}>
          Attach path
        </button>
      </div>
    );
  }
  if (file.truncated) {
    return (
      <div style={{ padding: '12px 16px' }}>
        <div className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-2)', marginBottom: 8 }}>
          {file.path} · too large to edit here
        </div>
        <pre className="mono" style={{ margin: 0, fontSize: 'var(--t-s)', whiteSpace: 'pre-wrap' }}>
          {file.text ?? ''}
        </pre>
      </div>
    );
  }
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '0.5px solid var(--line)',
          flexShrink: 0,
        }}
      >
        <span className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-2)', flex: 1, minWidth: 0 }}>
          {file.path}
          {dirty ? ' · unsaved' : ''}
        </span>
        {markdown && (
          <button type="button" onClick={() => onMdPreview(!mdPreview)} style={{ fontSize: 'var(--t-xs)' }}>
            {mdPreview ? 'Raw' : 'Preview'}
          </button>
        )}
        <button type="button" onClick={onAsk} style={{ fontSize: 'var(--t-xs)' }}>
          Attach
        </button>
        <button type="button" disabled={!dirty || saving} onClick={onSave} style={{ fontSize: 'var(--t-xs)' }}>
          {saving ? 'Saving' : 'Save'}
        </button>
      </div>
      {markdown && mdPreview ? (
        <MarkdownView text={text} />
      ) : (
        <CodeEditor
          path={file.path}
          value={text}
          onChange={onChange}
          onSelectRange={(start, end) => onSelectRange?.(start, end)}
          seek={seek}
        />
      )}
    </>
  );
}

function CodeEditor({
  path,
  value,
  onChange,
  onSelectRange,
  seek,
}: {
  path: string;
  value: string;
  onChange: (next: string) => void;
  onSelectRange?: (start: number, end: number) => void;
  /** Issue #19 — select this line, because a note says which one and "42" is not a place. */
  seek?: { line: number; n: number } | null;
}): JSX.Element {
  const preRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const tokens = highlight(value, path);

  /**
   * Seek to a line, by selecting it.
   *
   * Selecting rather than placing a caret: a collapsed selection at the very start of a
   * `<textarea>` does not reliably scroll itself into view, and "I clicked the note and nothing
   * moved" is indistinguishable from a broken button. Selecting the whole line also fires
   * `onSelect`, which sets the lane's range — so the composer then carries `path L42` as
   * context, and the file the note pointed at and the file attached to what you type next are
   * guaranteed to be the same one.
   */
  useEffect(() => {
    const ta = taRef.current;
    if (seek == null || ta == null) return;
    const span = lineSpan(value, seek.line);
    ta.focus();
    ta.setSelectionRange(span.from, span.to);
  }, [seek, value]);

  function syncScroll(): void {
    const pre = preRef.current;
    const ta = taRef.current;
    if (!pre || !ta) return;
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const ta = event.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = `${value.slice(0, start)}  ${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + 2;
    });
  }

  return (
    <div className="code-editor" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <pre
        ref={preRef}
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          margin: 0,
          padding: '12px 16px',
          overflow: 'hidden',
          pointerEvents: 'none',
          background: 'var(--bg-0)',
        }}
      >
        {tokens.map((tok, i) => (
          <span key={i} className={`tok-${tok.kind}`}>
            {tok.text}
          </span>
        ))}
        {value.endsWith('\n') ? '\n' : null}
      </pre>
      <textarea
        ref={taRef}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onSelect={(event) => onSelectRange?.(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
        onKeyUp={(event) => onSelectRange?.(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'auto',
        }}
      />
    </div>
  );
}

function MarkdownView({ text }: { text: string }): JSX.Element {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 16px' }}>
      {mdBlocks(text).map((block, i) => {
        if (block.kind === 'code') {
          return (
            <pre
              key={i}
              className="mono"
              style={{
                margin: '0 0 12px',
                padding: 10,
                background: 'var(--bg-2)',
                fontSize: 'var(--t-s)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {block.text}
            </pre>
          );
        }
        if (block.kind === 'h') {
          const size = block.level === 1 ? 'var(--t-l)' : block.level === 2 ? 'var(--t-m)' : 'var(--t-s)';
          return (
            <p key={i} style={{ margin: '0 0 10px', fontWeight: 600, fontSize: size }}>
              {block.text}
            </p>
          );
        }
        if (block.kind === 'li') {
          return (
            <ul key={i} style={{ margin: '0 0 10px', paddingLeft: 18 }}>
              {block.items.map((item, j) => (
                <li key={j} style={{ fontSize: 'var(--t-s)', marginBottom: 4 }}>
                  {item}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} style={{ margin: '0 0 10px', fontSize: 'var(--t-s)', whiteSpace: 'pre-wrap' }}>
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

function mdBlocks(
  text: string,
): ({ kind: 'code'; text: string } | { kind: 'h'; level: number; text: string } | { kind: 'li'; items: string[] } | { kind: 'p'; text: string })[] {
  const lines = text.split('\n');
  const out: ReturnType<typeof mdBlocks> = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      i += 1;
      const buf: string[] = [];
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        buf.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1;
      out.push({ kind: 'code', text: buf.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
    if (heading) {
      out.push({ kind: 'h', level: heading[1]!.length, text: heading[2] ?? '' });
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/u.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/u.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*[-*]\s+/u, ''));
        i += 1;
      }
      out.push({ kind: 'li', items });
      continue;
    }
    if (line.trim().length === 0) {
      i += 1;
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length) {
      const row = lines[i] ?? '';
      if (row.trim().length === 0 || row.startsWith('```') || /^(#{1,6})\s+/u.test(row) || /^\s*[-*]\s+/u.test(row)) {
        break;
      }
      buf.push(row);
      i += 1;
    }
    out.push({ kind: 'p', text: buf.join('\n') });
  }
  return out;
}

function isMarkdown(path: string): boolean {
  return /\.md$/iu.test(path);
}

function fileName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

function loadWidth(): number {
  try {
    const raw = Number(localStorage.getItem(TREE_KEY));
    if (Number.isFinite(raw) && raw >= 140 && raw <= 420) return raw;
  } catch {
    // ignore
  }
  return TREE_DEFAULT;
}
