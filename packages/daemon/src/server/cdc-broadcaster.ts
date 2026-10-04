import type { ServerMessage, TaskView } from '@osade/contract';

import type { Db } from '../db/index.js';
import { currentWatermark } from '../db/index.js';
import { listTaskFacts } from '../db/task-repo.js';
import { toTaskView } from '../domain/task-view.js';

/**
 * OSADE.md §5.4 — INVARIANT: the one event path.
 *
 * A poller tails `change_log` with a watermark, decodes rows into typed events, and fans them
 * to websocket subscribers. **This module is the only place a websocket message is emitted.**
 * No service pushes directly. If the UI did not update, the mutation did not go through the
 * database, and adding an emit here is not the fix.
 *
 * Everything the client sees is derived at read time: `deriveStatus` runs per push, and no
 * status is ever stored (§6).
 */

export type Subscriber = (message: ServerMessage) => void;

/** Returned by `#view` when a task's read failed — distinct from "no such task" (`null`). */
const VIEW_FAILED = Symbol('view-failed');

export interface CdcBroadcasterOptions {
  /** How often to tail `change_log`. Cheap: an indexed range scan over an integer key. */
  intervalMs?: number;
  /** Injected so tests can drive time; defaults to `Date.now`. */
  now?: () => number;
  /**
   * Where a task read that failed is reported. A failed read must not take the daemon down; it
   * is reported and skipped. See `#view`.
   */
  onWarning?: (message: string) => void;
}

interface ChangeRow {
  seq: number;
  table_name: string;
  row_id: string;
  op: string;
}

export class CdcBroadcaster {
  readonly #db: Db;
  readonly #subscribers = new Set<Subscriber>();
  readonly #intervalMs: number;
  readonly #now: () => number;
  readonly #onWarning: (message: string) => void;
  #watermark: number;
  #timer: NodeJS.Timeout | null = null;

  constructor(db: Db, options: CdcBroadcasterOptions = {}) {
    this.#db = db;
    this.#intervalMs = options.intervalMs ?? 100;
    this.#now = options.now ?? Date.now;
    this.#onWarning = options.onWarning ?? (() => {});
    // Start at the current high-water mark: rows already in the log describe state the first
    // snapshot will carry anyway, so replaying them would only duplicate work.
    this.#watermark = currentWatermark(db);
  }

  get watermark(): number {
    return this.#watermark;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.tick(), this.#intervalMs);
    // A background poller must never hold the process open on its own.
    this.#timer.unref?.();
  }

  stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * Registers a subscriber and sends it a snapshot.
   *
   * §18.1 — the renderer is never the source of truth: on connect it discards local state and
   * takes whatever this returns.
   */
  subscribe(subscriber: Subscriber): () => void {
    // Take the snapshot *before* registering: if it throws, the subscriber is never added and
    // the connection handler can recover instead of holding a dangling registration.
    subscriber(this.snapshot());
    this.#subscribers.add(subscriber);
    return () => this.#subscribers.delete(subscriber);
  }

  snapshot(): ServerMessage {
    const tasks: TaskView[] = [];
    for (const facts of listTaskFacts(this.#db)) {
      const view = this.#view(facts.task.id);
      // A task we could not read is omitted rather than crashing the connection.
      if (view === VIEW_FAILED || view === null) continue;
      tasks.push(view);
    }
    return { type: 'snapshot', watermark: currentWatermark(this.#db), at: this.#now(), tasks };
  }

  /**
   * Drains `change_log` past the watermark and pushes one message per affected task.
   *
   * Exposed rather than private so tests can drive it deterministically instead of sleeping.
   * Returns the number of messages sent.
   */
  tick(): number {
    const rows = this.#db
      .prepare(
        `SELECT seq, table_name, row_id, op FROM change_log
          WHERE seq > ? ORDER BY seq LIMIT 1000`,
      )
      .all(this.#watermark) as ChangeRow[];

    if (rows.length === 0) return 0;

    // Several fact tables can change for one task in a single transaction; the client cares
    // about the task, so collapse to the latest seq per task and push once.
    const latestByTask = new Map<string, number>();
    for (const row of rows) {
      const prior = latestByTask.get(row.row_id);
      if (prior == null || row.seq > prior) latestByTask.set(row.row_id, row.seq);
    }

    this.#watermark = rows[rows.length - 1]!.seq;

    let sent = 0;
    for (const [taskId, seq] of latestByTask) {
      const view = this.#view(taskId);
      // A view we could not read is not a removed task: stay quiet rather than telling the
      // client to drop something it may still be showing.
      if (view === VIEW_FAILED) continue;
      const message: ServerMessage =
        view == null
          ? { type: 'task.removed', watermark: seq, taskId }
          : { type: 'task.upserted', watermark: seq, task: view };
      this.#emit(message);
      sent++;
    }
    return sent;
  }

  /** Tells every subscriber to discard local state and re-snapshot. */
  reset(reason: 'watermark_pruned' | 'poller_restarted'): void {
    this.#watermark = currentWatermark(this.#db);
    this.#emit({ type: 'stream.reset', watermark: this.#watermark, reason });
  }

  #emit(message: ServerMessage): void {
    for (const subscriber of this.#subscribers) subscriber(message);
  }

  /**
   * A task's view, `null` for a task that no longer exists, or `VIEW_FAILED` for a read that
   * threw.
   *
   * `snapshot()` runs inside the websocket connection handler, so before this guard a single
   * unreadable task killed the whole daemon: an auxiliary table missing from an incompatible
   * database (`no such table: chat_context`) threw straight through the socket handler. The
   * boot-time `assertSchemaCurrent` makes such a database loud; this is the belt to its braces,
   * covering a read that fails for any reason.
   */
  #view(taskId: string): TaskView | null | typeof VIEW_FAILED {
    try {
      return toTaskView(this.#db, taskId, this.#now());
    } catch (err) {
      this.#onWarning(
        `could not read task ${taskId} for the UI; skipping it: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return VIEW_FAILED;
    }
  }
}
