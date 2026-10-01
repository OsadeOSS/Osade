import type { ChatTurn, TaskView } from '@osade/contract';

import { stripNotesPrompt } from './quick-notes.js';
import { stripContextBlock } from './repo-context.js';

export interface ChatLine {
  id: string;
  role: 'user' | 'agent';
  agentId: string;
  taskId: string;
  text: string;
  live: boolean;
  held?: boolean;
  failed?: boolean;
  /** When this line was written. */
  at: number;
  /** When the turn that produced an agent line started. */
  startedAt?: number;
  endedAt?: number;
}

/** Strip the sibling-lane digest so it never shows up as a chat bubble. */
export function visibleUserText(text: string): string {
// `stripNotesPrompt` (#19) wraps the chain rather than joining it: the quick-note block is its
  // own tag and can be lifted out at either end, and it trims — which is what this chain used to
  // do itself.
  return stripNotesPrompt(
    stripContextBlock(text)
      .replace(/<osade_lanes>[\s\S]*?<\/osade_lanes>\s*/g, '')
      .replace(/<osade_collab>[\s\S]*?<\/osade_collab>\s*/g, '')
      .replace(/```photos\n[\s\S]*?```\s*/g, (block) => {
        const n = block
          .split('\n')
          .filter((line) => line.length > 0 && !line.startsWith('```')).length;
        return n > 0 ? `(${n} ${n === 1 ? 'photo' : 'photos'})\n` : '';
      })
      .replace(/The user pasted these photos\. Open each file and look at it\.\s*/g, ''),
  );
}

/**
 * Chat turns from the daemon's durable timeline — never from a pane scrape.
 *
 * A live agent line is overlaid from agent_fact while a turn is in flight; settled replies
 * are stored as agent turns when the pane goes quiet.
 */
export function chatLines(task: TaskView, followUps: readonly string[] = []): ChatLine[] {
  const agentId = task.agentId || 'claude';
  const turns = [...(task.turns ?? [])].sort((a, b) => a.seq - b.seq);
  const lines: ChatLine[] = [];

  if (turns.length === 0) {
    const intent = visibleUserText(task.task.intent);
    if (intent) {
      lines.push({
        id: `${task.task.id}-intent`,
        role: 'user',
        agentId,
        taskId: task.task.id,
        text: intent,
        live: false,
        at: task.task.created_at,
        startedAt: task.task.created_at,
      });
    }
    for (let i = 0; i < followUps.length; i++) {
      const text = visibleUserText(followUps[i] ?? '');
      if (!text || text === intent) continue;
      lines.push({
        id: `${task.task.id}-follow-${i}`,
        role: 'user',
        agentId,
        taskId: task.task.id,
        text,
        live: false,
        held: true,
        at: Date.now(),
      });
    }
    const live = agentOverlay(task);
    if (live) lines.push(live);
    return lines;
  }

  let lastUserAt = task.task.created_at;
  for (const turn of turns) {
    const text = turn.role === 'user' ? visibleUserText(turn.text) : turn.text.trim();
    if (!text) continue;
    if (turn.role === 'user') lastUserAt = turn.created_at;
    lines.push(lineFromTurn(turn, agentId, text, lastUserAt));
  }

  const seen = new Set(lines.filter((l) => l.role === 'user').map((l) => l.text));
  for (let i = 0; i < followUps.length; i++) {
    const text = visibleUserText(followUps[i] ?? '');
    if (!text || seen.has(text)) continue;
    seen.add(text);
    lines.push({
      id: `${task.task.id}-follow-${i}`,
      role: 'user',
      agentId,
      taskId: task.task.id,
      text,
      live: false,
      held: true,
      at: Date.now(),
    });
  }

  const lastTurn = turns.at(-1);
  const lastLine = lines.at(-1);
  const overlay =
    lastTurn?.role === 'user' || lastLine?.held ? agentOverlay(task) : lastTurn == null ? agentOverlay(task) : null;
  if (overlay && lastLine?.role === 'agent' && lastLine.text === overlay.text) return lines;
  if (overlay) lines.push(overlay);
  return lines;
}

function lineFromTurn(turn: ChatTurn, agentId: string, text: string, startedAt: number): ChatLine {
  const failed = turn.delivery === 'failed';
  return {
    id: turn.id,
    role: turn.role,
    agentId,
    taskId: turn.task_id,
    text: failed && turn.error ? `${text}\n${turn.error}` : text,
    live: turn.delivery === 'sending',
    held: turn.delivery === 'queued',
    failed,
    at: turn.created_at,
    startedAt: turn.role === 'agent' ? startedAt : turn.created_at,
    endedAt: turn.role === 'agent' ? turn.created_at : undefined,
  };
}

function agentOverlay(task: TaskView): ChatLine | null {
  const agentId = task.agentId || 'claude';
  const fact = task.agent;
  const streamed =
    fact?.stream_text?.trim() ||
    (task.output?.kind === 'partial_output' ? task.output.text?.trim() : '');
  const final =
    fact?.final_message?.trim() ||
    (task.output?.kind === 'final_output' ? task.output.text?.trim() : '');
  const spoken = streamed || final;
  const lastUser = [...(task.turns ?? [])].filter((t) => t.role === 'user').at(-1);
  const working = task.status === 'implementing' || task.status === 'verifying' || task.status === 'queued';
  if (spoken) {
    return {
      id: `${task.task.id}-agent-live`,
      role: 'agent',
      agentId,
      taskId: task.task.id,
      text: spoken,
      live: Boolean(streamed) && working,
      at: Date.now(),
      startedAt: lastUser?.created_at ?? task.task.created_at,
    };
  }
  const waiting =
    fact?.composer_ready !== true &&
    task.status !== 'implementing' &&
    task.status !== 'verifying' &&
    (lastUser?.delivery === 'queued' || ((task.turns ?? []).length === 0 && task.status === 'queued'));
  if (waiting) {
    return {
      id: `${task.task.id}-starting`,
      role: 'agent',
      agentId,
      taskId: task.task.id,
      text: `starting ${agentId}`,
      live: true,
      at: Date.now(),
      startedAt: lastUser?.created_at ?? task.task.created_at,
    };
  }
  if (working) {
    const reportedTool = fact?.tool_name?.trim() || (task.output?.kind === 'tool' ? task.output.tool : null);
    if (reportedTool && !fact?.activity_text?.trim() && !fact?.stream_text?.trim()) {
      return {
        id: `${task.task.id}-agent-live`,
        role: 'agent',
        agentId,
        taskId: task.task.id,
        text: `Using ${reportedTool}`,
        live: true,
        at: Date.now(),
        startedAt: lastUser?.created_at ?? task.task.created_at,
      };
    }
    const tool = reportedTool;
    const activity =
      task.output?.kind === 'activity' && task.output.text
        ? task.output.text
        : workingLabel(fact?.activity_text ?? '', agentId);
    const parts = [activity, tool ? `Using ${tool}` : ''].filter(Boolean);
    return {
      id: `${task.task.id}-agent-live`,
      role: 'agent',
      agentId,
      taskId: task.task.id,
      text: parts.join('\n'),
      live: true,
      at: Date.now(),
      startedAt: lastUser?.created_at ?? task.task.created_at,
    };
  }
  if (task.status === 'needs_input') {
    return {
      id: `${task.task.id}-agent-live`,
      role: 'agent',
      agentId,
      taskId: task.task.id,
      text: workingLabel(fact?.activity_text ?? '', agentId) || 'Waiting for you.',
      live: false,
      at: Date.now(),
      startedAt: lastUser?.created_at ?? task.task.created_at,
    };
  }
  return null;
}

function workingLabel(activity: string, agentId: string): string {
  const t = activity.trim();
  if (!t) return '…';
  if (t.toLowerCase() === (agentId || 'claude').toLowerCase()) return '…';
  if (/^claude(?:\s+code)?$/iu.test(t)) return '…';
  return t;
}
