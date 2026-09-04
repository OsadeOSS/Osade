import { mkdirSync } from 'node:fs';

import { openDb } from './db/index.js';
import { LaunchTask } from './domain/launch-task.js';
import { HerdrClient } from './herdr/client.js';
import { assertNoDrift, HerdrDriftError } from './herdr/drift-check.js';
import { HerdrEventSubscriber } from './herdr/event-subscriber.js';
import { osadePaths } from './paths.js';
import { startDaemonServer, type RunningDaemon } from './server/index.js';

/**
 * The daemon runtime.
 *
 * OSADE.md §20.1 — this module is a library, not a script: no `console.*` and no
 * `process.exit`. `cli.ts` owns both, and is deliberately kept off this import graph so a
 * short-lived subcommand does not eagerly load the whole server stack.
 */

export interface StartDaemonOptions {
  /** Path to the herdr binary the drift check runs against (§4.1.1). */
  herdrBinary?: string;
  /** Skip the boot drift check. Tests only — never in a shipped path. */
  skipDriftCheck?: boolean;
  port?: number;
  now?: () => number;
  onWarning?: (message: string) => void;
  onInfo?: (message: string) => void;
}

export interface Daemon extends RunningDaemon {
  readonly dbPath: string;
}

export async function startDaemon(options: StartDaemonOptions = {}): Promise<Daemon> {
  const paths = osadePaths();
  const onWarning = options.onWarning ?? (() => {});
  const onInfo = options.onInfo ?? (() => {});

  // §2.2 — everything under ~/.osade, created before anything touches disk.
  for (const dir of [paths.root, paths.logsDir, paths.runsDir, paths.reviewDir, paths.skillsDir]) {
    mkdirSync(dir, { recursive: true });
  }

  // §4.1.1 — the boot drift check runs before the first API call. Fatal on protocol or a
  // missing pinned method; a superset only warns, or every herdr upgrade is an outage.
  if (!options.skipDriftCheck) {
    try {
      const result = await assertNoDrift(options.herdrBinary ?? 'herdr');
      if (result.ok) onInfo(result.message);
      else onWarning(result.message);
    } catch (err) {
      if (err instanceof HerdrDriftError) throw err;
      throw err;
    }
  }

  const db = openDb(paths.db);
  const herdr = new HerdrClient();
  const subscriber = new HerdrEventSubscriber(db, herdr, { now: options.now, onWarning });
  const launcher = new LaunchTask(db, herdr, subscriber, { now: options.now, onWarning });

  // A herdr that is not running is not an error at boot: agents survive the app, but the app
  // also has to start when nothing is running yet. The subscriber reconciles when it can.
  await subscriber.start().catch((err: Error) => {
    onWarning(`herdr event subscriber did not start: ${err.message}`);
  });

  const server = await startDaemonServer({
    db,
    launcher,
    port: options.port,
    now: options.now,
    onWarning,
  });

  onInfo(`osade daemon listening on 127.0.0.1:${server.port}`);

  return {
    ...server,
    dbPath: paths.db,
    async close() {
      subscriber.stop();
      await server.close();
      db.close();
    },
  };
}

export { osadePaths } from './paths.js';
export type { AppRouter } from './server/router.js';
