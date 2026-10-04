import { useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react';

/** What the project menu can do; each closes the menu after it runs. */
export interface ProjectMenuActions {
  onNewSession: () => void;
  onNewTerminal: () => void;
  onRename: () => void;
  onOpenIn: (target: string) => void;
  onCopyPath: () => void;
  onTogglePin: () => void;
  onToggleCollapse: () => void;
  onRemove: () => void;
}

/**
 * The right-click menu on a sidebar project, laid out like Orca's workspace menu: actions, then
 * where to open it, then pin/fold, then removal on its own at the bottom.
 */
export function ProjectMenu({
  x,
  y,
  pinned,
  collapsed,
  hasPath,
  editors,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  pinned: boolean;
  collapsed: boolean;
  /** False while the folder is unknown; the path-based items are then disabled. */
  hasPath: boolean;
  editors: { id: string; label: string }[];
  actions: ProjectMenuActions;
  onClose: () => void;
}): JSX.Element {
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [openSub, setOpenSub] = useState(false);

  // Keep the menu on screen near the window's right and bottom edges.
  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div
      className="project-menu-backdrop"
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menu}
        role="menu"
        className="project-menu"
        style={pos}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
            const at = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
            items[(next + items.length) % items.length]?.focus();
          }
        }}
      >
        <div className="project-menu-label">Project</div>
        <Item icon={<path d="M8 3v10M3 8h10" />} onClick={run(actions.onNewSession)}>
          New session
        </Item>
        <Item
          icon={
            <>
              <rect x="2" y="3" width="12" height="10" rx="1.5" />
              <path d="M4.5 6.5 6.5 8l-2 1.5M8 10h3" />
            </>
          }
          onClick={run(actions.onNewTerminal)}
          disabled={!hasPath}
        >
          New terminal
        </Item>
        <Item icon={<path d="M3 13h3l7-7-3-3-7 7zM9 4l3 3" />} onClick={run(actions.onRename)}>
          Rename
        </Item>

        <hr />
        <div
          className="project-menu-sub"
          onMouseEnter={() => setOpenSub(true)}
          onMouseLeave={() => setOpenSub(false)}
        >
          <Item
            icon={<path d="M2 4h4.5l1.5 1.5H14V13H2z" />}
            onClick={() => setOpenSub((open) => !open)}
            disabled={!hasPath}
            trailing={<path d="M6 4l4 4-4 4" />}
            ariaHasPopup
          >
            Open in
          </Item>
          {openSub && hasPath && (
            <div role="menu" className="project-menu project-menu-flyout">
              <Item onClick={run(() => actions.onOpenIn('files'))}>
                {navigator.platform.startsWith('Mac') ? 'Finder' : 'File Explorer'}
              </Item>
              {editors.map((editor) => (
                <Item key={editor.id} onClick={run(() => actions.onOpenIn(editor.id))}>
                  {editor.label}
                </Item>
              ))}
            </div>
          )}
        </div>
        <Item
          icon={
            <>
              <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" />
              <path d="M3 10.5V3.5A1 1 0 0 1 4 2.5h6.5" />
            </>
          }
          onClick={run(actions.onCopyPath)}
          disabled={!hasPath}
        >
          Copy path
        </Item>

        <hr />
        <Item icon={<path d="M6 2.5h4M8 2.5v5l3 2.5H5l3-2.5M8 10v3.5" />} onClick={run(actions.onTogglePin)}>
          {pinned ? 'Unpin' : 'Pin to top'}
        </Item>
        <Item
          icon={<path d={collapsed ? 'M4 6l4 4 4-4' : 'M4 10l4-4 4 4'} />}
          onClick={run(actions.onToggleCollapse)}
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </Item>

        <hr />
        <Item
          danger
          icon={<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" />}
          onClick={run(actions.onRemove)}
        >
          Remove project from Osade
        </Item>
      </div>
    </div>
  );
}

function Item({
  icon,
  trailing,
  danger,
  disabled,
  ariaHasPopup,
  onClick,
  children,
}: {
  icon?: ReactNode;
  trailing?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  ariaHasPopup?: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      className="project-menu-item"
      data-danger={danger || undefined}
      disabled={disabled}
      aria-haspopup={ariaHasPopup || undefined}
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        {icon}
      </svg>
      <span>{children}</span>
      {trailing && (
        <svg className="project-menu-trailing" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          {trailing}
        </svg>
      )}
    </button>
  );
}
