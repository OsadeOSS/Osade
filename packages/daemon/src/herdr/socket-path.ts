import { homedir, platform } from 'node:os';
import { join } from 'node:path';

/**
 * Resolving herdr's sockets — HERDR-CONTRACT.md §2.1, OSADE.md §2.1.
 *
 * On Unix these are real unix domain sockets, mode 0600. On Windows they are **named pipes**:
 * `interprocess` maps the whole path string through `GenericNamespaced`, so a Node client
 * connects to `\\.\pipe\C:\…\herdr.sock`. The `.sock` path also exists on disk as a marker
 * file — its presence does not mean a server is listening, so always probe with `ping`.
 */

/** OSADE.md §2.2 — Osade runs herdr on its own named session so it never collides. */
export const OSADE_SESSION = 'osade';

const WINDOWS_PIPE_PREFIX = '\\\\.\\pipe\\';

/** herdr's config dir, which is herdr's business rather than ours (§2.2). */
export function herdrConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.HERDR_CONFIG_DIR;
  if (explicit) return explicit;

  if (platform() === 'win32') {
    const appData = env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'herdr');
  }
  const xdg = env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, 'herdr') : join(homedir(), '.config', 'herdr');
}

/**
 * The data directory for a session.
 *
 * `default` is treated as "no name" by herdr (`backend/src/session.rs:99`), so it maps to the
 * config root rather than to `sessions/default`.
 */
export function herdrSessionDir(
  session: string = OSADE_SESSION,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = herdrConfigDir(env);
  if (session === 'default') return root;
  return join(root, 'sessions', session);
}

export function herdrApiSocketPath(
  session: string = OSADE_SESSION,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.HERDR_SOCKET_PATH;
  if (override) return override;
  return join(herdrSessionDir(session, env), 'herdr.sock');
}

export function herdrClientSocketPath(
  session: string = OSADE_SESSION,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(herdrSessionDir(session, env), 'herdr-client.sock');
}

/** Translates a herdr socket path into what `net.connect` needs on this platform. */
export function toConnectTarget(socketPath: string): string {
  if (platform() !== 'win32') return socketPath;
  if (socketPath.startsWith(WINDOWS_PIPE_PREFIX)) return socketPath;
  return WINDOWS_PIPE_PREFIX + socketPath;
}
