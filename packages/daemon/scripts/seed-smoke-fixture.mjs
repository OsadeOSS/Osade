#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { openDb } from '../src/db/index.js';

/**
 * Seed a smoke database with one task that reaches every panel.
 *
 * The renderer's panels — the gate card, the verification plan review, the PR flow, the
 * conventions list — only appear when the underlying facts exist. Nothing in `pnpm check` renders
 * them, so this makes them reachable by `pnpm --filter @osade/desktop smoke` and a screenshot.
 *
 * Writes facts directly, which is the point: §6 derives status at read time, so seeding *facts*
 * and seeing the right status appear is the invariant being checked, not a shortcut around it.
 *
 *   pnpm --filter @osade/daemon exec vite-node scripts/seed-smoke-fixture.mjs [osade-home]
 */

const home = resolve(process.argv[2] ?? join('apps', 'desktop', '.smoke'));
mkdirSync(home, { recursive: true });

// `openDb` migrates, so this works against a fresh directory as well as a booted one - which is
// what lets the panel check be a single command instead of boot-then-seed-then-boot.
const db = openDb(join(home, 'osade.db'));
const NOW = Date.now();

const payload = {
  title: 'Retry the flaky poller test',
  body: 'The poller test fails intermittently on slow machines. Adds a bounded retry.',
  head: 'osade/retry-flaky-poller',
  base: 'main',
  draft: false,
};
const payloadJson = JSON.stringify(payload);
const payloadHash = createHash('sha256').update(payloadJson).digest('hex');

db.exec('BEGIN');
try {
  db.prepare(
    `INSERT OR IGNORE INTO repo (id, path, default_branch, gh_owner, gh_name, created_at)
     VALUES ('r_smoke', '/repo/widget', 'main', 'acme', 'widget', ?)`,
  ).run(NOW);

  db.prepare(
    `INSERT OR REPLACE INTO task
       (id, repo_id, title, intent, origin_kind, base_ref, base_sha, branch, worktree_path,
        substrate_workspace_id, chat_id, created_at)
     VALUES ('t_smoke01', 'r_smoke', 'Retry the flaky poller test',
             'The poller test fails intermittently on slow machines.', 'manual',
             'main', 'c820293d7c52', 'osade/retry-flaky-poller', '/wt/t_smoke01', 'w3',
             't_smoke01', ?)`,
  ).run(NOW);

  // §6 row 3 — an undecided gate outranks everything, so this task reads awaiting_approval.
  db.prepare(
    `INSERT OR REPLACE INTO gate_request
       (id, task_id, gate, payload_json, payload_hash, requested_at)
     VALUES ('g_smoke01', 't_smoke01', 'gate.pr_open', ?, ?, ?)`,
  ).run(payloadJson, payloadHash, NOW);

  db.prepare(
    `INSERT OR REPLACE INTO agent_fact
       (task_id, substrate_pane_id, substrate_state, last_event, last_event_at, activity_text,
        final_message, pane_alive)
     VALUES ('t_smoke01', 'p7', 'working', 'to_review', ?, 'waiting on your approval',
             '<osade_skills>loop-engineering</osade_skills>\n\nThe focused retry test passes.', 1)`,
  ).run(NOW);

  // §10.1 — a confirmed plan, so the review panel shows steps rather than a derive button.
  const steps = [
    { name: 'typecheck', cmd: 'pnpm typecheck', cwd: '.', timeoutSec: 600, required: true, source: 'ci', evidence: '.github/workflows/ci.yml → check' },
    { name: 'test', cmd: 'pnpm test', cwd: '.', timeoutSec: 600, required: true, source: 'ci', evidence: '.github/workflows/ci.yml → check' },
    { name: 'build', cmd: 'pnpm build', cwd: '.', timeoutSec: 600, required: false, source: 'manifest', evidence: 'package.json scripts.build' },
  ];
  db.prepare(
    `INSERT OR REPLACE INTO verify_plan (repo_id, steps_json, needs_review, derived_at, confirmed_at)
     VALUES ('r_smoke', ?, 0, ?, ?)`,
  ).run(JSON.stringify(steps), NOW, NOW);

  // §13 — one active convention and one candidate, each with the evidence the UI must show.
  const conventions = [
    ['cv_smoke01', 'scope_limits', 'Keep each pull request to one concern.', 0.92, 'active'],
    ['cv_smoke02', 'test_requirements', 'Add a regression test with every bug fix.', 0.55, 'candidate'],
  ];
  for (const [id, category, ruleText, confidence, lifecycle] of conventions) {
    db.prepare(
      `INSERT OR REPLACE INTO convention
         (id, repo_id, category, rule_text, rationale, confidence, lifecycle, mined_at, last_confirmed_at)
       VALUES (?, 'r_smoke', ?, ?, NULL, ?, ?, ?, ?)`,
    ).run(id, category, ruleText, confidence, lifecycle, NOW, NOW);

    db.prepare(
      `INSERT OR REPLACE INTO convention_evidence (id, convention_id, kind, url, excerpt, observed_at)
       VALUES (?, ?, 'rejected_pr', ?, ?, ?)`,
    ).run(`ce_${id}`, id, `https://github.com/acme/widget/pull/1234`, 'too many things at once', NOW);
    db.prepare(
      `INSERT OR REPLACE INTO convention_evidence (id, convention_id, kind, url, excerpt, observed_at)
       VALUES (?, ?, 'review_comment', ?, ?, ?)`,
    ).run(`ce2_${id}`, id, `https://github.com/acme/widget/pull/1290#discussion_r7`, 'please split this', NOW);
  }

  db.prepare(
    `INSERT OR REPLACE INTO mine_run
       (id, repo_id, started_at, finished_at, high_water_pr, observations, candidates)
     VALUES ('mr_smoke', 'r_smoke', ?, ?, 1290, 41, 6)`,
  ).run(NOW - 60_000, NOW - 30_000);

  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

process.stdout.write(`seeded ${join(home, 'osade.db')} with t_smoke01\n`);
