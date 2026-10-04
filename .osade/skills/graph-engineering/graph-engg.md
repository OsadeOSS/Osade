# Graph Engineering Practice

Graph engineering makes relationships explicit so the coding agent can reason about order,
ownership, propagation, and verification. The graph is a temporary decision tool, not a diagram
deliverable by default.

## Trigger signals

Use this practice when one or more signals appear:

- a change crosses three or more components, packages, processes, schemas, or lifecycle states;
- ownership is unclear because data, control, or errors propagate through several boundaries;
- a migration, pipeline, build graph, state machine, or dependency chain has ordering constraints;
- a symptom may have several upstream causes or several downstream consumers;
- work is blocked on identifying a critical path, cycle, fan-out, or safe cut point.

Do not use it for a linear one- or two-file edit, as a substitute for reading the code, or to
draw a large architecture map that will not change the next action.

## Workflow

1. **State the decision.** Write the question the graph must answer and the scope boundary.
2. **Choose one graph meaning.** Define node and edge semantics before collecting them—for
   example, modules with "imports," states with "may transition to," or artifacts with
   "produces/consumes." Do not mix meanings in an unlabeled edge.
3. **Extract the minimum graph.** Use source search, types, configs, tests, and runtime evidence.
   Record each node/edge with its evidence path. Include unknown or disputed edges explicitly.
4. **Analyze structure.** Identify roots/sinks, fan-in/fan-out, cycles or strongly connected
   groups, cut points, and the critical path relevant to the decision. Ignore unrelated regions.
5. **Select a frontier.** Choose the smallest node or edge whose validation unlocks downstream
   work. For acyclic dependencies, work in topological order; for a cycle, establish or change a
   contract at a deliberate seam before editing the whole group.
6. **Implement and verify edges.** Change a bounded slice, test the node contract, then test each
   affected incoming/outgoing edge. Update the graph when code disproves an assumption.
7. **Close the graph.** Run the end-to-end path and report changed nodes, affected edges,
   evidence, and residual unknowns. Keep a durable graph only if future maintenance needs it.

## Good and bad usage

Good usage has explicit edge semantics, source-backed relationships, a small task-specific
subgraph, visible unknowns, and an implementation order derived from structure. It validates
both nodes and the contracts between them.

Bad usage is an exhaustive unlabeled box diagram, an import graph mistaken for runtime flow,
unverified guessed edges, topology that never affects the plan, or changing every node in a
cycle at once without establishing a seam.

## Interaction with other practices

- **Prime Agent:** uses the graph as the recursive decomposition and synthesis map. Prime Agent
  owns context and completion; this practice owns relationships and work order.
- **Loop Engineering:** validates one selected node/edge at a time and feeds the result back into
  the graph.
- **Memory Harness (`memo-harness`):** use only when graph extraction or traversal is a repeated,
  measurable harness workflow. Persist stable dependency patterns, not a stale snapshot of code.
- **Dream RSI:** use the graph to define legal or structurally distinct proposal frontiers.
  Dream RSI owns scored exploration; graph structure must not leak unrevealed outcomes.

The output may be a compact adjacency list or table followed by the chosen frontier, change
order, edge-level checks, and remaining unknowns. A visual diagram is optional.
