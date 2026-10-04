import type { TaskView } from '@osade/contract';

import type { WorkSource } from './api.js';

/** What the Files and Changes panels show: a chat lane's checkout, or a project's own folder. */
export interface WorkTarget {
  source: WorkSource;
  /** Identifies the checkout; a different key is a different folder, so views start fresh. */
  key: string;
  repoId: string;
  /** Changes whenever the contents may have (agent activity for a lane); a 2 s tick covers the rest. */
  stamp: string;
}

export function taskTarget(task: TaskView): WorkTarget {
  return {
    source: { taskId: task.task.id },
    key: `task:${task.task.id}`,
    repoId: task.task.repo_id,
    stamp: `${task.task.id}:${task.cwd}:${task.agent?.last_event_at ?? 0}:${task.status}`,
  };
}

/** A project's own checkout — what a terminal tab opened in that folder is working on. */
export function repoTarget(repoId: string): WorkTarget {
  return { source: { repoId }, key: `repo:${repoId}`, repoId, stamp: `repo:${repoId}` };
}
