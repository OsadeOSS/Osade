import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { platform } from 'node:os';

import { SUBSTRATE_PIN } from './generated/index.js';

/**
 * Where Osade's runtime sockets are — OSADE.md §2.1, §2.2.
 *
 * Osade names these, rather than reading them out of the runtime's own config directory. The
 * substrate takes its `SOCKET_PATH` and `CLIENT_SOCKET_PATH` variables as socket overrides —
 * named with the prefix the pin records, see `runtimeVariable` — and the supervisor passes
 * exactly these paths when it spawns the process. So the names, the
 * layout and the lifetime are Osade's.
 *
 * The practical gain is §2.2: the sockets live under `~/.osade/` with everything else, instead
 * of in a platform config directory belonging to another program. `rm -rf ~/.osade` really does
 * reset the system.
 *
 * On Unix these are unix domain sockets, mode 0600. On Windows they are **named pipes**: the
 * whole path string is mapped through `GenericNamespaced`, so a Node client connects to
 * `\\.\pipe\C:\…\osade.sock`. The path also exists on disk as a marker file — its presence does
 * not mean a server is listening, so always probe with `ping`.
 */

/** §2.2 — Osade runs the substrate on its own named session so it never collides. */
export const OSADE_SESSION = 'osade';

const WINDOWS_PIPE_PREFIX = '\\\\.\\pipe\\';

/** `~/.osade`, or wherever `OSADE_HOME` points. Absolute, because a relative root is a bug. */
export function osadeRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.OSADE_HOME ?? join(homedir(), '.osade'));
}

/** One directory per session, holding that session's sockets. */
export function runtimeDir(
  session: string = OSADE_SESSION,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(osadeRoot(env), 'runtime', session);
}

export function apiSocketPath(
  session: string = OSADE_SESSION,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.OSADE_SUBSTRATE_SOCKET ?? join(runtimeDir(session, env), 'osade.sock');
}

export function clientSocketPath(
  session: string = OSADE_SESSION,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.OSADE_SUBSTRATE_CLIENT_SOCKET ?? join(runtimeDir(session, env), 'osade-client.sock');
}

/**
 * The environment that puts the runtime's sockets where Osade expects them.
 *
 * Handed to the process at spawn. The variable names are the substrate's input contract, built
 * from the prefix the pin records rather than written out; everything they point at is Osade's.
 */
export function runtimeEnv(
  session: string = OSADE_SESSION,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return {
    [runtimeVariable('SESSION')]: session,
    [runtimeVariable('SOCKET_PATH')]: apiSocketPath(session, env),
    [runtimeVariable('CLIENT_SOCKET_PATH')]: clientSocketPath(session, env),
  };
}

/** One of the runtime's own environment variables, e.g. `runtimeVariable('STARTUP_CWD')`. */
export function runtimeVariable(name: string): string {
  return `${SUBSTRATE_PIN.envPrefix}_${name}`;
}

/** Translates a socket path into what `net.connect` needs on this platform. */
export function toConnectTarget(socketPath: string): string {
  if (platform() !== 'win32') return socketPath;
  if (socketPath.startsWith(WINDOWS_PIPE_PREFIX)) return socketPath;
  return WINDOWS_PIPE_PREFIX + socketPath;
}
