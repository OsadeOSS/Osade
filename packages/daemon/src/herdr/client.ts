import net from 'node:net';
import { randomUUID } from 'node:crypto';

import type { HerdrMethod, HerdrMethodParams } from './generated/index.js';
import { herdrApiSocketPath, OSADE_SESSION, toConnectTarget } from './socket-path.js';

/**
 * The herdr JSON API client — OSADE.md §4.2.
 *
 * INVARIANT: `packages/daemon/src/herdr/**` is the only place that opens `herdr.sock` or
 * imports the generated client.
 *
 * INVARIANT: **one request per connection.** `handle_connection_with_stop` reads exactly one
 * line, dispatches, writes one response and returns (`backend/src/api/server.rs:154-300`).
 * There is no multiplexing and no keep-alive, so there is deliberately no connection pool and
 * no correlation-id router here — there would be nothing to multiplex. Each connection is an
 * OS thread on herdr's side, so prefer one blocking call (`agent.prompt` with `wait`) over
 * prompt-then-poll.
 */

export interface HerdrErrorBody {
  code: string;
  message: string;
}

/** A structured error from herdr, carrying the code so callers can branch on it (§8.2). */
export class HerdrApiError extends Error {
  readonly code: string;
  readonly method: string;
  constructor(method: string, body: HerdrErrorBody) {
    super(`${method} failed: ${body.code}: ${body.message}`);
    this.name = 'HerdrApiError';
    this.code = body.code;
    this.method = method;
  }
}

export class HerdrTransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HerdrTransportError';
  }
}

/** Anything herdr returns in `result`. Callers narrow on `result.type`. */
export interface HerdrResult {
  type: string;
  [key: string]: unknown;
}

export interface HerdrClientOptions {
  /** Defaults to the `osade` named session (§2.2). */
  session?: string;
  socketPath?: string;
  /** Per-request timeout. Blocking methods pass their own, longer, budget. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class HerdrClient {
  readonly socketPath: string;
  readonly #timeoutMs: number;

  constructor(options: HerdrClientOptions = {}) {
    this.socketPath = options.socketPath ?? herdrApiSocketPath(options.session ?? OSADE_SESSION);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * One request, one connection.
   *
   * `timeoutMs` overrides the client default — pass a generous one for `agent.start`,
   * `agent.prompt` with `wait`, `agent.wait` and `pane.wait_for_output`, which block on the
   * server until they settle.
   */
  async request<M extends HerdrMethod>(
    method: M,
    params: HerdrMethodParams[M],
    timeoutMs?: number,
  ): Promise<HerdrResult> {
    const id = `osade:${randomUUID()}`;
    const line = JSON.stringify({ id, method, params }) + '\n';
    const budget = timeoutMs ?? this.#timeoutMs;

    const response = await this.#roundTrip(line, budget, method);
    const parsed = JSON.parse(response) as {
      id?: string;
      result?: HerdrResult;
      error?: HerdrErrorBody;
    };

    if (parsed.error) throw new HerdrApiError(method, parsed.error);
    if (!parsed.result) {
      throw new HerdrTransportError(`${method}: response had neither result nor error`);
    }
    return parsed.result;
  }

  /** `ping`, typed, because the boot sequence and health checks both need it (§18.1). */
  async ping(timeoutMs?: number): Promise<{
    version: string;
    protocol: number;
    capabilities?: {
      live_handoff?: boolean;
      detached_server_daemon?: boolean;
      /** Absent on herdr 0.8.2-p20 — every capability field is optional (§4.1). */
      endpoint_protocol_generation?: number | null;
    } | null;
  }> {
    const result = await this.request('ping', {}, timeoutMs);
    return result as never;
  }

  /** True when a server is listening. On Windows the `.sock` file alone proves nothing. */
  async isRunning(timeoutMs = 2_000): Promise<boolean> {
    try {
      await this.ping(timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  #roundTrip(line: string, timeoutMs: number, method: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(toConnectTarget(this.socketPath));
      let buffer = '';
      let settled = false;

      const finish = (err: Error | null, value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (err) reject(err);
        else resolve(value!);
      };

      const timer = setTimeout(() => {
        finish(
          new HerdrTransportError(
            `${method}: timed out after ${timeoutMs}ms on ${this.socketPath}`,
          ),
        );
      }, timeoutMs);

      socket.on('connect', () => socket.write(line));

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const newline = buffer.indexOf('\n');
        // herdr answers with exactly one line, then closes. Take the first and stop.
        if (newline >= 0) finish(null, buffer.slice(0, newline));
      });

      socket.on('end', () => {
        if (buffer.trim().length > 0) finish(null, buffer.trim());
        else finish(new HerdrTransportError(`${method}: connection closed with no response`));
      });

      socket.on('error', (cause) => {
        finish(
          new HerdrTransportError(`${method}: cannot reach herdr at ${this.socketPath}`, { cause }),
        );
      });
    });
  }
}
