import type { JSX } from 'react';

import { GLYPH, STATUS, TONE_COLOUR } from './status.js';
import { BOARD_COLUMNS, boardGroups, chatLabel, primaryLane, type ChatGroup } from './lanes.js';

export function Board({
  chats,
  selectedId,
  onSelect,
  onMenu,
}: {
  chats: ChatGroup[];
  selectedId: string | null;
  onSelect: (chat: ChatGroup) => void;
  onMenu: (taskId: string, x: number, y: number) => void;
}): JSX.Element {
  const grouped = boardGroups(chats);
  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 10px', minHeight: 0, height: '100%' }}>
      {BOARD_COLUMNS.map((col) => (
        <section
          key={col.id}
          style={{
            flex: '1 1 0',
            minWidth: 150,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <h2
            style={{
              margin: 0,
              padding: '6px 8px',
              fontSize: 'var(--t-xs)',
              fontWeight: 600,
              color: 'var(--ink-2)',
              flexShrink: 0,
            }}
          >
            {col.label} · {grouped[col.id].length}
          </h2>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {grouped[col.id].length === 0 && (
              <p style={{ margin: '4px 8px', color: 'var(--ink-3)', fontSize: 'var(--t-xs)' }}>None</p>
            )}
            {grouped[col.id].map((chat) => {
              const copy = STATUS[chat.status];
              const colour = TONE_COLOUR[copy.tone];
              const primary = primaryLane(chat);
              const selected = selectedId === chat.chatId;
              return (
                <button
                  key={chat.chatId}
                  type="button"
                  title={chatLabel(chat)}
                  onClick={() => onSelect(chat)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onMenu(primary.task.id, event.clientX, event.clientY);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    marginBottom: 6,
                    padding: '8px 10px',
                    border: '0.5px solid',
                    borderColor: selected ? colour : 'var(--line)',
                    background: selected ? 'var(--bg-2)' : 'var(--bg-0)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: colour, fontSize: 'var(--t-s)' }}>{GLYPH[copy.tone]}</span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 'var(--t-s)',
                      }}
                    >
                      {chatLabel(chat)}
                    </span>
                  </div>
                  <div className="mono" style={{ marginTop: 4, fontSize: 'var(--t-xs)', color: 'var(--ink-3)' }}>
                    {copy.label}
                    {chat.lanes.length > 1 ? ` · ${chat.lanes.length} lanes` : ''}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
