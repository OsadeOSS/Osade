import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';

import type { TaskView } from '@osade/contract';

import { api } from './api.js';
import { agentColor } from './agent-color.js';
import { AgentMark } from './agent-icon.js';
import { chatLines, type ChatLine } from './chat.js';
import type { PendingLane } from './delivery.js';
import {
  agentStatusPhrase,
  formatWorkDuration,
  isAgentStatusLine,
  mergeChatLines,
  partitionAgentText,
  pendingChatLines,
} from './thread.js';

/** Optimistic follow-ups until the daemon's turn row arrives over CDC. */
const followUpsByTask = new Map<string, string[]>();

const AGENT_NAME: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  pi: 'Pi',
};

/**
 * The middle of a chat: the prompt, then what the agent did.
 *
 * Settled lines come from `turns`. While a terminal agent is still working, the
 * daemon writes the pane delta onto `stream_text` and that text grows here.
 */
export function Transcript({
  tasks,
  extraUser,
  followTaskId,
  isolatedNotice,
  pending = [],
  onOpenDiff,
}: {
  tasks: TaskView[];
  extraUser?: string;
  followTaskId?: string;
  isolatedNotice?: string;
  pending?: PendingLane[];
  onOpenDiff?: (taskId: string) => void;
}): JSX.Element {
  const [, bump] = useState(0);

  useEffect(() => {
    const text = extraUser?.trim();
    const id = followTaskId;
    if (!text || !id) return;
    const prev = followUpsByTask.get(id) ?? [];
    if (prev.includes(text)) return;
    followUpsByTask.set(id, [...prev, text]);
    bump((n) => n + 1);
  }, [extraUser, followTaskId]);

  if (tasks.length === 0 && !extraUser && pending.length === 0) {
    return (
      <div>
        {isolatedNotice && (
          <p style={{ margin: '0 0 10px', color: 'var(--ink-2)', fontSize: 'var(--t-s)' }}>
            {isolatedNotice}
          </p>
        )}
        <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 'var(--t-s)' }}>
          Nothing here yet. Write below to start this chat.
        </p>
      </div>
    );
  }

  const taskIdsByAgent = new Map(tasks.map((t) => [t.agentId, t.task.id]));
  const chatId = tasks[0]?.chatId ?? pending[0]?.chatId ?? 'draft';

  const lanes =
    tasks.length === 0
      ? [
          {
            id: 'draft',
            lines: extraUser
              ? [
                  {
                    id: 'draft',
                    role: 'user' as const,
                    agentId: 'claude',
                    taskId: 'draft',
                    text: extraUser,
                    live: false,
                    at: Date.now(),
                  },
                ]
              : [],
          },
        ]
      : tasks.map((task) => ({
          id: task.task.id,
          lines: chatLines(task, followUpsByTask.get(task.task.id) ?? []),
        }));

  const pendingLines = pendingChatLines(
    pending.filter((p) => p.chatId === chatId),
    taskIdsByAgent,
  );
  const lines = mergeChatLines([...lanes.flatMap((lane) => lane.lines), ...pendingLines]);
  const token = lines.map((line) => `${line.id}:${line.text.length}:${line.live}`).join('|');

  return (
    <div className="osade-thread">
      {isolatedNotice && (
        <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 'var(--t-s)' }}>{isolatedNotice}</p>
      )}
      {lines.map((line) =>
        line.role === 'user' ? (
          <UserLine key={line.id} line={line} />
        ) : (
          <AgentReport key={line.id} line={line} onOpenDiff={onOpenDiff} />
        ),
      )}
      <ScrollAnchor token={token} />
    </div>
  );
}

function ScrollAnchor({ token }: { token: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    const scroller = node?.closest('[data-chat-scroll]') as HTMLElement | null;
    if (!scroller) {
      node?.scrollIntoView({ block: 'end' });
      return;
    }
    const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (gap < 96) scroller.scrollTop = scroller.scrollHeight;
  }, [token]);
  return <div ref={ref} />;
}

function UserLine({ line }: { line: ChatLine }): JSX.Element {
  return (
    <article className="user-turn">
      <p className="turn-kicker">
        You
        {line.held ? <span style={{ textTransform: 'none', letterSpacing: 0 }}>held</span> : null}
        {line.failed ? <span style={{ color: 'var(--st-fail)', textTransform: 'none' }}>failed</span> : null}
      </p>
      <p className="user-body" style={{ color: line.failed ? 'var(--st-fail)' : undefined, opacity: line.held ? 0.7 : 1 }}>
        {line.text}
      </p>
    </article>
  );
}

function AgentReport({
  line,
  onOpenDiff,
}: {
  line: ChatLine;
  onOpenDiff?: (taskId: string) => void;
}): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  const statusOnly = isAgentStatusLine(line.text);
  const name = AGENT_NAME[line.agentId] ?? line.agentId;

  useEffect(() => {
    if (!line.live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [line.live]);

  if (statusOnly) {
    const tone = { '--agent': agentColor(line.agentId) } as CSSProperties;
    return (
      <article className="agent-turn" style={tone}>
        <p className="turn-kicker">
          <AgentMark name={line.agentId} size={16} />
          <span className="agent-turn-name">{name}</span>
          {line.live ? <span className="agent-live" aria-label="Working" /> : null}
        </p>
        <p className="agent-response" style={{ color: 'var(--ink-2)' }}>{line.text}</p>
      </article>
    );
  }

  const end = line.endedAt ?? now;
  const duration =
    line.startedAt != null ? formatWorkDuration(line.startedAt, Math.max(end, line.startedAt)) : null;
  const statusPhrase = agentStatusPhrase(line.live, duration);
  const tone = { '--agent': agentColor(line.agentId) } as CSSProperties;
  const parts = partitionAgentText(line.text);

  return (
    <article className="agent-turn" style={tone}>
      <p className="turn-kicker">
        <AgentMark name={line.agentId} size={16} />
        <span className="agent-turn-name">{name}</span>
        {statusPhrase ? <span style={{ textTransform: 'none', letterSpacing: 0 }}>{statusPhrase}</span> : null}
        {line.live ? <span className="agent-live" aria-label="Working" /> : null}
        {line.failed ? <span style={{ color: 'var(--st-fail)', textTransform: 'none' }}>failed</span> : null}
      </p>
          {parts.activity.length > 0 && (
            <details className="agent-activity" open={line.live}>
              <summary>
                Activity · {parts.activity.length}
              </summary>
              <ul>
                {parts.activity.map((step, index) => (
                  <li key={`${line.id}-step-${index}`}>{step}</li>
                ))}
              </ul>
            </details>
          )}
          {parts.response ? (
            <div className="agent-response" style={{ color: line.failed ? 'var(--st-fail)' : undefined }}>
              {parts.response}
            </div>
          ) : null}
      {!line.failed && line.taskId !== 'draft' && !line.taskId.startsWith('pending-') ? (
        <ChangedFiles taskId={line.taskId} live={line.live} onOpenDiff={onOpenDiff} />
      ) : null}
    </article>
  );
}

function ChangedFiles({
  taskId,
  live,
  onOpenDiff,
}: {
  taskId: string;
  live: boolean;
  onOpenDiff?: (taskId: string) => void;
}): JSX.Element | null {
  const [stats, setStats] = useState<{ files: number; add: number; del: number } | null>(null);

  useEffect(() => {
    if (!taskId || taskId === 'draft') return;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const next = await api.taskChangesList({ taskId });
        if (cancelled) return;
        const files = next.files.length > 0 ? next.files : (next.outgoing?.files ?? []);
        if (files.length === 0) {
          setStats(null);
          return;
        }
        setStats({
          files: files.length,
          add: files.reduce((sum, file) => sum + file.insertions, 0),
          del: files.reduce((sum, file) => sum + file.deletions, 0),
        });
      } catch {
        if (!cancelled) setStats(null);
      }
    }
    void load();
    if (!live) return () => {
      cancelled = true;
    };
    const timer = window.setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [taskId, live]);

  if (!stats) return null;
  return (
    <div className="agent-changes">
      <span>
        {stats.files} changed {stats.files === 1 ? 'file' : 'files'}{' '}
        <b style={{ color: 'var(--st-live)', fontWeight: 600 }}>+{stats.add}</b>{' '}
        <b style={{ color: 'var(--st-fail)', fontWeight: 600 }}>-{stats.del}</b>
      </span>
      {onOpenDiff && (
        <button type="button" onClick={() => onOpenDiff(taskId)}>
          Open diff
        </button>
      )}
    </div>
  );
}
