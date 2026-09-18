import { describe, expect, it } from 'vitest';

import type { TaskView } from '@osade/contract';

import { agentColor } from '../src/renderer/agent-color.js';
import { lanePrompt, parseMentions } from '../src/renderer/mentions.js';
import { groupChats, laneDigest, worstStatus } from '../src/renderer/lanes.js';

describe('parseMentions', () => {
  const catalog = ['claude', 'codex', 'opencode', 'pi'];

  it('bare text addresses no agents — the caller sends it to the primary lane', () => {
    expect(parseMentions('refactor the token refresh', catalog)).toEqual({
      shared: 'refactor the token refresh',
      targets: [],
    });
  });

  it('mentions only count at the start of a line', () => {
    const parsed = parseMentions(
      ['please look at auth', '@claude refactor the token refresh', '@codex write tests for it'].join(
        '\n',
      ),
      catalog,
    );
    expect(parsed.shared).toBe('please look at auth');
    expect(parsed.targets).toEqual([
      { agentId: 'claude', text: 'refactor the token refresh' },
      { agentId: 'codex', text: 'write tests for it' },
    ]);
  });

  it('an @ in the middle of a line is not a mention', () => {
    expect(parseMentions('ping @claude later', catalog).targets).toEqual([]);
  });

  it('unknown ids are left in the shared text', () => {
    const parsed = parseMentions('@ghost do a thing\n@claude real work', catalog);
    expect(parsed.shared).toBe('@ghost do a thing');
    expect(parsed.targets).toEqual([{ agentId: 'claude', text: 'real work' }]);
  });

  it('a mention and its task on the same line is one target', () => {
    expect(parseMentions('@claude do this task', catalog)).toEqual({
      shared: '',
      targets: [{ agentId: 'claude', text: 'do this task' }],
    });
  });

  it('lanePrompt never sends an empty string for @claude plus a task', () => {
    const parsed = parseMentions('@claude do this task', catalog);
    expect(lanePrompt(parsed, parsed.targets[0]!, '@claude do this task')).toBe('do this task');
  });
});

describe('laneDigest', () => {
  it('omits the block when there is one lane', () => {
    expect(laneDigest(view('claude'), [view('claude')])).toBeNull();
  });

  it('facts only, capped, never a transcript', () => {
    const self = view('claude', { lastEventAt: 100 });
    const sibling = view('codex', {
      id: 't2',
      branch: 'osade/token-refresh/codex',
      status: 'implementing',
      lastEventAt: 200,
      checks: 'success',
    });
    const block = laneDigest(self, [self, sibling]);
    expect(block).toContain('<osade_lanes>');
    expect(block).toContain('codex on osade/token-refresh/codex');
    expect(block).not.toContain('full dump');
    expect(block!.trim().split('\n').length).toBeLessThanOrEqual(8);
  });
});

describe('worstStatus', () => {
  it('needs-you outranks working', () => {
    expect(worstStatus(['implementing', 'needs_input', 'queued'])).toBe('needs_input');
  });
});

describe('agentColor', () => {
  it('does not throw when the snapshot has no agentId yet', () => {
    expect(agentColor(undefined)).toMatch(/^var\(--ag-/);
    expect(agentColor('claude')).toBe('var(--ag-claude)');
  });
});

describe('groupChats', () => {
  it('groups a pre-lane snapshot that has no chatId', () => {
    const grouped = groupChats([view('claude', { skipChatId: true })]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.chatId).toBe('t1');
  });
});

function view(
  agentId: string,
  over: {
    id?: string;
    branch?: string;
    status?: TaskView['status'];
    lastEventAt?: number;
    checks?: NonNullable<TaskView['scm']>['checks_state'];
    skipChatId?: boolean;
  } = {},
): TaskView {
  const taskId = over.id ?? 't1';
  return {
    task: {
      id: taskId,
      repo_id: 'r1',
      chat_id: over.skipChatId ? (undefined as unknown as string) : 'c1',
      title: 'Token refresh',
      intent: 'x',
      origin_kind: 'manual',
      origin_ref: null,
      agent_id: agentId,
      base_ref: 'main',
      base_sha: 'abc',
      branch: over.branch ?? `osade/token-refresh/${agentId}`,
      worktree_path: '/wt',
      substrate_workspace_id: null,
      archived_at: null,
      created_at: 1,
    },
    status: over.status ?? 'queued',
    agent:
      over.lastEventAt == null
        ? null
        : {
            task_id: over.id ?? 't1',
            substrate_pane_id: null,
            substrate_state: 'working',
            last_event: 'activity',
            last_event_at: over.lastEventAt,
            activity_text: null,
            tool_name: null,
            final_message: null,
            agent_session_id: null,
            pane_alive: true,
            last_probe_at: null,
            probe_failures: 0,
            terminated: false,
            external_block: null,
            state_change_seq: 1,
            controller_generation: 0,
          },
    scm:
      over.checks == null
        ? null
        : {
            task_id: over.id ?? 't1',
            pr_number: null,
            pr_url: null,
            pr_state: null,
            pr_head_sha: null,
            pr_draft: null,
            checks_state: over.checks,
            review_state: null,
            unresolved_threads: 0,
            mergeable: null,
            fetched_at: 1,
            fetch_failed_at: null,
          },
    openGates: [],
    latestVerifyRuns: [],
    needsYou: false,
    chatId: over.skipChatId ? (undefined as unknown as string) : 'c1',
    agentId: over.skipChatId ? (undefined as unknown as string) : agentId,
    attachment: 'worktree',
    branch: over.branch ?? `osade/token-refresh/${agentId}`,
    cwd: '/wt',
  };
}
