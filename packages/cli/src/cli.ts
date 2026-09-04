#!/usr/bin/env node
import { resolve } from 'node:path';

import type { TaskStatus, TaskView } from '@osade/contract';

import { api, OsadeCliError } from './client.js';

/**
 * `osade` — the same surface for humans and agents (OSADE.md §17).
 *
 * Every call from an agent carries `OSADE_TASK_ID` from its environment, injected at lane
 * creation (§8.2 step 4), so writes are attributed and scoped without the caller asserting an
 * identity.
 */

/** §19.3 — the gutter glyph set is fixed-width and fixed-position, so it scans peripherally. */
const GLYPH: Record<TaskStatus, string> = {
  awaiting_approval: '⚑',
  needs_input: '⚑',
  review_changes_requested: '⚑',
  awaiting_review: '⚑',
  implementing: '●',
  verifying: '●',
  verify_failed: '✗',
  ci_failed: '✗',
  pr_open: '○',
  queued: '○',
  idle: '○',
  stopped: '○',
  merged: '✓',
  archived: '✓',
};

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

function renderRow(view: TaskView): string {
  const activity = view.agent?.activity_text ?? '';
  return [
    GLYPH[view.status],
    pad(view.status, 24),
    pad(view.task.id, 12),
    pad(view.task.title, 34),
    activity,
  ]
    .join(' ')
    .trimEnd();
}

function currentTaskId(explicit?: string): string {
  const id = explicit ?? process.env.OSADE_TASK_ID;
  if (!id) {
    throw new OsadeCliError(
      'no task id given and OSADE_TASK_ID is not set.\n' +
        'pass one explicitly, or run this from inside a task lane.',
    );
  }
  return id;
}

const HELP = `osade — run coding agents as open-source contributors

Usage:
  osade task list                          the ledger, needs-you first
  osade task create <repo> <title> [intent]  register a task (does not launch)
  osade task start <task-id>               run the launch sequence (§8.2)
  osade task show [task-id]                one task's facts and derived status
  osade task send [task-id] <text> [--wait]  prompt the agent
  osade task read [task-id] [--lines N]    the agent pane transcript
  osade task archive [task-id]

Task id defaults to $OSADE_TASK_ID, which is set inside every agent lane.
The daemon must be running: osade-daemon start
`;

async function main(argv: string[]): Promise<number> {
  const [group, command, ...rest] = argv;

  if (!group || group === 'help' || group === '--help' || group === '-h') {
    process.stdout.write(HELP);
    return 0;
  }

  if (group !== 'task') {
    process.stderr.write(`unknown command group: ${group}\n`);
    return 2;
  }

  switch (command) {
    case 'list': {
      const tasks = await api.taskList();
      if (tasks.length === 0) {
        process.stdout.write('no tasks yet — osade task create <repo> <title>\n');
        return 0;
      }
      const needsYou = tasks.filter((t) => t.needsYou);
      for (const view of tasks) {
        // One blank line between the needs-you set and everything else, so the boundary is
        // visible without a header (§19.4: nothing moves on its own, nothing shouts).
        if (needsYou.length > 0 && view === tasks[needsYou.length]) process.stdout.write('\n');
        process.stdout.write(renderRow(view) + '\n');
      }
      return 0;
    }

    case 'create': {
      const [repoPath, title, ...intentParts] = rest;
      if (!repoPath || !title) {
        process.stderr.write('usage: osade task create <repo> <title> [intent]\n');
        return 2;
      }
      const { taskId } = await api.taskCreate({
        repoPath: resolve(repoPath),
        title,
        intent: intentParts.join(' ') || title,
      });
      process.stdout.write(`${taskId}\n`);
      return 0;
    }

    case 'start': {
      const taskId = currentTaskId(rest[0]);
      const result = await api.taskLaunch(taskId);
      process.stdout.write(`${taskId} launched in ${result.workspaceId} pane ${result.paneId}\n`);
      return 0;
    }

    case 'show': {
      const view = await api.taskGet(currentTaskId(rest[0]));
      if (!view) {
        process.stderr.write('no such task\n');
        return 1;
      }
      process.stdout.write(
        [
          `${view.task.id}  ${view.task.title}`,
          `status       ${view.status}${view.needsYou ? '  (needs you)' : ''}`,
          `branch       ${view.task.branch}`,
          `base         ${view.task.base_sha} on ${view.task.base_ref}`,
          `worktree     ${view.task.worktree_path}`,
          `herdr        ${view.task.herdr_workspace_id ?? '—'} / ${view.agent?.herdr_pane_id ?? '—'}`,
          `agent state  ${view.agent?.herdr_state ?? '—'}  last event ${view.agent?.last_event ?? '—'}`,
          `activity     ${view.agent?.activity_text ?? '—'}`,
          `open gates   ${view.openGates.length}`,
          '',
        ].join('\n'),
      );
      return 0;
    }

    case 'send': {
      const wait = rest.includes('--wait');
      const args = rest.filter((a) => a !== '--wait');
      // `osade task send "text"` inside a lane, or `osade task send <id> "text"` outside it.
      const looksLikeId = args[0]?.startsWith('t_') === true;
      const taskId = currentTaskId(looksLikeId ? args[0] : undefined);
      const text = (looksLikeId ? args.slice(1) : args).join(' ');
      if (!text) {
        process.stderr.write('usage: osade task send [task-id] <text> [--wait]\n');
        return 2;
      }
      await api.taskSend(taskId, text, wait);
      process.stdout.write('sent\n');
      return 0;
    }

    case 'read': {
      const linesFlag = rest.indexOf('--lines');
      const lines = linesFlag >= 0 ? Number(rest[linesFlag + 1]) : undefined;
      const positional = rest.filter((a, i) => a !== '--lines' && i !== linesFlag + 1);
      const result = await api.taskTranscript(currentTaskId(positional[0]), lines);
      process.stdout.write(result.text.endsWith('\n') ? result.text : result.text + '\n');
      if (result.truncated) process.stderr.write('(truncated)\n');
      return 0;
    }

    case 'archive': {
      await api.taskArchive(currentTaskId(rest[0]));
      process.stdout.write('archived\n');
      return 0;
    }

    default:
      process.stderr.write(`unknown task command: ${command ?? '(none)'}\n`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== 0) process.exit(code);
  },
  (err: Error) => {
    process.stderr.write(`${err instanceof OsadeCliError ? err.message : err.stack}\n`);
    process.exit(1);
  },
);
