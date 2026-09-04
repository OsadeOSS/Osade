/**
 * GENERATED — DO NOT EDIT.
 *
 * Source: vendor/herdr/0.8.2-p20/api-schema.json
 * Regenerate: pnpm herdr:codegen
 *
 * OSADE.md §4.1 — the pinned schema is the only codegen source. Never hand-write a herdr
 * method name, and never derive one from backend/.
 */

/* eslint-disable */

export interface ErrorResponse {
  error: ErrorBody;
  id: string;
}
/**
 * This interface was referenced by `ErrorResponse`'s JSON-Schema
 * via the `definition` "ErrorBody".
 */
export interface ErrorBody {
  code: string;
  message: string;
}
