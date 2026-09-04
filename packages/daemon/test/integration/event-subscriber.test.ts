import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ServerMessage } from '@osade/contract';

import { openDb, type Db } from '../../src/db/index.js';
import { getAgentFact } from '../../src/db/task-repo.js';
import { HerdrEventSubscriber } from '../../src/herdr/event-subscriber.js';
import type { HerdrEventStream, Subscription } from '../../src/herdr/event-stream.js';
import type { HerdrClient } from '../../src/herdr/client.js';
import { CdcBroadcaster } from '../../src/server/cdc-broadcaster.js';

const NOW = 1_756_000_000_000;

/** Stands in for one `events.subscribe` connection, so no socket is involved. */
class FakeStream extends EventEmitter {
  started = false;
  stopped = false;
  constructor(readonly subscriptions: readonly Subscription[]) {
    super();
  }
  start(): void {
    this.started = true;
    this.emit('started');
  }
  stop(): void {
    this.stopped = true;
  }
  push(event: string, data: Record<string, unknown>): void {
    this.emit('event', { event, data });
  }
}

let db: Db;
let streams: FakeStream[];

function fakeClient(snapshot: unknown = { agents: [] }): HerdrClient {
  return {
    socketPath: '/fake/herdr.sock',
    request: async () => snapshot,
  } as unknown as HerdrClient;
}

function subscriber(client = fakeClient()): HerdrEventSubscriber {
  return new HerdrEventSubscriber(db, client, {
    now: () => NOW,
    createStream: (_path, subs) => {
      const s = new FakeStream(subs);
      streams.push(s);
      return s as unknown as HerdrEventStream;
    },
  });
}

function seed(taskId = 't1'): void {
  db.prepare('INSERT INTO org (id, name, created_at) VALUES (?,?,?)').run('o1', 'acme', NOW);
  db.prepare(
    'INSERT INTO repo (id, org_id, path, default_branch, created_at) VALUES (?,?,?,?,?)',
  ).run('r1', 'o1', '/repo', 'main', NOW);
  db.prepare(
    `INSERT INTO task (id, repo_id, title, intent, origin_kind, base_ref, base_sha, branch,
                       worktree_path, herdr_workspace_id, created_at)
     VALUES (?, 'r1', 'fix', 'fix it', 'manual', 'main', 'headsha', 'b', '/wt', 'w3', ?)`,
  ).run(taskId, NOW);
  db.prepare('INSERT INTO agent_fact (task_id) VALUES (?)').run(taskId);
}

beforeEach(() => {
  db = openDb(':memory:');
  streams = [];
});

afterEach(() => db.close());

describe('event subscriber — the N+1 connection manager (§7.2)', () => {
  it('opens one global connection at start', async () => {
    const s = subscriber();
    await s.start();
    expect(streams.length).toBe(1);
    // Global subscriptions carry no pane_id; a pane-scoped type without one is rejected.
    for (const sub of streams[0]!.subscriptions) {
      expect(sub).not.toHaveProperty('pane_id');
      expect(sub.type).not.toBe('pane.agent_status_changed');
    }
    s.stop();
  });

  it('opens one additional connection per watched pane, scoped by pane_id', async () => {
    seed();
    const s = subscriber();
    await s.start();
    s.watchPane('t1', 'w3:p2');

    expect(s.paneCount).toBe(1);
    expect(streams.length).toBe(2);
    expect(streams[1]!.subscriptions).toEqual([
      { type: 'pane.agent_status_changed', pane_id: 'w3:p2' },
    ]);
    s.stop();
  });

  it('watchPane is idempotent', async () => {
    seed();
    const s = subscriber();
    await s.start();
    s.watchPane('t1', 'w3:p2');
    s.watchPane('t1', 'w3:p2');
    expect(streams.length).toBe(2);
    s.stop();
  });

  it('closes the pane connection on pane.exited and does not mark the task terminated', async () => {
    seed();
    const s = subscriber();
    await s.start();
    s.watchPane('t1', 'w3:p2');
    expect(s.paneCount).toBe(1);

    streams[0]!.push('pane_exited', { pane_id: 'w3:p2', workspace_id: 'w3' });

    expect(s.paneCount).toBe(0);
    const fact = getAgentFact(db, 't1')!;
    expect(fact.pane_alive).toBe(false);
    // §5.2 — a pane vanishing is not a death certificate. A herdr restart looks exactly like
    // this, and §8.2.1 relaunches into the restored pane rather than declaring the task dead.
    expect(fact.terminated).toBe(false);
    s.stop();
  });

  it('stop() closes every connection', async () => {
    seed();
    const s = subscriber();
    await s.start();
    s.watchPane('t1', 'w3:p2');
    s.stop();
    expect(streams.every((x) => x.stopped)).toBe(true);
  });
});

describe('event subscriber — fact writes (§5.4.1)', () => {
  it('a status change lands as a fact and reaches the UI through CDC', async () => {
    seed();
    const s = subscriber();
    await s.start();
    s.watchPane('t1', 'w3:p2');

    const broadcaster = new CdcBroadcaster(db, { now: () => NOW });
    const seen: ServerMessage[] = [];
    broadcaster.subscribe((m) => seen.push(m));

    streams[1]!.push('pane.agent_status_changed', {
      pane_id: 'w3:p2',
      workspace_id: 'w3',
      agent_status: 'working',
      agent: 'claude',
    });

    expect(getAgentFact(db, 't1')!.herdr_state).toBe('working');
    expect(getAgentFact(db, 't1')!.last_event).toBe('to_in_progress');

    // §5.4 — no direct emit anywhere; the fact reaches the client only via change_log.
    expect(broadcaster.tick()).toBe(1);
    const push = seen.at(-1);
    if (push?.type !== 'task.upserted') throw new Error('expected upsert');
    expect(push.task.status).toBe('implementing');
    s.stop();
  });

  it('the full lifecycle blocked → idle → working → done lands as the right facts', async () => {
    seed();
    const s = subscriber();
    await s.start();
    s.watchPane('t1', 'w3:p2');
    const pane = streams[1]!;

    // Exactly the sequence observed against a live herdr (HERDR-CONTRACT.md §3.3).
    pane.push('pane.agent_status_changed', { agent_status: 'blocked' });
    expect(getAgentFact(db, 't1')!.herdr_state).toBe('blocked');

    pane.push('pane.agent_status_changed', { agent_status: 'idle' });
    let fact = getAgentFact(db, 't1')!;
    expect(fact.herdr_state).toBe('idle');
    // §6.1 — `idle` is inert. It must not have produced a transition.
    expect(fact.last_event).toBe(null);

    pane.push('pane.agent_status_changed', { agent_status: 'working' });
    expect(getAgentFact(db, 't1')!.last_event).toBe('to_in_progress');

    pane.push('pane.agent_status_changed', { agent_status: 'done' });
    fact = getAgentFact(db, 't1')!;
    expect(fact.herdr_state).toBe('done');
    expect(fact.last_event).toBe('to_review');
    s.stop();
  });

  it('an idle after done does not clear awaiting_review (§4.4 focus invariant)', async () => {
    seed();
    const s = subscriber();
    await s.start();
    s.watchPane('t1', 'w3:p2');
    const pane = streams[1]!;

    pane.push('pane.agent_status_changed', { agent_status: 'done' });
    expect(getAgentFact(db, 't1')!.last_event).toBe('to_review');

    // Opening the task in herdr marks the pane seen, and herdr then reports `idle` for the
    // same agent in the same state. The task must stay in the needs-you set.
    pane.push('pane.agent_status_changed', { agent_status: 'idle' });
    const fact = getAgentFact(db, 't1')!;
    expect(fact.herdr_state).toBe('idle');
    expect(fact.last_event).toBe('to_review');
    s.stop();
  });

  it('reconcile writes authoritative state from session.snapshot', async () => {
    seed();
    db.prepare("UPDATE agent_fact SET herdr_pane_id = 'w3:p2' WHERE task_id = 't1'").run();

    const s = subscriber(
      fakeClient({
        agents: [
          {
            pane_id: 'w3:p2',
            agent_status: 'done',
            state_change_seq: 42,
            terminal_title_stripped: 'Pong response',
            agent_session: { value: 'sess-abc' },
          },
        ],
      }),
    );
    await s.start();

    const fact = getAgentFact(db, 't1')!;
    expect(fact.herdr_state).toBe('done');
    expect(fact.last_event).toBe('to_review');
    expect(fact.activity_text).toBe('Pong response');
    expect(fact.agent_session_id).toBe('sess-abc');
    expect(fact.state_change_seq).toBe(42);
    s.stop();
  });

  it('a replayed stale status does not clobber a newer fact', async () => {
    seed();
    db.prepare(
      "UPDATE agent_fact SET herdr_pane_id = 'w3:p2', herdr_state = 'done', last_event = 'to_review', state_change_seq = 100 WHERE task_id = 't1'",
    ).run();

    // herdr replays its ring buffer on every connect, so an old `working` arrives after a
    // live `done`. The monotonic gate is what stops it landing.
    const s = subscriber(
      fakeClient({
        agents: [{ pane_id: 'w3:p2', agent_status: 'working', state_change_seq: 7 }],
      }),
    );
    await s.start();

    const fact = getAgentFact(db, 't1')!;
    expect(fact.herdr_state).toBe('done');
    expect(fact.last_event).toBe('to_review');
    expect(fact.state_change_seq).toBe(100);
    s.stop();
  });

  it('a failed session.snapshot changes nothing (§5.2)', async () => {
    seed();
    db.prepare("UPDATE agent_fact SET herdr_state = 'working', state_change_seq = 3 WHERE task_id = 't1'").run();

    const failing = {
      socketPath: '/fake/herdr.sock',
      request: async () => {
        throw new Error('herdr is not running');
      },
    } as unknown as HerdrClient;

    const s = new HerdrEventSubscriber(db, failing, {
      now: () => NOW,
      createStream: (_p, subs) => {
        const st = new FakeStream(subs);
        streams.push(st);
        return st as unknown as HerdrEventStream;
      },
    });
    await s.start();

    // A failed probe is a fact, not a state change: nothing is overwritten and nothing dies.
    const fact = getAgentFact(db, 't1')!;
    expect(fact.herdr_state).toBe('working');
    expect(fact.terminated).toBe(false);
    s.stop();
  });
});
