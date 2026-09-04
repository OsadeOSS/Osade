import net from 'node:net';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import { toConnectTarget } from './socket-path.js';

/**
 * One long-lived `events.subscribe` connection.
 *
 * §4.2 — the JSON API is one request per connection, and `events.subscribe` is one of the few
 * exceptions that holds the socket open. So a subscription *is* a connection: there is no way
 * to add or drop a subscription without opening or closing one.
 *
 * §5.4.1 — this stream replays herdr's ring buffer on connect and can drop silently. Nothing
 * here tries to deduplicate; that is the fact writer's job, via the monotonic gate.
 */

export interface HerdrEventEnvelope {
  event: string;
  data: Record<string, unknown>;
}

/** Subscription descriptors, as `events.subscribe` takes them (§7.2). */
export type GlobalSubscription = { type: string };
export type PaneSubscription = { type: string; pane_id: string };
export type Subscription = GlobalSubscription | PaneSubscription;

export interface EventStreamEvents {
  event: [HerdrEventEnvelope];
  /** The subscription was accepted; herdr will now push. */
  started: [];
  /** Connection closed. `willRetry` says whether this stream will reconnect itself. */
  closed: [{ willRetry: boolean; error?: Error }];
  error: [Error];
}

const RECONNECT_BASE_MS = 250;
const RECONNECT_MAX_MS = 10_000;

export class HerdrEventStream extends EventEmitter<EventStreamEvents> {
  readonly #socketPath: string;
  readonly #subscriptions: readonly Subscription[];
  #socket: net.Socket | null = null;
  #buffer = '';
  #stopped = false;
  #attempt = 0;
  #retryTimer: NodeJS.Timeout | null = null;

  constructor(socketPath: string, subscriptions: readonly Subscription[]) {
    super();
    this.#socketPath = socketPath;
    this.#subscriptions = subscriptions;
  }

  get connected(): boolean {
    return this.#socket != null && !this.#socket.destroyed;
  }

  start(): void {
    this.#stopped = false;
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#retryTimer) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    this.#socket?.destroy();
    this.#socket = null;
  }

  #connect(): void {
    if (this.#stopped) return;

    const socket = net.connect(toConnectTarget(this.#socketPath));
    this.#socket = socket;
    this.#buffer = '';

    socket.on('connect', () => {
      this.#attempt = 0;
      socket.write(
        JSON.stringify({
          id: `osade:sub:${randomUUID()}`,
          method: 'events.subscribe',
          params: { subscriptions: this.#subscriptions },
        }) + '\n',
      );
    });

    socket.on('data', (chunk) => {
      this.#buffer += chunk.toString('utf8');
      let newline: number;
      while ((newline = this.#buffer.indexOf('\n')) >= 0) {
        const line = this.#buffer.slice(0, newline).trim();
        this.#buffer = this.#buffer.slice(newline + 1);
        if (line.length > 0) this.#handleLine(line);
      }
    });

    socket.on('error', (err) => {
      this.emit('error', err);
    });

    socket.on('close', () => {
      this.#socket = null;
      const willRetry = !this.#stopped;
      this.emit('closed', { willRetry });
      if (willRetry) this.#scheduleReconnect();
    });
  }

  #handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.emit('error', new Error(`herdr sent a non-JSON event line: ${line.slice(0, 200)}`));
      return;
    }

    const message = parsed as {
      id?: string;
      result?: { type?: string };
      error?: { code: string; message: string };
      event?: string;
      data?: Record<string, unknown>;
    };

    if (message.error) {
      // A malformed subscription — e.g. a pane-scoped type without `pane_id`, which herdr
      // rejects outright (§7.2) — arrives here and then the socket closes.
      this.emit(
        'error',
        new Error(`events.subscribe rejected: ${message.error.code}: ${message.error.message}`),
      );
      return;
    }

    if (message.result?.type === 'subscription_started') {
      this.emit('started');
      return;
    }

    if (typeof message.event === 'string') {
      this.emit('event', { event: message.event, data: message.data ?? {} });
    }
  }

  #scheduleReconnect(): void {
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.#attempt, RECONNECT_MAX_MS);
    this.#attempt++;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#connect();
    }, delay);
    this.#retryTimer.unref?.();
  }
}
