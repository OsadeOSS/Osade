# todo

## M0 — complete
The three-process spine, verified end to end against real herdr.
See `docs/adr/0001-no-embedded-terminal-in-m0.md`.

## M1 — complete
- [x] Full `deriveStatus` table, rows 1–14, row-by-row and property tested
- [x] §20.1 lint boundaries wired, with `test/unit/lint-rules.test.ts` proving each one fires
- [x] Verify plan derived from evidence, `needsReview` until a human confirms (§10.1)
- [x] Verify runner: `verify` lane, run rows written before the command, head+tail log capping
- [x] Failure loop closed: first required failure stops the run and the tail goes to the agent
- [x] Gates: §14.1 list, payload bound at request and re-checked at execution, edit-and-approve
      re-hashing, 24h expiry that is not a denial, policy downgrades recorded
- [x] Turn checkpoints + undo, scratch-index capture, stash-and-label, gate over 20 files
- [x] Gate card at the top of the ledger; verify plan review UI
- [x] 4 tasks in parallel on one repo, no cross-talk
- [x] **M1 acceptance**: `implementing → verifying → verify_failed → implementing →
      awaiting_review` against real herdr, unattended, with the commit blocked until approved

`pnpm check` — 133 tests. `pnpm test:e2e` — 12 tests, 4 consecutive clean runs.

## Next — M2 (§21)
- [ ] Issue import → task
- [ ] Triage task type (§12): reproduce, bisect, failing test — terminates without a PR
- [ ] scm polling with ETags and rate-limit backoff, fork-aware push, gated PR open
- [ ] `review_changes_requested` loops back into the agent lane

**M2 acceptance:** import a real issue from a repo you maintain; land one PR through the gate;
run one triage task that produces a reproduction and no PR.

## Carried debt
- [ ] Electron app builds, typechecks and lints; still not launched against a live daemon
- [ ] `osade` CLI has no tests
- [ ] `VerifyRunner` recovers exit codes by echoing a sentinel into the lane. It works against
      real herdr (proved in the M1 acceptance), but it is still the weakest seam. Revisit if
      herdr ever exposes a run-and-report method.
- [ ] `deriveVerifyPlan` records CI config as corroboration but does not parse workflow YAML;
      §13.2 rates CI the strongest evidence there is, so M3 should read it properly

## Release blockers (THIRD-PARTY-NOTICES.md)
- [ ] fetch herdr's LICENSE + NOTICE from the pinned tag into vendor/herdr/0.8.2-p20/
- [ ] generate Rust crate attribution with cargo-about against the pinned Cargo.lock
- [ ] vendor the actual herdr binaries per platform + checksums

## Upstream to herdr
- [ ] `platform::interactive_shell_command` should use the call operator with arguments on
      Windows rather than `Start-Process`, which cannot execute npm shims (PRD-DELTA #13a.2)
- [ ] `events.subscribe` replays the ring buffer despite starting at `current_sequence()`
      (PRD-DELTA #5)
- [ ] `worktree.remove` closes the workspace before deleting the directory, so a failed delete
      leaves an unaddressable workspace and the retry reports `workspace_not_found` instead of
      the real error (PRD-DELTA #13a.3)

## Repo hygiene (PRD-DELTA #14)
- [ ] move herdr's AGENTS.md, .github/ and .agents/skills/herdr-* under backend/
- [ ] decide backend/: submodule, vendored at a pinned tag, or fetched by script
- [ ] add a security contact to docs/SECURITY.md, or enable private vulnerability reporting
