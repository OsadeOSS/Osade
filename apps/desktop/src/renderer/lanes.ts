import { isOrchestratorId, type TaskStatus, type TaskView } from '@osade/contract';

import { SORT_RANK } from './status.js';

export interface ChatGroup {
  chatId: string;
  title: string;
  lanes: TaskView[];
  status: TaskStatus;
  needsYou: boolean;
}

export function groupChats(tasks: TaskView[]): ChatGroup[] {
  const map = new Map<string, TaskView[]>();
  for (const task of tasks) {
    const id = task.chatId || task.task.chat_id || task.task.id;
    const list = map.get(id) ?? [];
    list.push(task);
    map.set(id, list);
  }
  return [...map.values()].map((lanes) => {
    const ordered = [...lanes].sort((a, b) => a.task.created_at - b.task.created_at);
    const first = ordered[0]!;
    return {
      chatId: first.chatId || first.task.chat_id || first.task.id,
      title: first.task.title,
      lanes: ordered,
      status: worstStatus(ordered.map((l) => l.status)),
      needsYou: ordered.some((l) => l.needsYou),
    };
  });
}

export function showPinnedNeedsYou(needsCount: number, visibleCount: number): boolean {
  return needsCount > 0 && needsCount !== visibleCount;
}

export function primaryLane(chat: ChatGroup): TaskView {
  return chat.lanes[0]!;
}

export function chatLabel(chat: Pick<ChatGroup, 'chatId' | 'title'>): string {
  return isOrchestratorId(chat.chatId) ? 'Plan' : chat.title;
}

/**
 * Sidebar branch label. Isolated lanes are `osade/<slug>/<agent>`; the prefix is the same on
 * every row, so only the tail is shown. Attached checkouts (`main`, `feat/…`) pass through.
 */
export function displayBranch(branch: string): string {
  const nested = /^osade\/[^/]+\/(.+)$/.exec(branch);
  if (nested?.[1]) return nested[1];
  if (branch.startsWith('osade/')) return branch.slice('osade/'.length);
  return branch;
}

/** Two-letter mark for a sidebar avatar. */
export function agentInitials(agentId: string): string {
  const parts = agentId.split(/[-_\s]+/u).filter((part) => part.length > 0);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
  }
  const compact = agentId.replace(/[^a-z0-9]/giu, '');
  return (compact.slice(0, 2) || '?').toUpperCase();
}

export type BoardColumnId = 'needs' | 'working' | 'failed' | 'review' | 'ready' | 'rest';

export const BOARD_COLUMNS: { id: BoardColumnId; label: string }[] = [
  { id: 'needs', label: 'Needs you' },
  { id: 'working', label: 'Working' },
  { id: 'failed', label: 'Failed' },
  { id: 'review', label: 'In review' },
  { id: 'ready', label: 'Ready to merge' },
  { id: 'rest', label: 'The rest' },
];

/** Derived placement — never a stored status. */
export function boardColumn(chat: ChatGroup): BoardColumnId {
  if (chat.needsYou) return 'needs';
  if (chat.status === 'implementing' || chat.status === 'verifying') return 'working';
  if (chat.status === 'verify_failed' || chat.status === 'ci_failed' || chat.status === 'blocked_external')
    return 'failed';
  if (chat.status === 'pr_open') return 'review';
  if (chat.status === 'merged') return 'ready';
  return 'rest';
}

export function boardGroups(chats: ChatGroup[]): Record<BoardColumnId, ChatGroup[]> {
  const out: Record<BoardColumnId, ChatGroup[]> = {
    needs: [],
    working: [],
    failed: [],
    review: [],
    ready: [],
    rest: [],
  };
  for (const chat of chats) out[boardColumn(chat)].push(chat);
  for (const col of BOARD_COLUMNS) out[col.id].sort((a, b) => chatActivity(b) - chatActivity(a));
  return out;
}

/** Latest activity across a chat's lanes — most recent first on the board. */
export function chatActivity(chat: ChatGroup): number {
  let latest = 0;
  for (const lane of chat.lanes) {
    const at = lane.agent?.last_event_at ?? lane.task.created_at;
    if (at > latest) latest = at;
  }
  return latest;
}

export function worstStatus(statuses: TaskStatus[]): TaskStatus {
  let best: TaskStatus = statuses[0] ?? 'queued';
  let bestRank = SORT_RANK[best];
  for (const status of statuses) {
    const rank = SORT_RANK[status];
    if (rank < bestRank) {
      best = status;
      bestRank = rank;
    }
  }
  return best;
}

export function laneDigest(self: TaskView, lanes: TaskView[]): string | null {
  const siblings = lanes.filter((lane) => lane.task.id !== self.task.id);
  if (siblings.length === 0) return null;

  const since = self.agent?.last_event_at ?? 0;
  const lines: string[] = [];
  for (const lane of siblings) {
    if (lines.length >= 6) break;
    const at = lane.agent?.last_event_at ?? lane.task.created_at;
    if (at < since) continue;
    lines.push(`- ${lane.agentId} on ${lane.task.branch}: ${digestLine(lane)}`);
  }
  if (lines.length === 0) return null;
  return ['<osade_lanes>', 'Other agents in this chat, since your last turn:', ...lines, '</osade_lanes>'].join(
    '\n',
  );
}

function digestLine(lane: TaskView): string {
  const bits: string[] = [lane.status.replace(/_/g, ' ')];
  if (lane.scm?.checks_state === 'success') bits.push('checks passing');
  if (lane.scm?.checks_state === 'failure') bits.push('checks failing');
  if (lane.latestVerifyRuns.some((r) => r.finished_at == null)) bits.push('verifying');
  const failed = lane.latestVerifyRuns.some((r) => r.required && r.exit_code != null && r.exit_code !== 0);
  if (failed) bits.push('verify failed');
  return bits.join(', ');
}

export function withDigest(text: string, digest: string | null): string {
  if (digest == null) return text;
  return `${digest}\n\n${text}`;
}
