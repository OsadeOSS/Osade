/**
 * @osade/contract — OSADE.md §5.5.
 *
 * INVARIANT: the only cross-boundary types. daemon↔renderer, daemon↔CLI, daemon↔hook all go
 * through here. tRPC procedures declare `.output()` with these schemas, so renderer types are
 * derived and never hand-written. Nothing crosses a boundary untyped.
 */
export * from './primitives.js';
export * from './facts.js';
export * from './ws.js';
