import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Spawn and adopt the Osade daemon — OSADE.md §18.1.
 *
 * The daemon owns tasks, gates, verification and the GitHub poller, and it must survive the
 * window closing exactly as herdr does: agents keep running, and half the system does not die
 * because someone closed a window.
 */

export function osadeRoot(): string {
  return process.env.OSADE_HOME ?? join(homedir(), '.osade');
}

function portFile(): string {
  return join(osadeRoot(), 'daemon.port');
}

async function health(port: number, timeoutMs = 1_500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // §2.1 — loopback only. There is no remote mode.
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

function readPort(): number | null {
  try {
    const port = Number(readFileSync(portFile(), 'utf8').trim());
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export interface DaemonSupervisorOptions {
  /** Node entry for the daemon CLI. */
  entry: string;
  onInfo?: (message: string) => void;
}

export interface AdoptedDaemon {
  port: number;
  child: ChildProcess | null;
}

/**
 * Adopts a healthy daemon, or spawns one and waits for its ready handshake.
 *
 * The handshake is the port file plus a `/health` round trip — **never a fixed sleep** (§18.1).
 * A stale port file from a crashed daemon is removed rather than trusted.
 */
export async function adoptOrSpawnDaemon(
  options: DaemonSupervisorOptions,
): Promise<AdoptedDaemon> {
  const onInfo = options.onInfo ?? (() => {});

  const existing = readPort();
  if (existing != null && (await health(existing))) {
    onInfo(`adopted the running osade daemon on 127.0.0.1:${existing}`);
    return { port: existing, child: null };
  }
  if (existing != null && existsSync(portFile())) {
    rmSync(portFile(), { force: true });
  }

  const child = spawn(process.execPath, [options.entry, 'start'], {
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const port = readPort();
    if (port != null && (await health(port))) {
      onInfo(`spawned the osade daemon on 127.0.0.1:${port}`);
      return { port, child };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error('the osade daemon did not become healthy within 30s');
}
