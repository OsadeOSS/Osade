import { useState, type JSX, type ReactNode } from 'react';

import { AgentMark } from './agent-icon.js';
import osadeLogo from './assets/osade.png';
import { chord } from './chords.js';
import { chatActivity, chatLabel, primaryLane, type ChatGroup } from './lanes.js';
import { ProjectMenu, type ProjectMenuActions } from './ProjectMenu.js';
import { STATUS, TONE_COLOUR, ago, type Tone } from './status.js';
import { TERMINAL_STATUS_LABEL, type TerminalAgent, type TerminalAgentStatus } from './terminal-agent.js';

/** An agent someone started by hand in a terminal tab. */
export interface TerminalAgentRow extends TerminalAgent {
  tabId: string;
}

export interface ProjectGroup {
  repoId: string;
  label: string;
  chats: ChatGroup[];
  terminals: TerminalAgentRow[];
  /** The folder on disk, when known. */
  path: string | null;
  pinned: boolean;
}

/** The project menu's actions that need App state; rename, fold and new session are local. */
export type ProjectActions = Omit<ProjectMenuActions, 'onRename' | 'onToggleCollapse' | 'onNewSession'>;

/** Working pulses; a finished turn waits on you, like a chat that needs a reply. */
export function terminalAgentTone(status: TerminalAgentStatus): Tone {
  if (status === 'working') return 'live';
  if (status === 'done') return 'needs';
  return 'rest';
}


interface BranchGroup {
  branch: string;
  /** The repository's own checkout rather than a worktree — Orca's "primary". */
  primary: boolean;
  chats: ChatGroup[];
}

/** A project's chats by the branch their primary lane is on; the real checkout first. */
export function groupByBranch(chats: ChatGroup[]): BranchGroup[] {
  const map = new Map<string, BranchGroup>();
  for (const chat of chats) {
    const lane = primaryLane(chat);
    const branch = lane.branch || lane.task.branch || 'detached';
    const group = map.get(branch) ?? { branch, primary: false, chats: [] };
    group.chats.push(chat);
    if (chat.lanes.some((l) => l.attachment === 'repo')) group.primary = true;
    map.set(branch, group);
  }
  return [...map.values()].sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return latest(b.chats) - latest(a.chats);
  });
}

function latest(chats: ChatGroup[]): number {
  return chats.reduce((max, chat) => Math.max(max, chatActivity(chat)), 0);
}

/**
 * The left sidebar, arranged like Orca's: a top bar, Search, the app's views, then every
 * project as a tree — project, the branches its chats are on, and the chats themselves.
 */
export function ProjectSidebar({
  projects,
  selectedChatId,
  collapsed,
  onToggle,
  renaming,
  onRename,
  onAlias,
  connection,
  hasRepo,
  view,
  onTasks,
  browserOpen,
  onBrowser,
  notesOpen,
  onNotes,
  onSearch,
  onHide,
  canBack,
  canForward,
  onBack,
  onForward,
  onOpenChat,
  activeTabId,
  onOpenTerminal,
  onTerminalMenu,
  onMenu,
  onNewChat,
  onOpenFolder,
  editors,
  projectActions,
  error,
  settings,
}: {
  projects: ProjectGroup[];
  selectedChatId: string | null;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  renaming: string | null;
  onRename: (repoId: string | null) => void;
  onAlias: (repoId: string, name: string) => void;
  connection: string;
  hasRepo: boolean;
  view: 'list' | 'board';
  onTasks: () => void;
  browserOpen: boolean;
  onBrowser: () => void;
  notesOpen: boolean;
  onNotes: () => void;
  onSearch: () => void;
  onHide: () => void;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onOpenChat: (chat: ChatGroup) => void;
  activeTabId: string | null;
  onOpenTerminal: (tabId: string) => void;
  /** Right-click on a terminal row: its tab's menu. */
  onTerminalMenu: (tabId: string, x: number, y: number) => void;
  onMenu: (taskId: string, x: number, y: number) => void;
  onNewChat: (repoId: string) => void;
  onOpenFolder: () => void;
  editors: { id: string; label: string }[];
  projectActions: (repoId: string) => ProjectActions;
  error: string | null;
  settings: ReactNode;
}): JSX.Element {
  const [menu, setMenu] = useState<{ repoId: string; x: number; y: number } | null>(null);
  const menuProject = menu ? projects.find((p) => p.repoId === menu.repoId) : undefined;
  return (
    <main className="osade-sidebar side">
      <div className="side-top">
        <img src={osadeLogo} alt="Osade" className="side-logo" />
        <span className="side-top-spacer" />
        <IconButton label="Hide sidebar" onClick={onHide}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
          <path d="M6 2.5v11" />
        </IconButton>
        <IconButton label="Back" onClick={onBack} disabled={!canBack}>
          <path d="M9.5 3.5 5 8l4.5 4.5" />
        </IconButton>
        <IconButton label="Forward" onClick={onForward} disabled={!canForward}>
          <path d="M6.5 3.5 11 8l-4.5 4.5" />
        </IconButton>
      </div>

      <button type="button" className="side-search" onClick={onSearch} title={`Search (${chord('k')})`}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" />
        </svg>
        <span>Search</span>
      </button>

      <nav className="side-nav" aria-label="Views">
        <NavItem label="Tasks" active={view === 'board'} onClick={onTasks}>
          <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5" />
        </NavItem>
        <NavItem label="Browser" active={browserOpen} onClick={onBrowser} hint={chord('b')}>
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M2 6h12" />
        </NavItem>
        <NavItem label="Notes" active={notesOpen} onClick={onNotes} hint={chord('notes')}>
          <path d="M4 2.5h6l2.5 2.5v8.5H4z" />
          <path d="M6 7h4.5M6 9.5h4.5" />
        </NavItem>
      </nav>

      <div className="side-section-head">
        <span>Projects</span>
        <IconButton label="Open folder" onClick={onOpenFolder}>
          <path d="M2 4h4.5l1.5 1.5H14V13H2z" />
          <path d="M8 7.5v4M6 9.5h4" />
        </IconButton>
        <IconButton label={`New session (${chord('t')})`} onClick={() => projects[0] && onNewChat(projects[0].repoId)} disabled={projects.length === 0}>
          <path d="M8 3v10M3 8h10" />
        </IconButton>
      </div>

      {error && (
        <div className="side-error" title={error}>
          {error}
        </div>
      )}

      <div className="side-tree">
        {connection !== 'live' && projects.length === 0 && (
          <p className="side-empty">Connecting to the daemon…</p>
        )}
        {connection === 'live' && projects.length === 0 && (
          <div className="side-empty">
            <p>{hasRepo ? 'No chats yet.' : 'No projects yet.'}</p>
            <button type="button" onClick={onOpenFolder}>
              Open folder
            </button>
          </div>
        )}
        {projects.map((project) => {
          const closed = collapsed.has(project.repoId);
          return (
            <section key={project.repoId} className="project">
              <div
                className="project-row"
                data-menu-open={menu?.repoId === project.repoId || undefined}
                onContextMenu={(event) => {
                  if (renaming === project.repoId) return;
                  event.preventDefault();
                  setMenu({ repoId: project.repoId, x: event.clientX, y: event.clientY });
                }}
              >
                <button
                  type="button"
                  className="project-toggle"
                  aria-expanded={!closed}
                  onClick={() => onToggle(project.repoId)}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M2 3.5h4.5l1.5 2H14v7.5H2z" />
                  </svg>
                  {renaming === project.repoId ? (
                    <input
                      autoFocus
                      defaultValue={project.label}
                      aria-label="Project name"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          onAlias(project.repoId, event.currentTarget.value.trim());
                          onRename(null);
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          onRename(null);
                        }
                      }}
                      onBlur={(event) => {
                        onAlias(project.repoId, event.currentTarget.value.trim());
                        onRename(null);
                      }}
                    />
                  ) : (
                    <span
                      className="project-name"
                      title={`${project.path ?? project.label} — right-click for options, double-click to rename`}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onRename(project.repoId);
                      }}
                    >
                      {project.label}
                    </span>
                  )}
                  {project.pinned && (
                    <svg className="project-pin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-label="Pinned">
                      <path d="M6 2.5h4M8 2.5v5l3 2.5H5l3-2.5M8 10v3.5" />
                    </svg>
                  )}
                </button>
                <IconButton label="New session" onClick={() => onNewChat(project.repoId)} className="project-add">
                  <path d="M8 3v10M3 8h10" />
                </IconButton>
              </div>

              {!closed &&
                groupByBranch(project.chats).map((group) => {
                  const key = `${project.repoId}:${group.branch}`;
                  const folded = collapsed.has(key);
                  const active = group.chats.some((chat) => chat.chatId === selectedChatId);
                  return (
                    <div key={key} className="branch-card" data-active={active || undefined}>
                      <div className="branch-card-head">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                          <circle cx="4.5" cy="3.5" r="1.5" />
                          <circle cx="4.5" cy="12.5" r="1.5" />
                          <circle cx="11.5" cy="5.5" r="1.5" />
                          <path d="M4.5 5v6M11.5 7c0 2.5-2 3-7 4" />
                        </svg>
                        <span className="branch-card-name" title={group.branch}>
                          {group.branch}
                        </span>
                        {group.primary && <span className="branch-card-badge">primary</span>}
                      </div>
                      <button
                        type="button"
                        className="branch-card-count"
                        aria-expanded={!folded}
                        onClick={() => onToggle(key)}
                      >
                        <span>
                          {group.chats.length} {group.chats.length === 1 ? 'chat' : 'chats'}
                        </span>
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                          <path d={folded ? 'M6 4l4 4-4 4' : 'M4 6l4 4 4-4'} />
                        </svg>
                      </button>
                      {!folded &&
                        group.chats.map((chat) => (
                          <SessionRow
                            key={chat.chatId}
                            chat={chat}
                            selected={chat.chatId === selectedChatId}
                            onSelect={() => onOpenChat(chat)}
                            onMenu={(x, y) => onMenu(primaryLane(chat).task.id, x, y)}
                          />
                        ))}
                    </div>
                  );
                })}

              {!closed && project.terminals.length > 0 && (
                <div
                  className="branch-card"
                  data-active={project.terminals.some((t) => t.tabId === activeTabId) || undefined}
                >
                  <div className="branch-card-head">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <rect x="2" y="3" width="12" height="10" rx="1.5" />
                      <path d="M4.5 6.5 6.5 8l-2 1.5M8 10h3" />
                    </svg>
                    <span className="branch-card-name">Terminal</span>
                  </div>
                  <div className="branch-card-count" aria-hidden="true">
                    <span>
                      {project.terminals.length} {project.terminals.length === 1 ? 'agent' : 'agents'}
                    </span>
                  </div>
                  {project.terminals.map((row) => (
                    <TerminalRow
                      key={row.tabId}
                      row={row}
                      selected={row.tabId === activeTabId}
                      onSelect={() => onOpenTerminal(row.tabId)}
                      onMenu={(x, y) => onTerminalMenu(row.tabId, x, y)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <footer className="side-foot">{settings}</footer>

      {menu && menuProject && (
        <ProjectMenu
          x={menu.x}
          y={menu.y}
          pinned={menuProject.pinned}
          collapsed={collapsed.has(menuProject.repoId)}
          hasPath={menuProject.path != null}
          editors={editors}
          onClose={() => setMenu(null)}
          actions={{
            ...projectActions(menuProject.repoId),
            onNewSession: () => onNewChat(menuProject.repoId),
            onRename: () => onRename(menuProject.repoId),
            onToggleCollapse: () => onToggle(menuProject.repoId),
          }}
        />
      )}
    </main>
  );
}

function SessionRow({
  chat,
  selected,
  onSelect,
  onMenu,
}: {
  chat: ChatGroup;
  selected: boolean;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
}): JSX.Element {
  const copy = STATUS[chat.status];
  const primary = primaryLane(chat);
  const age = ago(chatActivity(chat));
  return (
    <div
      data-task-id={primary.task.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className="session-row"
      title={`${chatLabel(chat)} — ${copy.label}`}
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span
        className={`session-row-status ${copy.tone === 'live' ? 'dock-status-live' : ''}`}
        style={{ background: TONE_COLOUR[copy.tone] }}
        aria-hidden="true"
      />
      <span className="session-row-agent" aria-hidden="true">
        <AgentMark name={primary.agentId} size={13} />
      </span>
      <span className="session-row-title">{chatLabel(chat)}</span>
      {age && <span className="session-row-age">{age}</span>}
    </div>
  );
}

function TerminalRow({
  row,
  selected,
  onSelect,
  onMenu,
}: {
  row: TerminalAgentRow;
  selected: boolean;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
}): JSX.Element {
  const tone = terminalAgentTone(row.status);
  const status = TERMINAL_STATUS_LABEL[row.status];
  const name = row.name;
  const text = row.label === name ? `${status} - ${name}` : row.label;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className="session-row"
      title={`${row.label} — ${name} in a terminal, ${status.toLowerCase()}`}
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span
        className={`session-row-status ${tone === 'live' ? 'dock-status-live' : ''}`}
        style={{ background: TONE_COLOUR[tone] }}
        aria-hidden="true"
      />
      <span className="session-row-agent" aria-hidden="true">
        <AgentMark name={row.agent} size={13} />
      </span>
      <span className="session-row-title">{text}</span>
      <span className="session-row-age">{ago(row.since)}</span>
    </div>
  );
}

function NavItem({
  label,
  active,
  hint,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  hint?: string;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button type="button" className="side-nav-item" aria-pressed={active} onClick={onClick} title={hint ? `${label} (${hint})` : label}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        {children}
      </svg>
      <span>{label}</span>
    </button>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`side-icon-btn ${className ?? ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}
