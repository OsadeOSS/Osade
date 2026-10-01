# Agent handler

How Osade attaches context to a send, runs a model without a task worktree, and retrieves memory. The four source comments that point here (`compose-attach.ts`, `headless-run.ts`, `headless-model.ts`, `memory.ts`) match the three sections below.

Related: [chat.md](chat.md) for composer routing and lanes; [OSADE.md](OSADE.md) §15 for the earlier vector-store assumption this file supersedes for memory.

## §1 Lane context prepended to a composer send

The renderer never pastes the file, hunk, checks log or rule into the text box. It builds a `ComposerAttach` — a `label` plus a fenced `fence` — and `prependAttach` puts that fence **above** the typed message. Example shape:

    ```file
    src/auth.ts L12–L40
    …slice…
    ```

    why did this refresh fail?

Helpers live in `apps/desktop/src/renderer/compose-attach.ts`:

| Helper | Fence | When |
| --- | --- | --- |
| `fileAttach` | `file` | whole file, or a line range from selection offsets |
| `hunkAttach` | `diff` | the hunk under the cursor in the Diff pane |
| `checksAttach` | `checks` | a Checks step name plus log tail |
| `rulesAttach` | `rules` | a rule id and its text |

`prependAttach(message, attach)` is a no-op when `attach` is null or the fence is blank. The daemon still sees one `taskSend` / `agent.prompt`; the attach is just prefix text.

## §2 Headless generation through an installed agent

Some daemon paths need a model completion **without** a chat lane or a task worktree: extract a title, classify, turn a note into JSON. Those go through `HeadlessRuns` (`packages/daemon/src/domain/headless-run.ts`).

- Empty temp cwd. The agent must not touch the repo.
- The command is an agent the user already installed (`claude`, `codex`, …) from repo settings or the first one that can run headless.
- `NoHeadlessAgentError` if nothing installed can run that way.

`HeadlessModel` (`packages/daemon/src/knowledge/headless-model.ts`) is a `ModelPort` on top of that. It concatenates `system` and `user`, picks a tighter timeout for the `extract` pass (90s vs 180s), and returns the raw text. Callers that need JSON still ask for JSON and parse defensively. This is the local-agent stand-in for an Anthropic API key.

## §3 Memory retrieval via FTS5

OSADE.md §15 assumed a vector store (`memory_vec`). That needs an embedding model and a key. What ships today is SQLite FTS5 (`packages/daemon/src/knowledge/memory.ts`). `memory_vec` is not created.

`searchMemory(db, query, filters, limit)` builds an FTS query, optionally narrows by `scope` / `scope_id`, and returns `MemoryHit` rows (`id`, `scope`, `scopeId`, `kind`, `text`, `confidence`). An empty or unusable query returns `[]`.
