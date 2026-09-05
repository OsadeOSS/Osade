import { spawn } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import * as net from 'node:net';

/**
 * Locate, adopt or spawn the herdr server — OSADE.md §18.1.
 *
 * Osade runs herdr on its own named session (`osade`) so it never collides with the user's own
 * (§2.2). Verified live: two sessions run concurrently with separate sockets, separate
 * `session.json`, and no interference.
 */

export const OSADE_SESSION = 'osade';

function herdrConfigDir(): string {
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'herdr');
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, 'herdr') : join(homedir(), '.config', 'herdr');
}

export function herdrSocketPath(session = OSADE_SESSION): string {
  return join(herdrConfigDir(), 'sessions', session, 'herdr.sock');
}

function connectTarget(socketPath: string): string {
  return platform() === 'win32' ? `\\\\.\\pipe\\${socketPath}` : socketPath;
}

/**
 * A `ping` round trip.
 *
 * On Windows the `.sock` path exists on disk as a marker file even with no server listening,
 * so file existence proves nothing and this is the only real liveness check.
 */
export function ping(socketPath: string, timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(connectTarget(socketPath));
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.on('connect', () =>
      socket.write(`${JSON.stringify({ id: 'osade:ping', method: 'ping', params: {} })}\n`),
    );
    socket.on('data', (chunk: Buffer) => finish(chunk.toString().includes('"pong"')));
    socket.on('error', () => finish(false));
    socket.on('end', () => finish(false));
  });
}

export interface HerdrSupervisorOptions {
  binary?: string;
  session?: string;
  onInfo?: (message: string) => void;
}

/**
 * Adopts a running herdr server, or spawns one detached.
 *
 * The spawn copies herdr's own recipe (`backend/src/server/autodetect.rs:188-233`): null
 * stdio, and detached from this process. Without that the server dies with the app, and
 * "agents survive the window closing" quietly stops being true.
 *
 * `HERDR_STARTUP_CWD` is removed deliberately: when it is set and the session has no
 * workspaces, herdr creates one at that cwd on boot and Osade inherits a stray workspace it
 * never asked for.
 */
export async function adoptOrSpawnHerdr(options: HerdrSupervisorOptions = {}): Promise<{
  socketPath: string;
  spawned: boolean;
}> {
  const session = options.session ?? OSADE_SESSION;
  const socketPath = herdrSocketPath(session);
  const onInfo = options.onInfo ?? (() => {});

  if (await ping(socketPath)) {
    onInfo(`adopted the running herdr server on session "${session}"`);
    return { socketPath, spawned: false };
  }

  const env: NodeJS.ProcessEnv = { ...process.env, HERDR_SESSION: session };
  delete env.HERDR_STARTUP_CWD;

  const child = spawn(options.binary ?? 'herdr', ['server'], {
    env,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });
  // Let it outlive us. Agents must survive the app quitting (§18.1).
  child.unref();

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await ping(socketPath, 1_000)) {
      onInfo(`spawned a detached herdr server on session "${session}"`);
      return { socketPath, spawned: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `herdr did not start within 20s on session "${session}" (socket ${socketPath}).\n` +
      `Check that the herdr binary is on PATH.`,
  );
}
