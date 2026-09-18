import { resolve } from 'node:path';

import type { TaskStatus, TaskView } from '@osade/contract';

import { api, OsadeCliError } from './client.js';
import { looksLikePath, openRepo } from './open.js';

/**
 * `osade` — the same surface for humans and agents (OSADE.md §17).
 *
 * Every call from an agent carries `OSADE_TASK_ID` from its environment, injected at lane
 * creation (§8.2 step 4), so writes are attributed and scoped without the caller asserting an
 * identity.
 */

/**
 * Where output goes.
 *
 * Injected rather than reached for, so `main` can be driven by a test that reads what a user
 * would have seen. §17's claim is that an orchestrating agent and a human drive the *same*
 * surface — a CLI whose behaviour is only observable by running a subprocess is one where that
 * claim goes unchecked.
 */
export interface Io {
  out(text: string): void;
  err(text: string): void;
}

export const processIo: Io = {
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
};

/** §19.3 — the gutter glyph set is fixed-width and fixed-position, so it scans peripherally. */
const GLYPH: Record<TaskStatus, string> = {
  awaiting_approval: '⚑',
  needs_input: '⚑',
  review_changes_requested: '⚑',
  awaiting_review: '⚑',
  implementing: '●',
  verifying: '●',
  verify_failed: '✗',
  blocked_external: '✗',
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

/** Command groups, so a bare word is never mistaken for a directory of the same name. */
const GROUPS = ['task', 'help'];

const HELP = `osade — run coding agents as open-source contributors

Usage:
  osade .                                  open the window on this repository
  osade <path>                             open the window on a repository

  osade task list                          the ledger, needs-you first
  osade task create <repo> <title> [intent]  register a task (does not launch)
  osade task start <task-id>               run the launch sequence (§8.2)
  osade task show [task-id]                one task's facts and derived status
  osade task send [task-id] <text> [--wait]  prompt the agent
  osade task read [task-id] [--lines N]    the agent pane transcript
  osade task archive [task-id]

Task id defaults to $OSADE_TASK_ID, which is set inside every agent lane.
osade . opens the window and does not wait; task verbs need a running daemon.
`;

export async function main(argv: string[], io: Io = processIo): Promise<number> {
  const [group, command, ...rest] = argv;

  if (!group || group === 'help' || group === '--help' || group === '-h') {
    io.out(HELP);
    return 0;
  }

  // `osade .` and `osade <path>` — the shape people already know from `code .`.
  if (looksLikePath(group, GROUPS)) return openRepo(group, io);

  if (group !== 'task') {
    io.err(`unknown command: ${group}\n  try: osade help, or osade . to open this repository\n`);
    return 2;
  }

  switch (command) {
    case 'list': {
      const tasks = await api.taskList();
      if (tasks.length === 0) {
        io.out('no tasks yet — osade task create <repo> <title>\n');
        return 0;
      }
      const needsYou = tasks.filter((t) => t.needsYou);
      for (const view of tasks) {
        // One blank line between the needs-you set and everything else, so the boundary is
        // visible without a header (§19.4: nothing moves on its own, nothing shouts).
        if (needsYou.length > 0 && view === tasks[needsYou.length]) io.out('\n');
        io.out(renderRow(view) + '\n');
      }
      return 0;
    }

    case 'create': {
      const [repoPath, title, ...intentParts] = rest;
      if (!repoPath || !title) {
        io.err('usage: osade task create <repo> <title> [intent]\n');
        return 2;
      }
      const { taskId } = await api.taskCreate({
        repoPath: resolve(repoPath),
        title,
        intent: intentParts.join(' ') || title,
      });
      io.out(`${taskId}\n`);
      return 0;
    }

    case 'start': {
      const taskId = currentTaskId(rest[0]);
      const result = await api.taskLaunch(taskId);
      io.out(`${taskId} launched in ${result.workspaceId} pane ${result.paneId}\n`);
      return 0;
    }

    case 'show': {
      const view = await api.taskGet(currentTaskId(rest[0]));
      if (!view) {
        io.err('no such task\n');
        return 1;
      }
      io.out(
        [
          `${view.task.id}  ${view.task.title}`,
          `status       ${view.status}${view.needsYou ? '  (needs you)' : ''}`,
          `branch       ${view.task.branch}`,
          `base         ${view.task.base_sha} on ${view.task.base_ref}`,
          `cwd          ${view.cwd}  (${view.attachment})`,
          `substrate    ${view.task.substrate_workspace_id ?? '—'} / ${view.agent?.substrate_pane_id ?? '—'}`,
          `agent state  ${view.agent?.substrate_state ?? '—'}  last event ${view.agent?.last_event ?? '—'}`,
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
        io.err('usage: osade task send [task-id] <text> [--wait]\n');
        return 2;
      }
      await api.taskSend(taskId, text, wait);
      io.out('sent\n');
      return 0;
    }

    case 'read': {
      const linesFlag = rest.indexOf('--lines');

      let lines: number | undefined;
      if (linesFlag >= 0) {
        // Validated here rather than sent onward: `--lines` with nothing after it used to reach
        // the daemon as NaN and come back as a schema error about a field the user never named.
        const parsed = Number(rest[linesFlag + 1]);
        if (!Number.isInteger(parsed) || parsed < 1) {
          io.err('usage: osade task read [task-id] [--lines N]   (N: a positive integer)\n');
          return 2;
        }
        lines = parsed;
      }

      // Skip by *index*, not by value. Filtering on `i !== linesFlag + 1` dropped argument 0 —
      // the task id — whenever `--lines` was absent and `indexOf` returned -1, so
      // `osade task read <id>` silently read whatever `$OSADE_TASK_ID` pointed at instead.
      const skip = linesFlag >= 0 ? new Set([linesFlag, linesFlag + 1]) : new Set<number>();
      const positional = rest.filter((_, i) => !skip.has(i));

      const result = await api.taskTranscript(currentTaskId(positional[0]), lines);
      io.out(result.text.endsWith('\n') ? result.text : result.text + '\n');
      if (result.truncated) io.err('(truncated)\n');
      return 0;
    }

    case 'archive': {
      await api.taskArchive(currentTaskId(rest[0]));
      io.out('archived\n');
      return 0;
    }

    default:
      io.err(`unknown task command: ${command ?? '(none)'}\n`);
      return 2;
  }
}
