# todo

## done
- [x] remove things in .gitignore that should be in repo — herdr's `/docs/*` rule was hiding
      the whole spec directory
- [x] readme new — rewrote against the current architecture (was a Code-OSS fork)
- [x] fold PRD-DELTA into OSADE.md (15 deltas, markers on each section)
- [x] pin the herdr target — `vendor/herdr/0.8.2-p20/`, §4.1.1 drift check specced
- [x] licensing leftovers — LICENSE (Apache-2.0), NOTICE, THIRD-PARTY-NOTICES.md,
      CONTRIBUTING.md, docs/SECURITY.md; VS Code's ThirdPartyNotices deleted
- [x] surface question answered — ADR 0001, no embedded terminal in M0

## M0 — in progress
- [x] typed herdr client generated from the pinned schema
- [x] boot drift check (protocol + method set, never the version string)
- [x] sqlite + forward-only migrations + change_log triggers + CDC broadcaster
- [x] contract package (task, agent_fact, WS message union)
- [x] deriveStatus rows 4, 10, 11, 13, 14 + ordering property test
- [x] event subscriber as an N+1 connection manager, with the monotonic fact gate
- [ ] daemon http/trpc/ws server — wire CdcBroadcaster to a real websocket on 127.0.0.1
- [ ] launch-task.ts — prune, worktree.create, mirror, tab.create with env, watchPane,
      agent.start, trust-prompt recovery (§8.2)
- [ ] `osade` CLI (`packages/cli`) so a task can be driven without the UI
- [ ] apps/desktop — userData redirect, supervisor (detached spawn, HERDR_STARTUP_CWD cleared),
      ledger + task detail + diff + verify log
- [ ] e2e: real herdr, real git fixture, one full task

## release blockers (from THIRD-PARTY-NOTICES.md)
- [ ] fetch herdr's LICENSE + NOTICE from the pinned tag into vendor/herdr/0.8.2-p20/
- [ ] generate the Rust crate attribution with cargo-about against the pinned Cargo.lock
- [ ] vendor the actual herdr binaries per platform + checksums

## repo hygiene (PRD-DELTA #14)
- [ ] move herdr's AGENTS.md, .github/ and .agents/skills/herdr-* under backend/
- [ ] decide backend/: submodule, vendored at a pinned tag, or fetched by script
- [ ] add a security contact to docs/SECURITY.md, or enable private vulnerability reporting
- [] remove herdr's name from the repo
