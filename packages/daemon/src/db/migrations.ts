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
}

/** Tables whose mutations must reach the UI. Each gets the three CDC triggers below. */
export const CDC_TABLES = [
  'task',
  'agent_fact',
  'verify_run',
  'gate_request',
  'scm_fact',
  'turn_checkpoint',
] as const;

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
  -- Durable key. Stable across other workspaces closing and across a herdr restart, but the
  -- full 'wN' form only: parse_workspace_id has a positional fallback for bare integers.
  herdr_workspace_id TEXT,
  archived_at   INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX task_repo_idx ON task(repo_id);
CREATE INDEX task_archived_idx ON task(archived_at);

-- ── facts (§5.2) — the only durable truth. No status column anywhere. ─────────
CREATE TABLE agent_fact (
  task_id          TEXT PRIMARY KEY REFERENCES task(id) ON DELETE CASCADE,
  herdr_pane_id    TEXT,
  herdr_state      TEXT,
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
CREATE INDEX agent_fact_pane_idx ON agent_fact(herdr_pane_id);

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
 * `task_lane` records which herdr tab is which. Deliberately a separate table rather than
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

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'core tables, facts, change_log',
    sql: M001_CORE + CDC_TABLES.map(cdcTriggers).join('\n'),
  },
  {
    id: 2,
    name: 'verify plan, task lanes, repo verification policy',
    sql: M002_VERIFY,
  },
];
