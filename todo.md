# todo

## M0 — complete
- [x] typed herdr client generated from the pinned schema (`vendor/herdr/0.8.2-p20/`)
- [x] boot drift check — protocol + method set, never the version string (§4.1.1)
- [x] contract package: task, agent_fact, WS message union (§5.5)
- [x] sqlite + forward-only migrations + change_log triggers + CDC broadcaster (§5.4)
- [x] deriveStatus rows 4, 10, 11, 13, 14 + ordering property test (§6, §20.2)
- [x] event subscriber as an N+1 connection manager + monotonic fact gate (§7.2, §5.4.1)
- [x] daemon http/tRPC/ws on 127.0.0.1, port file handshake (§2.1)
- [x] launch-task: prune → worktree → mirror → lane with env → subscribe → agent.start,
      trust-prompt recovery, readiness wait, teardown (§8.2, §8.3, §9)
- [x] `osade` CLI — same surface for humans and agents (§17)
- [x] apps/desktop — userData redirect, supervisor (detached herdr + daemon), ledger + detail
- [x] e2e: real herdr, real git fixture, one full task (§21 acceptance)

**Acceptance met.** `pnpm test:e2e` drives a real Claude Code session in an isolated worktree
from `queued` to `awaiting_review`, entirely on herdr's detection, nothing polled, no status
column. 64 unit/integration tests + 5 e2e.

## Next — M1 (§21)
- [ ] Full deriveStatus table (rows 1–3, 5–9, 12)
- [ ] Verify plan derivation from CI config, editable, `verify` lane, run rows, log capture
- [ ] Failure loop: verify fails → log tail back into the agent lane
- [ ] Gate requests: payload hashing, approve/deny/edit UI
- [ ] Turn checkpoints + undo
- [ ] 4 tasks in parallel on one repo, no cross-talk

## Carried debt
- [ ] Lint rules from §20.1 are documented but not wired (no ESLint config yet)
- [ ] Electron app builds and typechecks; not yet launched end-to-end against a live daemon
- [ ] `osade` CLI has no tests
- [ ] e2e was flaky before the trust-prompt retry landed; watch it in CI

## Release blockers (THIRD-PARTY-NOTICES.md)
- [ ] fetch herdr's LICENSE + NOTICE from the pinned tag into vendor/herdr/0.8.2-p20/
- [ ] generate Rust crate attribution with cargo-about against the pinned Cargo.lock
- [ ] vendor the actual herdr binaries per platform + checksums

## Upstream to herdr
- [ ] `platform::interactive_shell_command` should use the call operator with arguments on
      Windows rather than `Start-Process`, which cannot execute npm shims (PRD-DELTA #13a.2)
- [ ] `events.subscribe` replays the ring buffer despite starting at `current_sequence()`
      (PRD-DELTA #5)

## Repo hygiene (PRD-DELTA #14)
- [ ] move herdr's AGENTS.md, .github/ and .agents/skills/herdr-* under backend/
- [ ] decide backend/: submodule, vendored at a pinned tag, or fetched by script
- [ ] add a security contact to docs/SECURITY.md, or enable private vulnerability reporting
