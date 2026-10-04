import { useEffect, useMemo, useState, type JSX } from 'react';

import type { TaskView } from '@osade/contract';

import { api } from './api.js';
import { chord } from './chords.js';

export interface PaletteRepo {
  repoId: string;
}

type ItemSection = 'Create' | 'Workspace' | 'Current chat' | 'Conversations';
type IconName = 'add' | 'plan' | 'board' | 'browser' | 'note' | 'play' | 'check' | 'pr' | 'chat';

interface Item {
  id: string;
  section: ItemSection;
  label: string;
  detail?: string;
  keywords?: string;
  chord?: string;
  icon: IconName;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

const SECTION_ORDER: ItemSection[] = ['Create', 'Workspace', 'Current chat', 'Conversations'];

export function CommandPalette({
  open,
  onClose,
  selected,
  repo,
  chats = [],
  view = 'list',
  browserOpen = false,
  onOpenChat,
  onNewChat,
  onPlan,
  onBoard,
  onBrowser,
  onQuickNote,
  onNotes,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  selected: TaskView | null;
  repo: PaletteRepo | null;
  chats?: { id: string; title: string }[];
  view?: 'list' | 'board';
  browserOpen?: boolean;
  onOpenChat?: (id: string) => void;
  onNewChat: () => void;
  onPlan?: () => void;
  onBoard?: () => void;
  onBrowser?: () => void;
  onQuickNote?: () => void;
  onNotes?: () => void;
  onError: (message: string) => void;
}): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const items = useMemo<Item[]>(() => {
    const hasWorkspace = repo != null || selected != null;
    return [
      {
        id: 'new',
        section: 'Create',
        label: 'New chat',
        detail: 'Choose an agent and start in this repository',
        keywords: 'agent session conversation',
        chord: chord('t'),
        icon: 'add',
        run: onNewChat,
      },
      {
        id: 'plan',
        section: 'Create',
        label: 'Open plan',
        detail: 'Coordinate work before implementation',
        keywords: 'orchestrate strategy',
        disabled: !hasWorkspace,
        icon: 'plan',
        run: () => onPlan?.(),
      },
      {
        id: 'board',
        section: 'Workspace',
        label: view === 'board' ? 'Show conversation list' : 'Show kanban',
        detail: view === 'board' ? 'Return to the session workspace' : 'See work grouped by state',
        keywords: 'view tasks lanes list',
        icon: 'board',
        run: () => onBoard?.(),
      },
      {
        id: 'browser',
        section: 'Workspace',
        label: browserOpen ? 'Close browser pane' : 'Open browser pane',
        detail: 'Keep web context beside the active session',
        keywords: 'preview web inspect',
        chord: chord('b'),
        icon: 'browser',
        run: () => onBrowser?.(),
      },
      {
        id: 'quick-note',
        section: 'Workspace',
        label: 'Capture a quick note',
        detail: 'Save context without leaving the current screen',
        keywords: 'remember todo capture',
        chord: chord('note'),
        disabled: !hasWorkspace,
        icon: 'note',
        run: () => onQuickNote?.(),
      },
      {
        id: 'notes',
        section: 'Current chat',
        label: 'Open notes',
        detail: 'Review notes attached to this repository',
        keywords: 'memory todos',
        chord: chord('notes'),
        disabled: selected == null,
        icon: 'note',
        run: () => onNotes?.(),
      },
      {
        id: 'launch',
        section: 'Current chat',
        label: 'Start agent',
        detail: 'Launch the selected lane',
        keywords: 'run resume',
        disabled: selected == null,
        icon: 'play',
        run: async () => {
          await api.taskLaunch(selected!.task.id);
        },
      },
      {
        id: 'verify',
        section: 'Current chat',
        label: 'Run checks',
        detail: 'Execute the repository verification plan',
        keywords: 'test lint typecheck verify',
        disabled: selected == null,
        icon: 'check',
        run: async () => {
          await api.verifyRun(selected!.task.id);
        },
      },
      {
        id: 'pr',
        section: 'Current chat',
        label: 'Request pull request',
        detail: 'Prepare the selected work for review',
        keywords: 'github publish review',
        disabled: selected == null,
        icon: 'pr',
        run: async () => {
          await api.prOpenRequest(selected!.task.id, selected!.task.title, '');
        },
      },
      ...chats.map((chat) => ({
        id: `chat:${chat.id}`,
        section: 'Conversations' as const,
        label: chat.title,
        detail: 'Open conversation',
        keywords: 'chat session history',
        icon: 'chat' as const,
        run: () => onOpenChat?.(chat.id),
      })),
    ];
  }, [
    browserOpen,
    chats,
    onBoard,
    onBrowser,
    onNewChat,
    onNotes,
    onOpenChat,
    onPlan,
    onQuickNote,
    repo,
    selected,
    view,
  ]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return items;
    return items.filter((item) =>
      [item.label, item.detail, item.keywords, item.section]
        .filter(Boolean)
        .some((part) => part!.toLowerCase().includes(needle)),
    );
  }, [items, query]);

  const sections = SECTION_ORDER.map((section) => ({
    section,
    items: filtered.filter((item) => item.section === section),
  })).filter((group) => group.items.length > 0);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setCursor(0);
    }
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  if (!open) return null;

  function run(item: Item): void {
    if (item.disabled) return;
    onClose();
    void Promise.resolve(item.run()).catch((err: Error) => onError(err.message));
  }

  return (
    <div className="command-lens-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="command-lens"
        role="dialog"
        aria-label="Command center"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-lens-search">
          <SearchIcon />
          <input
            autoFocus
            value={query}
            aria-label="Search actions and conversations"
            placeholder="Search actions and conversations…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setCursor((current) =>
                  Math.min(current + 1, Math.max(filtered.length - 1, 0)),
                );
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setCursor((current) => Math.max(current - 1, 0));
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                const item = filtered[cursor];
                if (item) run(item);
              }
            }}
          />
          <kbd>{chord('k')}</kbd>
        </div>

        <div className="command-lens-results">
          {filtered.length === 0 && (
            <div className="command-lens-empty">
              <span>No matching action</span>
              <small>Try a conversation title, “browser”, “checks”, or “note”.</small>
            </div>
          )}
          {sections.map((group) => (
            <section key={group.section} className="command-lens-section">
              <h2>{group.section}</h2>
              {group.items.map((item) => {
                const index = filtered.indexOf(item);
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={item.disabled}
                    aria-current={index === cursor ? 'true' : undefined}
                    onClick={() => run(item)}
                    onMouseEnter={() => setCursor(index)}
                    className="command-lens-row"
                  >
                    <span className="command-lens-icon"><CommandIcon name={item.icon} /></span>
                    <span className="command-lens-copy">
                      <span>{item.label}</span>
                      {item.detail && <small>{item.detail}</small>}
                    </span>
                    {item.chord && <kbd>{item.chord}</kbd>}
                  </button>
                );
              })}
            </section>
          ))}
        </div>

        <footer className="command-lens-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </footer>
      </div>
    </div>
  );
}

function SearchIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="7" cy="7" r="4.4" />
      <path d="m10.4 10.4 3.1 3.1" />
    </svg>
  );
}

function CommandIcon({ name }: { name: IconName }): JSX.Element {
  const paths: Record<IconName, JSX.Element> = {
    add: <path d="M8 3v10M3 8h10" />,
    plan: <><path d="M3 3.5h10v9H3z" /><path d="M5.5 6h5M5.5 8.5h3.5" /></>,
    board: <path d="M2.5 3h4.5v10H2.5zM9 3h4.5v6H9z" />,
    browser: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 6h12" /></>,
    note: <><path d="M3 2.5h8l2 2v9H3z" /><path d="M10.5 2.5v2.7H13M5.5 8h5M5.5 10.5h3.5" /></>,
    play: <path d="m5 3.5 7 4.5-7 4.5z" />,
    check: <path d="M3 8.5 6.2 12 13 4.5" />,
    pr: <><circle cx="4" cy="3.5" r="1.5" /><circle cx="12" cy="12.5" r="1.5" /><path d="M4 5v7.5M7 4h2a3 3 0 0 1 3 3v4" /></>,
    chat: <path d="M2.5 3.5h11v7.5H7l-3.5 2.5V11h-1z" />,
  };
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
