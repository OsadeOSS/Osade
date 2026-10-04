import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import { WebSocketServer, type WebSocket } from 'ws';

import { ClientMessage, type ServerMessage } from '@osade/contract';

import type { Db } from '../db/index.js';
import { pruneChangeLog } from '../db/index.js';
import type { Gates } from '../domain/gates.js';
import type { LaunchTask } from '../domain/launch-task.js';
import type { Knowledge } from '../knowledge/service.js';
import type { HeadlessRuns } from '../domain/headless-run.js';
import type { Triage } from '../domain/triage.js';
import type { VerifyRunner } from '../domain/verify-run.js';
import type { ScmPoller } from '../scm/poller.js';
import type { ScmWrites } from '../scm/writes.js';
import { osadePaths } from '../paths.js';
import { TaskShells } from '../domain/task-shell.js';
import { CdcBroadcaster } from './cdc-broadcaster.js';
import { appRouter, type DaemonContext } from './router.js';

/**
 * The daemon's HTTP + websocket surface.
 *
 * OSADE.md §2.1 — INVARIANT: binds `127.0.0.1` only. No `0.0.0.0` listener in v1, and there is
 * no remote mode. The port is written to `~/.osade/daemon.port` so the CLI and the Electron
 * app can find it without a fixed port collision.
 *
 * §5.4 — the websocket carries only what `CdcBroadcaster` produces. This module wires the
 * socket; it never composes a message itself.
 */

const LOOPBACK = '127.0.0.1';
const CHANGE_LOG_PRUNE_INTERVAL_MS = 5 * 60_000;

export interface DaemonServerOptions {
  db: Db;
  launcher: LaunchTask;
  gates: Gates;
  verifier: VerifyRunner;
  triage: Triage;
  scmWrites: ScmWrites;
  poller: ScmPoller;
  /** §13 — absent when no model is configured. Mining is optional; everything else is not. */
  knowledge?: Knowledge | null;
  headless?: HeadlessRuns | null;
  /** 0 asks the OS for a free port, which is the default and what the port file is for. */
  port?: number;
  now?: () => number;
  onWarning?: (message: string) => void;
}

export interface RunningDaemon {
  readonly port: number;
  readonly broadcaster: CdcBroadcaster;
  close(): Promise<void>;
}

export async function startDaemonServer(options: DaemonServerOptions): Promise<RunningDaemon> {
  const { db, launcher } = options;
  const now = options.now ?? Date.now;
  const onWarning = options.onWarning ?? (() => {});
  const shells = new TaskShells({ historyDir: osadePaths().terminalsDir });

  const broadcaster = new CdcBroadcaster(db, { now, onWarning });
  broadcaster.start();

  const context: DaemonContext = {
    db,
    launcher,
    gates: options.gates,
    verifier: options.verifier,
    triage: options.triage,
    scmWrites: options.scmWrites,
    poller: options.poller,
    shells,
    knowledge: options.knowledge ?? null,
    headless: options.headless ?? null,
    now,
  };
  const trpcHandler = createHTTPHandler({
    router: appRouter,
    createContext: () => context,
  });

  const http: Server = createServer((req, res) => {
    // The renderer is a file:// origin under Electron, so CORS is permissive — but only
    // loopback can reach this listener at all, which is the actual boundary (§2.1).
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({ ok: true, build: runningBuildId() }),
      );
      return;
    }
    trpcHandler(req, res);
  });

  const wss = new WebSocketServer({ server: http, path: '/ws' });

  wss.on('connection', (socket: WebSocket) => {
    const send = (message: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    // §18.1 — the renderer discards local state on connect and takes the snapshot. A read that
    // fails must not escape this handler: an uncaught throw here reaches the process, not the
    // socket. Report it and close the connection; the renderer reconnects and retries.
    let unsubscribe: () => void;
    try {
      unsubscribe = broadcaster.subscribe(send);
    } catch (err) {
      onWarning(`websocket: snapshot failed on connect: ${(err as Error).message}`);
      socket.close();
      return;
    }

    socket.on('message', (raw) => {
      const parsed = ClientMessage.safeParse(safeJson(raw.toString()));
      if (!parsed.success) {
        onWarning(`websocket: dropped malformed client message`);
        return;
      }
      // `hello` is the only client message in M0; re-snapshot on request.
      if (parsed.data.type === 'hello') send(broadcaster.snapshot());
    });

    socket.on('close', () => unsubscribe());
    socket.on('error', () => unsubscribe());
  });

  const port = await listen(http, options.port ?? 0);

  const paths = osadePaths();
  mkdirSync(dirname(paths.portFile), { recursive: true });
  writeFileSync(paths.portFile, String(port));
  writeFileSync(paths.pidFile, String(process.pid));

  // §5.4 — retain the last 50k change_log rows; prune on a timer.
  const pruneTimer = setInterval(() => {
    try {
      pruneChangeLog(db);
    } catch (err) {
      onWarning(`change_log prune failed: ${(err as Error).message}`);
    }
  }, CHANGE_LOG_PRUNE_INTERVAL_MS);
  pruneTimer.unref?.();

  let closed = false;
  return {
    port,
    broadcaster,
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(pruneTimer);
      shells.closeAll();
      broadcaster.stop();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
      rmSync(paths.portFile, { force: true });
      rmSync(paths.pidFile, { force: true });
    },
  };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK, () => {
      const address = server.address();
      if (address == null || typeof address === 'string') {
        reject(new Error('daemon did not bind a TCP port'));
        return;
      }
      resolve(address.port);
    });
  });
}

/** Contents of the running entry (`dist/cli.js` when spawned). Desktop refuses to adopt a mismatch. */
function runningBuildId(): string {
  const fromEnv = process.env.OSADE_DAEMON_BUILD;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  try {
    const path = process.argv[1];
    if (!path) return '';
    return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
  } catch {
    return '';
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export { appRouter } from './router.js';
export type { AppRouter } from './router.js';
export { CdcBroadcaster } from './cdc-broadcaster.js';
