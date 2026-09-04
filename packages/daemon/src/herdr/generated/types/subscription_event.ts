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

/**
 * This interface was referenced by `SubscriptionEvent`'s JSON-Schema
 * via the `definition` "SubscriptionEventData".
 */
export type SubscriptionEventData =
  PaneOutputMatchedEvent | PaneAgentStatusChangedEvent | PaneScrollChangedEvent;
/**
 * This interface was referenced by `SubscriptionEvent`'s JSON-Schema
 * via the `definition` "ReadFormat".
 */
export type ReadFormat = 'text' | 'ansi';
/**
 * This interface was referenced by `SubscriptionEvent`'s JSON-Schema
 * via the `definition` "ReadSource".
 */
export type ReadSource = 'visible' | 'recent' | 'recent_unwrapped' | 'detection';
/**
 * This interface was referenced by `SubscriptionEvent`'s JSON-Schema
 * via the `definition` "AgentStatus".
 */
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';
/**
 * This interface was referenced by `SubscriptionEvent`'s JSON-Schema
 * via the `definition` "SubscriptionEventKind".
 */
export type SubscriptionEventKind =
  'pane.output_matched' | 'pane.agent_status_changed' | 'pane.scroll_changed';

export interface SubscriptionEvent {
  data: SubscriptionEventData;
  event: SubscriptionEventKind;
}
/**
 * This interface was referenced by `SubscriptionEvent`'s JSON-Schema
 * via the `definition` "PaneOutputMatchedEvent".
 */
export interface PaneOutputMatchedEvent {
  matched_line: string;
  pane_id: string;
  read: PaneReadResult;
}
/**
 * This interface was referenced by `SubscriptionEvent`'s JSON-Schema
 * via the `definition` "PaneReadResult".
 */
export interface PaneReadResult {
  format: ReadFormat;
  pane_id: string;
  revision: number;
  source: ReadSource;
  tab_id: string;
  text: string;
  truncated: boolean;
  workspace_id: string;
}
/**
 * This interface was referenced by `SubscriptionEvent`'s JSON-Schema
 * via the `definition` "PaneAgentStatusChangedEvent".
 */
export interface PaneAgentStatusChangedEvent {
  agent?: string | null;
  agent_status: AgentStatus;
  display_agent?: string | null;
  pane_id: string;
  state_labels?: {
    [k: string]: string;
  };
  title?: string | null;
  workspace_id: string;
}
/**
 * This interface was referenced by `SubscriptionEvent`'s JSON-Schema
 * via the `definition` "PaneScrollChangedEvent".
 */
export interface PaneScrollChangedEvent {
  pane_id: string;
  scroll: PaneScrollInfo;
  workspace_id: string;
}
/**
 * This interface was referenced by `SubscriptionEvent`'s JSON-Schema
 * via the `definition` "PaneScrollInfo".
 */
export interface PaneScrollInfo {
  max_offset_from_bottom: number;
  offset_from_bottom: number;
  viewport_rows: number;
}
