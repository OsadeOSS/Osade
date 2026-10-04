/**
 * Numbered, forward-only migrations, applied at daemon boot — OSADE.md §5.
 *
 * Two rules that are enforced by tests rather than by review:
 *   - No `status` column, in any table, ever (§6). `test/integration/db.test.ts` asserts it.
 *   - Every fact table gets AFTER INSERT/UPDATE/DELETE triggers writing to `change_log` (§5.4).
 *     One event path; no service emits a websocket message directly.
 */

export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
  /**
   * A table this migration is guaranteed to have created once it has run.
   *
   * `assertSchemaCurrent` (`db/index.ts`) reads these to catch a migration whose id was recorded
   * by a *different* Osade build and therefore silently skipped here. Omitted for migrations that
   * only ALTER an existing table, which have nothing new to probe for.
   */
  readonly probe?: string;
}

/** Tables whose mutations must reach the UI. Each gets the three CDC triggers below. */
const CORE_CDC_TABLES = [
  'task',
  'agent_fact',
  'verify_run',
  'gate_request',
  'scm_fact',
  'turn_checkpoint',
] as const;

export const CDC_TABLES = [...CORE_CDC_TABLES, 'chat_turn'] as const;

export type CdcTable = (typeof CDC_TABLES)[number];

/**
 * `row_id` is the value the CDC poller uses to re-read the row, so it must be the task the
 * change belongs to — the ledger is keyed by task, not by row.
 */
function cdcTriggers(table: CdcTable): string {
  const taskRef = table === 'task' ? 'id' : 'task_id';
  return `
CREATE TRIGGER ${table}_cdc_insert AFTER INSERT ON ${table} BEGIN
  INSERT INTO change_log (table_name, row_id, op, at)
  VALUES ('${table}', NEW.${taskRef}, 'insert', CAST(strftime('%s','now') AS INTEGER) * 1000);
END;

CREATE TRIGGER ${table}_cdc_update AFTER UPDATE ON ${table} BEGIN
  INSERT INTO change_log (table_name, row_id, op, at)
  VALUES ('${table}', NEW.${taskRef}, 'update', CAST(strftime('%s','now') AS INTEGER) * 1000);
END;

CREATE TRIGGER ${table}_cdc_delete AFTER DELETE ON ${table} BEGIN
  INSERT INTO change_log (table_name, row_id, op, at)
  VALUES ('${table}', OLD.${taskRef}, 'delete', CAST(strftime('%s','now') AS INTEGER) * 1000);
END;
`;
}

const M001_CORE = `
-- ── identity ─────────────────────────────────────────────────────────────────
CREATE TABLE org (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  gh_login      TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE repo (
  id              TEXT PRIMARY KEY,
  org_id          TEXT REFERENCES org(id),
  path            TEXT NOT NULL UNIQUE,
  gh_owner        TEXT,
  gh_name         TEXT,
  default_branch  TEXT NOT NULL,
  upstream_remote TEXT,
  fork_of         TEXT,
  default_agent   TEXT,
  created_at      INTEGER NOT NULL
);

CREATE TABLE task (
  id            TEXT PRIMARY KEY,
  repo_id       TEXT NOT NULL REFERENCES repo(id),
  title         TEXT NOT NULL,
  intent        TEXT NOT NULL,
  origin_kind   TEXT NOT NULL,
  origin_ref    TEXT,
  agent_id      TEXT,
  base_ref      TEXT NOT NULL,
  base_sha      TEXT NOT NULL,
  branch        TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  -- Durable key. Stable across other workspaces closing and across a substrate restart, but the
  -- full 'wN' form only: parse_workspace_id has a positional fallback for bare integers.
  substrate_workspace_id TEXT,
  archived_at   INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX task_repo_idx ON task(repo_id);
CREATE INDEX task_archived_idx ON task(archived_at);

-- ── facts (§5.2) — the only durable truth. No status column anywhere. ─────────
CREATE TABLE agent_fact (
  task_id          TEXT PRIMARY KEY REFERENCES task(id) ON DELETE CASCADE,
  substrate_pane_id    TEXT,
  substrate_state      TEXT,
  last_event       TEXT,
  last_event_at    INTEGER,
  activity_text    TEXT,
  tool_name        TEXT,
  final_message    TEXT,
  agent_session_id TEXT,
  pane_alive       INTEGER NOT NULL DEFAULT 0,
  last_probe_at    INTEGER,
  probe_failures   INTEGER NOT NULL DEFAULT 0,
  terminated       INTEGER NOT NULL DEFAULT 0,
  -- §5.4.1 the monotonic gate. Written in the same transaction as the fact it guards.
  state_change_seq INTEGER NOT NULL DEFAULT 0,
  controller_generation INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX agent_fact_pane_idx ON agent_fact(substrate_pane_id);

CREATE TABLE verify_run (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  step_name   TEXT NOT NULL,
  cmd         TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  exit_code   INTEGER,
  required    INTEGER NOT NULL,
  head_sha    TEXT NOT NULL,
  log_path    TEXT NOT NULL
);
CREATE INDEX verify_run_task_idx ON verify_run(task_id, head_sha);

CREATE TABLE gate_request (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  gate            TEXT NOT NULL,
  payload_json    TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,
  requested_at    INTEGER NOT NULL,
  decided_at      INTEGER,
  decision        TEXT,
  decided_by      TEXT,
  executed_at     INTEGER,
  execution_error TEXT
);
CREATE INDEX gate_request_open_idx ON gate_request(task_id, decided_at);

CREATE TABLE scm_fact (
  task_id            TEXT PRIMARY KEY REFERENCES task(id) ON DELETE CASCADE,
  pr_number          INTEGER,
  pr_url             TEXT,
  pr_state           TEXT,
  pr_head_sha        TEXT,
  pr_draft           INTEGER,
  checks_state       TEXT,
  review_state       TEXT,
  unresolved_threads INTEGER NOT NULL DEFAULT 0,
  mergeable          TEXT,
  fetched_at         INTEGER NOT NULL,
  -- §11.1 a failed fetch is a fact, not a state change.
  fetch_failed_at    INTEGER
);

CREATE TABLE turn_checkpoint (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  ref_name    TEXT NOT NULL,
  sha         TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  trigger     TEXT NOT NULL
);
CREATE INDEX turn_checkpoint_task_idx ON turn_checkpoint(task_id, captured_at);

-- ── change data capture (§5.4) — INVARIANT: one event path ───────────────────
CREATE TABLE change_log (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id     TEXT NOT NULL,
  op         TEXT NOT NULL,
  at         INTEGER NOT NULL
);
CREATE INDEX change_log_seq_idx ON change_log(seq);
`;

/**
 * M1 — the verify plan per repo, and lane bindings per task.
 *
 * `verify_plan` is stored per repo and carries `needs_review`: §10.1 is explicit that an
 * inferred command is never run silently the first time, so the flag is part of the durable
 * record rather than a UI state.
 *
 * `task_lane` records which the substrate tab is which. Deliberately a separate table rather than
 * columns on `task`: lanes are created lazily (`verify` on first run, §8.2 step 4) and a row
 * that appears later is cleaner than a column that is null until it is not.
 */
const M002_VERIFY = `
CREATE TABLE verify_plan (
  repo_id     TEXT PRIMARY KEY REFERENCES repo(id) ON DELETE CASCADE,
  steps_json  TEXT NOT NULL,
  -- §10.1 the plan is shown to the user and editable before first use.
  needs_review INTEGER NOT NULL DEFAULT 1,
  derived_at  INTEGER NOT NULL,
  confirmed_at INTEGER
);

CREATE TABLE task_lane (
  task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  lane    TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (task_id, lane)
);

-- §10.2 verification is required before gate.pr_open can be approved. That is a policy
-- default, overridable per repo, and the override is recorded rather than silent.
ALTER TABLE repo ADD COLUMN verify_required_for_pr INTEGER NOT NULL DEFAULT 1;
ALTER TABLE repo ADD COLUMN verify_override_reason TEXT;

-- §9 rule 5 — gitignored-but-needed paths mirrored into every worktree.
ALTER TABLE repo ADD COLUMN mirror_paths_json TEXT;
`;

/**
 * M3 — repository conventions (§13).
 *
 * **Naming deviation, deliberate.** §5.3 specifies `convention.status`. This calls the column
 * `lifecycle` instead, because §20.1's mechanical rule is "no column named `status`, anywhere"
 * and that blanket form is what makes §6 unbreakable — a rule with one carve-out is a rule
 * someone widens later. A convention's lifecycle is genuinely durable data (mined, confirmed,
 * retired) rather than something derived, so only the *name* was in tension, and renaming costs
 * nothing while keeping the invariant enforceable by a linter rather than by memory.
 * Recorded as PRD-DELTA #16.
 */
const M003_CONVENTIONS = `
CREATE TABLE convention (
  id            TEXT PRIMARY KEY,
  repo_id       TEXT NOT NULL REFERENCES repo(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  -- Imperative, one sentence. §13.5 injects these verbatim.
  rule_text     TEXT NOT NULL,
  rationale     TEXT,
  confidence    REAL NOT NULL,
  -- 'candidate' | 'active' | 'retired' | 'rejected'  (§5.3 calls this 'status'; see above)
  lifecycle     TEXT NOT NULL,
  mined_at      INTEGER NOT NULL,
  last_confirmed_at INTEGER,
  retired_reason TEXT
);
CREATE INDEX convention_repo_idx ON convention(repo_id, lifecycle);

-- §13.1 INVARIANT: a convention with zero evidence rows is not a convention. The foreign key
-- makes evidence deletable only with its rule; the write path rejects unciteable rules.
CREATE TABLE convention_evidence (
  id            TEXT PRIMARY KEY,
  convention_id TEXT NOT NULL REFERENCES convention(id) ON DELETE CASCADE,
  -- 'merged_pr' | 'rejected_pr' | 'review_comment' | 'doc' | 'ci_config'
  kind          TEXT NOT NULL,
  url           TEXT NOT NULL,
  excerpt       TEXT,
  observed_at   INTEGER NOT NULL
);
CREATE INDEX convention_evidence_idx ON convention_evidence(convention_id);

-- §13.4 — incremental re-mining needs to know how far it got.
CREATE TABLE mine_run (
  id          TEXT PRIMARY KEY,
  repo_id     TEXT NOT NULL REFERENCES repo(id) ON DELETE CASCADE,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  -- The newest PR considered, so the next run starts after it.
  high_water_pr INTEGER,
  observations INTEGER NOT NULL DEFAULT 0,
  candidates  INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);
CREATE INDEX mine_run_repo_idx ON mine_run(repo_id, started_at);
`;

/**
 * M3 — the measurement §13.6 demands.
 *
 * "This feature exists to move one number: **review rounds to merge.** Instrument it from day
 * one." A comparison needs to know which side of the line each task fell on, and that is only
 * knowable at launch — by the time a PR merges, the conventions have changed. So the count is
 * recorded when the context file is written.
 *
 * A separate table rather than a column on `task`, for the same reason `task_lane` is separate:
 * it exists only for tasks that were actually launched, and a row that appears later is cleaner
 * than a column that is null until it is not.
 */
const M004_INJECTION = `
CREATE TABLE task_injection (
  task_id     TEXT PRIMARY KEY REFERENCES task(id) ON DELETE CASCADE,
  rule_count  INTEGER NOT NULL,
  -- Rules that were active but did not fit the §13.5 budget.
  omitted     INTEGER NOT NULL DEFAULT 0,
  injected_at INTEGER NOT NULL
);
`;

/**
 * M3 — mining progress, because mining takes minutes.
 *
 * A 300-pull-request first run is not a request-response operation. The run happens in the
 * background and the UI polls, which means progress has to live somewhere durable rather than in
 * the promise nobody is awaiting: an in-memory counter would vanish on restart and would be
 * invisible to a second window looking at the same daemon.
 *
 * `phase` doubles as the liveness signal — a row with `finished_at IS NULL` whose phase is
 * `interrupted` is a run whose daemon died, which is a different thing from a run still going.
 */
const M005_MINE_PROGRESS = `
ALTER TABLE mine_run ADD COLUMN phase TEXT;
ALTER TABLE mine_run ADD COLUMN progress_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mine_run ADD COLUMN progress_total INTEGER NOT NULL DEFAULT 0;
`;

/**
 * M6 — multi-agent chats. A chat is a set of tasks sharing `chat_id`; each task is one lane.
 * Existing rows become one-lane chats by backfilling `chat_id` from the task id.
 */
const M006_CHAT_LANES = `
ALTER TABLE task ADD COLUMN chat_id TEXT;
UPDATE task SET chat_id = id WHERE chat_id IS NULL;
CREATE INDEX task_chat_idx ON task(chat_id);
`;

/**
 * M7 — attached lanes. `worktree_path` NULL means the lane runs in the repository checkout.
 * Existing rows keep their paths (isolated). `external_block` is a fact for quota/auth exits
 * so they cannot be derived as awaiting_review.
 */
const M007_ATTACHED = `
PRAGMA foreign_keys=OFF;

CREATE TABLE task_m7 (
  id            TEXT PRIMARY KEY,
  repo_id       TEXT NOT NULL REFERENCES repo(id),
  title         TEXT NOT NULL,
  intent        TEXT NOT NULL,
  origin_kind   TEXT NOT NULL,
  origin_ref    TEXT,
  agent_id      TEXT,
  chat_id       TEXT,
  base_ref      TEXT NOT NULL,
  base_sha      TEXT NOT NULL,
  branch        TEXT NOT NULL,
  worktree_path TEXT,
  substrate_workspace_id TEXT,
  archived_at   INTEGER,
  created_at    INTEGER NOT NULL
);

INSERT INTO task_m7 (
  id, repo_id, title, intent, origin_kind, origin_ref, agent_id, chat_id,
  base_ref, base_sha, branch, worktree_path, substrate_workspace_id, archived_at, created_at
)
SELECT
  id, repo_id, title, intent, origin_kind, origin_ref, agent_id, chat_id,
  base_ref, base_sha, branch, worktree_path, substrate_workspace_id, archived_at, created_at
FROM task;

DROP TABLE task;
ALTER TABLE task_m7 RENAME TO task;
CREATE INDEX task_repo_idx ON task(repo_id);
CREATE INDEX task_archived_idx ON task(archived_at);
CREATE INDEX task_chat_idx ON task(chat_id);

CREATE TRIGGER task_cdc_insert AFTER INSERT ON task BEGIN
  INSERT INTO change_log (table_name, row_id, op, at)
  VALUES ('task', NEW.id, 'insert', CAST(strftime('%s','now') AS INTEGER) * 1000);
END;
CREATE TRIGGER task_cdc_update AFTER UPDATE ON task BEGIN
  INSERT INTO change_log (table_name, row_id, op, at)
  VALUES ('task', NEW.id, 'update', CAST(strftime('%s','now') AS INTEGER) * 1000);
END;
CREATE TRIGGER task_cdc_delete AFTER DELETE ON task BEGIN
  INSERT INTO change_log (table_name, row_id, op, at)
  VALUES ('task', OLD.id, 'delete', CAST(strftime('%s','now') AS INTEGER) * 1000);
END;

ALTER TABLE agent_fact ADD COLUMN external_block TEXT;

PRAGMA foreign_keys=ON;
`;

const M008_CHAT_TURNS = `
CREATE TABLE chat_turn (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES task(id),
  seq         INTEGER NOT NULL,
  role        TEXT NOT NULL,
  origin      TEXT NOT NULL,
  text        TEXT NOT NULL,
  delivery    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (task_id, seq)
);
CREATE INDEX chat_turn_task_seq ON chat_turn (task_id, seq);
`;

const M009_COMPOSER_READY = `
ALTER TABLE agent_fact ADD COLUMN composer_ready INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_fact ADD COLUMN prompt_surface TEXT;
ALTER TABLE chat_turn ADD COLUMN error TEXT;
UPDATE agent_fact SET composer_ready = 1
 WHERE pane_alive = 1 AND substrate_state IN ('idle', 'done');
`;

/**
 * M10 — isolated lanes may check out an existing branch (`checkout_ref`) instead of cutting
 * `osade/<slug>`. `pr_head_ref` is the GitHub head branch so a review loop can offer a lane
 * on that branch rather than forking it.
 */
const M010_CHECKOUT_REF = `
ALTER TABLE task ADD COLUMN checkout_ref TEXT;
ALTER TABLE scm_fact ADD COLUMN pr_head_ref TEXT;
`;

const M011_MEMORY_FTS = `
CREATE TABLE memory (
  id             TEXT PRIMARY KEY,
  scope          TEXT NOT NULL,
  scope_id       TEXT,
  kind           TEXT NOT NULL,
  text           TEXT NOT NULL,
  source_task_id TEXT,
  source_agent   TEXT,
  verified_by    TEXT,
  confidence     REAL NOT NULL,
  ecosystem_tag  TEXT,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER,
  superseded_by  TEXT
);
CREATE VIRTUAL TABLE memory_fts USING fts5(text, content='memory', content_rowid='rowid');
CREATE TRIGGER memory_ai AFTER INSERT ON memory BEGIN
  INSERT INTO memory_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER memory_ad AFTER DELETE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER memory_au AFTER UPDATE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO memory_fts(rowid, text) VALUES (new.rowid, new.text);
END;
`;

const M012_STREAM_TEXT = `
ALTER TABLE agent_fact ADD COLUMN stream_text TEXT;
`;

/**
 * Context repositories belong to a chat, not a renderer session.
 *
 * `repo_id` is the identity. Path and GitHub remote stay on `repo` and are joined at read time.
 * `access` is `read` for every attachment this version creates. `edit` is reserved so a later
 * explicit promotion can open a lane without a new table. Cross-repo pull requests stay on the
 * primary task; this row does not open one.
 */
const M013_CHAT_CONTEXT = `
CREATE TABLE chat_context (
  chat_id    TEXT NOT NULL,
  repo_id    TEXT NOT NULL REFERENCES repo(id) ON DELETE CASCADE,
  access     TEXT NOT NULL CHECK (access IN ('read', 'edit')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, repo_id)
);
CREATE INDEX chat_context_repo_idx ON chat_context(repo_id);

CREATE TRIGGER chat_context_fanout_insert AFTER INSERT ON chat_context BEGIN
  INSERT INTO change_log (table_name, row_id, op, at)
  SELECT 'chat_context', task.id, 'update', CAST(strftime('%s','now') AS INTEGER) * 1000
  FROM task WHERE task.chat_id = NEW.chat_id;
END;
CREATE TRIGGER chat_context_fanout_delete AFTER DELETE ON chat_context BEGIN
  INSERT INTO change_log (table_name, row_id, op, at)
  SELECT 'chat_context', task.id, 'update', CAST(strftime('%s','now') AS INTEGER) * 1000
  FROM task WHERE task.chat_id = OLD.chat_id;
END;
`;

/**
 * M14 — quick notes: "noticed, not fixing yet", scoped to a repository.
 *
 * Numbered 14, not 12: #13 landed two migrations of its own (M012 stream text, M013 chat
 * context) while this was open, and migration ids are dense and never reused — a second M012
 * would have `schema_migration` record the first one as applied and silently skip whichever ran
 * second.
 *
 * Repo-scoped and deliberately **not** in `CDC_TABLES`. §5.4's CDC poller collapses
 * `change_log` by task id and re-reads a `TaskView` per row, and a note belongs to no task —
 * putting it in `CDC_TABLES` would mean a trigger writing a task id a note does not have. So
 * notes are read over tRPC on demand, exactly like `convention` and `verify_plan`, and the
 * renderer refetches after a write. Extending §5.4 to a second key space is a change to the
 * spec and belongs in its own PR, argued on its own merits.
 *
 * `resolved_at` and not a status column: §6 is a blanket rule and
 * `test/integration/cdc.test.ts` checks this table along with every other one.
 */
const M014_QUICK_NOTES = `
CREATE TABLE quick_note (
  id          TEXT PRIMARY KEY,
  repo_id     TEXT NOT NULL REFERENCES repo(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  -- Set when the user resolves it. NULL means still open (§6: never a status column).
  resolved_at INTEGER,
  -- Repository-relative, so a note taken in a worktree still points at the same file.
  file        TEXT,
  line        INTEGER
);
CREATE INDEX quick_note_repo_idx ON quick_note(repo_id, resolved_at, created_at);
`;

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'core tables, facts, change_log',
    probe: 'change_log',
    sql: M001_CORE + CORE_CDC_TABLES.map(cdcTriggers).join('\n'),
  },
  {
    id: 2,
    name: 'verify plan, task lanes, repo verification policy',
    probe: 'verify_plan',
    sql: M002_VERIFY,
  },
  {
    id: 3,
    name: 'repository conventions, evidence, mine runs',
    probe: 'convention',
    sql: M003_CONVENTIONS,
  },
  {
    id: 4,
    name: 'convention injection, recorded per launch for §13.6',
    probe: 'task_injection',
    sql: M004_INJECTION,
  },
  {
    id: 5,
    name: 'mining progress, for runs that take minutes',
    sql: M005_MINE_PROGRESS,
  },
  {
    id: 6,
    name: 'chat_id on task, backfilled for one-lane chats',
    sql: M006_CHAT_LANES,
  },
  {
    id: 7,
    name: 'nullable worktree_path for attached lanes, external_block fact',
    sql: M007_ATTACHED,
  },
  {
    id: 8,
    name: 'durable chat turns — typed send, not pane scrape',
    probe: 'chat_turn',
    sql: M008_CHAT_TURNS + cdcTriggers('chat_turn'),
  },
  {
    id: 9,
    name: 'composer_ready fact, pane snapshot, failed-turn error',
    sql: M009_COMPOSER_READY,
  },
  {
    id: 10,
    name: 'checkout_ref on task, pr_head_ref on scm_fact',
    sql: M010_CHECKOUT_REF,
  },
  {
    id: 11,
    name: 'memory with FTS5 retrieval, no vector store',
    probe: 'memory',
    sql: M011_MEMORY_FTS,
  },
  {
    id: 12,
    name: 'live pane-delta text for terminal agents',
    sql: M012_STREAM_TEXT,
  },
  {
    id: 13,
    name: 'chat context repositories, read-only unless promoted',
    probe: 'chat_context',
    sql: M013_CHAT_CONTEXT,
  },
  {
    id: 14,
    name: 'quick notes, repo-scoped, resolve is a timestamp',
    probe: 'quick_note',
    sql: M014_QUICK_NOTES,
  },
];
