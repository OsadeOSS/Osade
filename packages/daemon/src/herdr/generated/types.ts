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

// ── request ───────────────────────────────────────────────────────

export type Request = {
  id: string;
} & (
  | {
      method: 'ping';
      params: PingParams;
    }
  | {
      method: 'server.stop';
      params: EmptyParams;
    }
  | {
      method: 'server.live_handoff';
      params: ServerLiveHandoffParams;
    }
  | {
      method: 'server.reload_config';
      params: EmptyParams;
    }
  | {
      method: 'server.agent_manifests';
      params: EmptyParams;
    }
  | {
      method: 'server.reload_agent_manifests';
      params: EmptyParams;
    }
  | {
      method: 'notification.show';
      params: NotificationShowParams;
    }
  | {
      method: 'client.window_title.set';
      params: ClientWindowTitleSetParams;
    }
  | {
      method: 'client.window_title.clear';
      params: EmptyParams;
    }
  | {
      method: 'session.snapshot';
      params: EmptyParams;
    }
  | {
      method: 'workspace.create';
      params: WorkspaceCreateParams;
    }
  | {
      method: 'workspace.list';
      params: EmptyParams;
    }
  | {
      method: 'workspace.get';
      params: WorkspaceTarget;
    }
  | {
      method: 'workspace.focus';
      params: WorkspaceTarget;
    }
  | {
      method: 'workspace.rename';
      params: WorkspaceRenameParams;
    }
  | {
      method: 'workspace.move';
      params: WorkspaceMoveParams;
    }
  | {
      method: 'workspace.move_block';
      params: WorkspaceMoveBlockParams;
    }
  | {
      method: 'workspace.report_metadata';
      params: WorkspaceReportMetadataParams;
    }
  | {
      method: 'workspace.close';
      params: WorkspaceTarget;
    }
  | {
      method: 'worktree.list';
      params: WorktreeListParams;
    }
  | {
      method: 'worktree.create';
      params: WorktreeCreateParams;
    }
  | {
      method: 'worktree.open';
      params: WorktreeOpenParams;
    }
  | {
      method: 'worktree.remove';
      params: WorktreeRemoveParams;
    }
  | {
      method: 'tab.create';
      params: TabCreateParams;
    }
  | {
      method: 'tab.list';
      params: TabListParams;
    }
  | {
      method: 'tab.get';
      params: TabTarget;
    }
  | {
      method: 'tab.focus';
      params: TabTarget;
    }
  | {
      method: 'tab.rename';
      params: TabRenameParams;
    }
  | {
      method: 'tab.move';
      params: TabMoveParams;
    }
  | {
      method: 'tab.close';
      params: TabTarget;
    }
  | {
      method: 'agent.list';
      params: EmptyParams;
    }
  | {
      method: 'agent.get';
      params: AgentTarget;
    }
  | {
      method: 'agent.read';
      params: AgentReadParams;
    }
  | {
      method: 'agent.explain';
      params: AgentTarget;
    }
  | {
      method: 'agent.send_keys';
      params: AgentSendKeysParams;
    }
  | {
      method: 'agent.rename';
      params: AgentRenameParams;
    }
  | {
      method: 'agent.view.set';
      params: AgentViewSetParams;
    }
  | {
      method: 'agent.view.clear';
      params: AgentViewClearParams;
    }
  | {
      method: 'agent.focus';
      params: AgentTarget;
    }
  | {
      method: 'agent.start';
      params: AgentStartParams;
    }
  | {
      method: 'agent.prompt';
      params: AgentPromptParams;
    }
  | {
      method: 'agent.wait';
      params: AgentWaitParams;
    }
  | {
      method: 'pane.split';
      params: PaneSplitParams;
    }
  | {
      method: 'pane.swap';
      params: PaneSwapParams;
    }
  | {
      method: 'pane.move';
      params: PaneMoveParams;
    }
  | {
      method: 'pane.zoom';
      params: PaneZoomParams;
    }
  | {
      method: 'pane.layout';
      params: PaneLayoutParams;
    }
  | {
      method: 'pane.process_info';
      params: PaneProcessInfoParams;
    }
  | {
      method: 'layout.export';
      params: LayoutExportParams;
    }
  | {
      method: 'layout.apply';
      params: LayoutApplyParams;
    }
  | {
      method: 'layout.set_split_ratio';
      params: LayoutSetSplitRatioParams;
    }
  | {
      method: 'pane.neighbor';
      params: PaneNeighborParams;
    }
  | {
      method: 'pane.edges';
      params: PaneEdgesParams;
    }
  | {
      method: 'pane.focus_direction';
      params: PaneFocusDirectionParams;
    }
  | {
      method: 'pane.resize';
      params: PaneResizeParams;
    }
  | {
      method: 'pane.list';
      params: PaneListParams;
    }
  | {
      method: 'pane.current';
      params: PaneCurrentParams;
    }
  | {
      method: 'pane.get';
      params: PaneTarget;
    }
  | {
      method: 'pane.focus';
      params: PaneTarget;
    }
  | {
      method: 'pane.input.set';
      params: PaneInputSetParams;
    }
  | {
      method: 'pane.rename';
      params: PaneRenameParams;
    }
  | {
      method: 'pane.send_text';
      params: PaneSendTextParams;
    }
  | {
      method: 'pane.send_keys';
      params: PaneSendKeysParams;
    }
  | {
      method: 'pane.send_input';
      params: PaneSendInputParams;
    }
  | {
      method: 'pane.read';
      params: PaneReadParams;
    }
  | {
      method: 'pane.graphics.set';
      params: PaneGraphicsSetParams;
    }
  | {
      method: 'pane.graphics.clear';
      params: PaneGraphicsClearParams;
    }
  | {
      method: 'pane.graphics.info';
      params: PaneTarget;
    }
  | {
      method: 'pane.report_agent';
      params: PaneReportAgentParams;
    }
  | {
      method: 'pane.report_agent_session';
      params: PaneReportAgentSessionParams;
    }
  | {
      method: 'pane.report_metadata';
      params: PaneReportMetadataParams;
    }
  | {
      method: 'pane.clear_agent_authority';
      params: PaneClearAgentAuthorityParams;
    }
  | {
      method: 'pane.release_agent';
      params: PaneReleaseAgentParams;
    }
  | {
      method: 'pane.close';
      params: PaneTarget;
    }
  | {
      method: 'popup.close';
      params: EmptyParams;
    }
  | {
      method: 'events.subscribe';
      params: EventsSubscribeParams;
    }
  | {
      method: 'events.wait';
      params: EventsWaitParams;
    }
  | {
      method: 'pane.wait_for_output';
      params: PaneWaitForOutputParams;
    }
  | {
      method: 'integration.install';
      params: IntegrationInstallParams;
    }
  | {
      method: 'integration.uninstall';
      params: IntegrationUninstallParams;
    }
  | {
      method: 'plugin.link';
      params: PluginLinkParams;
    }
  | {
      method: 'plugin.list';
      params: PluginListParams;
    }
  | {
      method: 'plugin.unlink';
      params: PluginUnlinkParams;
    }
  | {
      method: 'plugin.enable';
      params: PluginSetEnabledParams;
    }
  | {
      method: 'plugin.disable';
      params: PluginSetEnabledParams;
    }
  | {
      method: 'plugin.action.list';
      params: PluginActionListParams;
    }
  | {
      method: 'plugin.action.invoke';
      params: PluginActionInvokeParams;
    }
  | {
      method: 'plugin.log.list';
      params: PluginLogListParams;
    }
  | {
      method: 'plugin.pane.open';
      params: PluginPaneOpenParams;
    }
  | {
      method: 'plugin.pane.focus';
      params: PluginPaneFocusParams;
    }
  | {
      method: 'plugin.pane.close';
      params: PluginPaneCloseParams;
    }
);
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentStatus".
 */
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ReadSource".
 */
export type ReadSource = 'visible' | 'recent' | 'recent_unwrapped' | 'detection';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentViewBuiltinField".
 */
export type AgentViewBuiltinField =
  'status' | 'workspace_id' | 'tab_id' | 'pane_id' | 'agent' | 'seen' | 'state_change_seq';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentViewBuiltinSortField".
 */
export type AgentViewBuiltinSortField =
  | 'workspace_order'
  | 'tab_order'
  | 'pane_order'
  | 'attention'
  | 'status'
  | 'agent'
  | 'seen'
  | 'state_change_seq';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentViewContext".
 */
export type AgentViewContext = 'current_workspace_id' | 'current_tab_id';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentViewField".
 */
export type AgentViewField =
  | AgentViewBuiltinField
  | {
      token: string;
    };
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentViewFilter".
 */
export type AgentViewFilter =
  | {
      filters: AgentViewFilter[];
      op: 'all';
    }
  | {
      filters: AgentViewFilter[];
      op: 'any';
    }
  | {
      filter: AgentViewFilter;
      op: 'not';
    }
  | {
      field: AgentViewField;
      op: 'eq';
      value: AgentViewValue;
    }
  | {
      field: AgentViewField;
      op: 'in';
      values: AgentViewValue[];
    }
  | {
      field: AgentViewField;
      op: 'exists';
    };
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentViewValue".
 */
export type AgentViewValue =
  | string
  | boolean
  | number
  | {
      context: AgentViewContext;
    };
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentViewSortField".
 */
export type AgentViewSortField =
  | AgentViewBuiltinSortField
  | {
      token: string;
    };
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentViewSortOrder".
 */
export type AgentViewSortOrder = 'asc' | 'desc';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "EventMatch".
 */
export type EventMatch =
  | {
      event: 'workspace_created';
      workspace_id?: string | null;
    }
  | {
      event: 'workspace_updated';
      workspace_id: string;
    }
  | {
      event: 'workspace_closed';
      workspace_id: string;
    }
  | {
      event: 'workspace_renamed';
      label?: string | null;
      workspace_id: string;
    }
  | {
      event: 'workspace_moved';
      workspace_id: string;
    }
  | {
      event: 'workspace_focused';
      workspace_id: string;
    }
  | {
      event: 'tab_created';
      tab_id?: string | null;
      workspace_id?: string | null;
    }
  | {
      event: 'tab_closed';
      tab_id: string;
    }
  | {
      event: 'tab_renamed';
      label?: string | null;
      tab_id: string;
    }
  | {
      event: 'tab_moved';
      tab_id: string;
    }
  | {
      event: 'tab_focused';
      tab_id: string;
    }
  | {
      event: 'pane_created';
      pane_id?: string | null;
      workspace_id?: string | null;
    }
  | {
      event: 'pane_closed';
      pane_id: string;
    }
  | {
      event: 'pane_focused';
      pane_id: string;
    }
  | {
      event: 'pane_moved';
      pane_id: string;
    }
  | {
      event: 'pane_output_changed';
      min_revision?: number | null;
      pane_id: string;
    }
  | {
      event: 'pane_exited';
      pane_id: string;
    }
  | {
      agent?: string | null;
      event: 'pane_agent_detected';
      pane_id: string;
    }
  | {
      agent_status: AgentStatus;
      event: 'pane_agent_status_changed';
      pane_id: string;
    };
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "Subscription".
 */
export type Subscription =
  | {
      type: 'workspace.created';
    }
  | {
      type: 'workspace.updated';
    }
  | {
      type: 'workspace.metadata_updated';
    }
  | {
      type: 'workspace.renamed';
    }
  | {
      type: 'workspace.moved';
    }
  | {
      type: 'workspace.reordered';
    }
  | {
      type: 'workspace.closed';
    }
  | {
      type: 'workspace.focused';
    }
  | {
      type: 'worktree.created';
    }
  | {
      type: 'worktree.opened';
    }
  | {
      type: 'worktree.removed';
    }
  | {
      type: 'tab.created';
    }
  | {
      type: 'tab.closed';
    }
  | {
      type: 'tab.focused';
    }
  | {
      type: 'tab.renamed';
    }
  | {
      type: 'tab.moved';
    }
  | {
      type: 'pane.created';
    }
  | {
      type: 'pane.closed';
    }
  | {
      type: 'pane.updated';
    }
  | {
      type: 'pane.focused';
    }
  | {
      type: 'pane.moved';
    }
  | {
      type: 'pane.exited';
    }
  | {
      type: 'pane.agent_detected';
    }
  | {
      lines?: number | null;
      match: OutputMatch;
      pane_id: string;
      source: ReadSource;
      strip_ansi?: boolean;
      type: 'pane.output_matched';
    }
  | {
      agent_status?: AgentStatus | null;
      pane_id: string;
      type: 'pane.agent_status_changed';
    }
  | {
      pane_id: string;
      type: 'pane.scroll_changed';
    }
  | {
      type: 'layout.updated';
    };
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "OutputMatch".
 */
export type OutputMatch =
  | {
      type: 'substring';
      value: string;
    }
  | {
      type: 'regex';
      value: string;
    };
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "IntegrationTarget".
 */
export type IntegrationTarget =
  | 'pi'
  | 'omp'
  | 'claude'
  | 'codex'
  | 'copilot'
  | 'devin'
  | 'droid'
  | 'kimi'
  | 'opencode'
  | 'kilo'
  | 'hermes'
  | 'qodercli'
  | 'qwen'
  | 'cursor'
  | 'mastracode'
  | 'antigravity_cli'
  | 'grok';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "LayoutNode".
 */
export type LayoutNode =
  | {
      command?: string[] | null;
      cwd?: string | null;
      env?: {
        [k: string]: string;
      };
      label?: string | null;
      pane_id?: string | null;
      type: 'pane';
    }
  | {
      direction: SplitDirection;
      first: LayoutNode;
      ratio: number;
      second: LayoutNode;
      type: 'split';
    };
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "SplitDirection".
 */
export type SplitDirection = 'right' | 'down';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ToastHerdrPosition".
 */
export type ToastHerdrPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "NotificationShowSound".
 */
export type NotificationShowSound = 'none' | 'done' | 'request';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneAgentState".
 */
export type PaneAgentState = 'idle' | 'working' | 'blocked' | 'unknown';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneDirection".
 */
export type PaneDirection = 'left' | 'right' | 'up' | 'down';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneGraphicsFormat".
 */
export type PaneGraphicsFormat = 'png' | 'rgb' | 'rgba' | 'bgra';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneRightClickTarget".
 */
export type PaneRightClickTarget = 'herdr' | 'pane';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneMoveDestination".
 */
export type PaneMoveDestination =
  | {
      ratio?: number | null;
      split: SplitDirection;
      tab_id: string;
      target_pane_id?: string | null;
      type: 'tab';
    }
  | {
      label?: string | null;
      type: 'new_tab';
      workspace_id?: string | null;
    }
  | {
      label?: string | null;
      tab_label?: string | null;
      type: 'new_workspace';
    };
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneZoomMode".
 */
export type PaneZoomMode = 'toggle' | 'on' | 'off';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PopupSize".
 */
export type PopupSize = number | string;
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PluginPanePlacement".
 */
export type PluginPanePlacement = 'overlay' | 'popup' | 'split' | 'tab' | 'zoomed';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PluginSourceKind".
 */
export type PluginSourceKind = 'local' | 'github';
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ReadFormat".
 */
export type ReadFormat = 'text' | 'ansi';

/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentPromptParams".
 */
export interface AgentPromptParams {
  target: string;
  text: string;
  wait?: AgentPromptWaitOptions | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentPromptWaitOptions".
 */
export interface AgentPromptWaitOptions {
  timeout_ms?: number | null;
  until?: AgentStatus[];
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentReadParams".
 */
export interface AgentReadParams {
  format?: 'text' | 'ansi';
  lines?: number | null;
  source: ReadSource;
  strip_ansi?: boolean;
  target: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentRenameParams".
 */
export interface AgentRenameParams {
  name?: string | null;
  target: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentSendKeysParams".
 */
export interface AgentSendKeysParams {
  keys: string[];
  target: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentStartParams".
 */
export interface AgentStartParams {
  args?: string[];
  kind: string;
  name: string;
  pane_id: string;
  /**
   * Startup timeout in milliseconds. Values must be greater than 3000 and at most 300000.
   */
  timeout_ms?: number | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentTarget".
 */
export interface AgentTarget {
  target: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentViewClearParams".
 */
export interface AgentViewClearParams {
  source?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentViewSetParams".
 */
export interface AgentViewSetParams {
  filter?: AgentViewFilter | null;
  label?: string | null;
  sort?: AgentViewSort[];
  source: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentViewSort".
 */
export interface AgentViewSort {
  field: AgentViewSortField;
  order?: 'asc' | 'desc';
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "AgentWaitParams".
 */
export interface AgentWaitParams {
  target: string;
  timeout_ms?: number | null;
  until?: AgentStatus[];
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ClientWindowTitleSetParams".
 */
export interface ClientWindowTitleSetParams {
  title: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "EmptyParams".
 */
export interface EmptyParams {}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "EventsSubscribeParams".
 */
export interface EventsSubscribeParams {
  subscriptions: Subscription[];
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "EventsWaitParams".
 */
export interface EventsWaitParams {
  match_event: EventMatch;
  timeout_ms?: number | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "IntegrationInstallParams".
 */
export interface IntegrationInstallParams {
  target: IntegrationTarget;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "IntegrationUninstallParams".
 */
export interface IntegrationUninstallParams {
  target: IntegrationTarget;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "LayoutApplyParams".
 */
export interface LayoutApplyParams {
  focus?: boolean;
  root: LayoutNode;
  tab_id?: string | null;
  tab_label?: string | null;
  workspace_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "LayoutExportParams".
 */
export interface LayoutExportParams {
  pane_id?: string | null;
  tab_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "LayoutSetSplitRatioParams".
 */
export interface LayoutSetSplitRatioParams {
  pane_id?: string | null;
  path: boolean[];
  ratio: number;
  tab_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "NotificationShowParams".
 */
export interface NotificationShowParams {
  body?: string | null;
  position?: ToastHerdrPosition | null;
  sound?: NotificationShowSound;
  title: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneClearAgentAuthorityParams".
 */
export interface PaneClearAgentAuthorityParams {
  pane_id: string;
  seq?: number | null;
  source?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneCurrentParams".
 */
export interface PaneCurrentParams {
  caller_pane_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneEdgesParams".
 */
export interface PaneEdgesParams {
  pane_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneFocusDirectionParams".
 */
export interface PaneFocusDirectionParams {
  direction: PaneDirection;
  pane_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneGraphicsClearParams".
 */
export interface PaneGraphicsClearParams {
  layer_id?: string | null;
  pane_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneGraphicsPlacementParams".
 */
export interface PaneGraphicsPlacementParams {
  grid_cols?: number;
  grid_rows?: number;
  viewport_col?: number;
  viewport_row?: number;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneGraphicsSetParams".
 */
export interface PaneGraphicsSetParams {
  data_base64?: string;
  format: PaneGraphicsFormat;
  image_height: number;
  image_width: number;
  layer_id?: string | null;
  pane_id: string;
  placement?: PaneGraphicsPlacementParams1;
  z_index?: number;
}
export interface PaneGraphicsPlacementParams1 {
  grid_cols?: number;
  grid_rows?: number;
  viewport_col?: number;
  viewport_row?: number;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneInputSetParams".
 */
export interface PaneInputSetParams {
  pane_id: string;
  right_click: PaneRightClickTarget;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneLayoutParams".
 */
export interface PaneLayoutParams {
  pane_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneListParams".
 */
export interface PaneListParams {
  workspace_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneMoveParams".
 */
export interface PaneMoveParams {
  destination: PaneMoveDestination;
  focus?: boolean;
  pane_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneNeighborParams".
 */
export interface PaneNeighborParams {
  direction: PaneDirection;
  pane_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneProcessInfoParams".
 */
export interface PaneProcessInfoParams {
  pane_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneReadParams".
 */
export interface PaneReadParams {
  format?: 'text' | 'ansi';
  lines?: number | null;
  pane_id: string;
  source: ReadSource;
  strip_ansi?: boolean;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneReleaseAgentParams".
 */
export interface PaneReleaseAgentParams {
  agent: string;
  pane_id: string;
  seq?: number | null;
  source: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneRenameParams".
 */
export interface PaneRenameParams {
  label?: string | null;
  pane_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneReportAgentParams".
 */
export interface PaneReportAgentParams {
  agent: string;
  agent_session_id?: string | null;
  agent_session_path?: string | null;
  message?: string | null;
  pane_id: string;
  seq?: number | null;
  source: string;
  state: PaneAgentState;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneReportAgentSessionParams".
 */
export interface PaneReportAgentSessionParams {
  agent: string;
  agent_session_id?: string | null;
  agent_session_path?: string | null;
  pane_id: string;
  seq?: number | null;
  session_start_source?: string | null;
  source: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneReportMetadataParams".
 */
export interface PaneReportMetadataParams {
  agent?: string | null;
  applies_to_source?: string | null;
  clear_display_agent?: boolean;
  clear_state_labels?: boolean;
  clear_title?: boolean;
  display_agent?: string | null;
  pane_id: string;
  seq?: number | null;
  source: string;
  state_labels?: {
    [k: string]: string;
  };
  title?: string | null;
  tokens?: {
    [k: string]: string | null;
  };
  ttl_ms?: number | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneResizeParams".
 */
export interface PaneResizeParams {
  amount?: number | null;
  direction: PaneDirection;
  pane_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneSendInputParams".
 */
export interface PaneSendInputParams {
  keys?: string[];
  pane_id: string;
  text?: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneSendKeysParams".
 */
export interface PaneSendKeysParams {
  keys: string[];
  pane_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneSendTextParams".
 */
export interface PaneSendTextParams {
  pane_id: string;
  text: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneSplitParams".
 */
export interface PaneSplitParams {
  cwd?: string | null;
  direction: SplitDirection;
  env?: {
    [k: string]: string;
  };
  focus?: boolean;
  ratio?: number | null;
  right_click?: 'herdr' | 'pane';
  target_pane_id?: string | null;
  workspace_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneSwapParams".
 */
export interface PaneSwapParams {
  direction?: PaneDirection | null;
  pane_id?: string | null;
  source_pane_id?: string | null;
  target_pane_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneTarget".
 */
export interface PaneTarget {
  pane_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneWaitForOutputParams".
 */
export interface PaneWaitForOutputParams {
  lines?: number | null;
  match: OutputMatch;
  pane_id: string;
  source: ReadSource;
  strip_ansi?: boolean;
  timeout_ms?: number | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PaneZoomParams".
 */
export interface PaneZoomParams {
  mode?: 'toggle' | 'on' | 'off';
  pane_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PingParams".
 */
export interface PingParams {}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PluginActionInvokeParams".
 */
export interface PluginActionInvokeParams {
  action_id: string;
  context?: PluginInvocationContext | null;
  plugin_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PluginInvocationContext".
 */
export interface PluginInvocationContext {
  clicked_url?: string | null;
  correlation_id?: string | null;
  focused_pane_agent?: string | null;
  focused_pane_cwd?: string | null;
  focused_pane_id?: string | null;
  focused_pane_status?: AgentStatus | null;
  invocation_source?: string | null;
  link_handler_id?: string | null;
  selected_text?: string | null;
  tab_id?: string | null;
  tab_label?: string | null;
  workspace_cwd?: string | null;
  workspace_id?: string | null;
  workspace_label?: string | null;
  worktree?: WorkspaceWorktreeInfo | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WorkspaceWorktreeInfo".
 */
export interface WorkspaceWorktreeInfo {
  checkout_path: string;
  is_linked_worktree: boolean;
  repo_key: string;
  repo_name: string;
  repo_root: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PluginActionListParams".
 */
export interface PluginActionListParams {
  plugin_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PluginLinkParams".
 */
export interface PluginLinkParams {
  enabled?: boolean;
  path: string;
  source?: PluginSourceInfo | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PluginSourceInfo".
 */
export interface PluginSourceInfo {
  installed_unix_ms?: number | null;
  kind?: 'local' | 'github';
  managed_path?: string | null;
  owner?: string | null;
  repo?: string | null;
  requested_ref?: string | null;
  resolved_commit?: string | null;
  subdir?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PluginListParams".
 */
export interface PluginListParams {
  plugin_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PluginLogListParams".
 */
export interface PluginLogListParams {
  limit?: number | null;
  plugin_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PluginPaneCloseParams".
 */
export interface PluginPaneCloseParams {
  pane_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PluginPaneFocusParams".
 */
export interface PluginPaneFocusParams {
  pane_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PluginPaneOpenParams".
 */
export interface PluginPaneOpenParams {
  cwd?: string | null;
  direction?: SplitDirection | null;
  entrypoint: string;
  env?: {
    [k: string]: string;
  };
  focus?: boolean;
  height?: PopupSize | null;
  placement?: PluginPanePlacement | null;
  plugin_id: string;
  target_pane_id?: string | null;
  width?: PopupSize | null;
  workspace_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PluginSetEnabledParams".
 */
export interface PluginSetEnabledParams {
  plugin_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "PluginUnlinkParams".
 */
export interface PluginUnlinkParams {
  plugin_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "ServerLiveHandoffParams".
 */
export interface ServerLiveHandoffParams {
  expected_protocol?: number | null;
  expected_version?: string | null;
  import_exe?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "TabCreateParams".
 */
export interface TabCreateParams {
  cwd?: string | null;
  env?: {
    [k: string]: string;
  };
  focus?: boolean;
  label?: string | null;
  workspace_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "TabListParams".
 */
export interface TabListParams {
  workspace_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "TabMoveParams".
 */
export interface TabMoveParams {
  insert_index: number;
  tab_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "TabRenameParams".
 */
export interface TabRenameParams {
  label: string;
  tab_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "TabTarget".
 */
export interface TabTarget {
  tab_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WorkspaceCreateParams".
 */
export interface WorkspaceCreateParams {
  cwd?: string | null;
  env?: {
    [k: string]: string;
  };
  focus?: boolean;
  label?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WorkspaceMoveBlockParams".
 */
export interface WorkspaceMoveBlockParams {
  before_workspace_id?: string | null;
  workspace_ids: string[];
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WorkspaceMoveParams".
 */
export interface WorkspaceMoveParams {
  insert_index: number;
  workspace_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WorkspaceRenameParams".
 */
export interface WorkspaceRenameParams {
  label: string;
  workspace_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WorkspaceReportMetadataParams".
 */
export interface WorkspaceReportMetadataParams {
  seq?: number | null;
  source: string;
  tokens: {
    [k: string]: string | null;
  };
  ttl_ms?: number | null;
  workspace_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WorkspaceTarget".
 */
export interface WorkspaceTarget {
  workspace_id: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WorktreeCreateParams".
 */
export interface WorktreeCreateParams {
  base?: string | null;
  branch?: string | null;
  cwd?: string | null;
  focus?: boolean;
  label?: string | null;
  path?: string | null;
  workspace_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WorktreeListParams".
 */
export interface WorktreeListParams {
  cwd?: string | null;
  workspace_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WorktreeOpenParams".
 */
export interface WorktreeOpenParams {
  branch?: string | null;
  cwd?: string | null;
  focus?: boolean;
  label?: string | null;
  path?: string | null;
  workspace_id?: string | null;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WorktreeRemoveParams".
 */
export interface WorktreeRemoveParams {
  force?: boolean;
  workspace_id: string;
}

// ── success_response ──────────────────────────────────────────────

/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "ResponseResult".
 */
export type ResponseResult =
  | {
      capabilities?: ServerCapabilities | null;
      protocol: number;
      type: 'pong';
      version: string;
    }
  | {
      snapshot: SessionSnapshot;
      type: 'session_snapshot';
    }
  | {
      type: 'workspace_info';
      workspace: WorkspaceInfo;
    }
  | {
      root_pane: PaneInfo;
      tab: TabInfo;
      type: 'workspace_created';
      workspace: WorkspaceInfo;
    }
  | {
      type: 'workspace_list';
      workspaces: WorkspaceInfo[];
    }
  | {
      source: WorktreeSourceInfo;
      type: 'worktree_list';
      worktrees: WorktreeInfo[];
    }
  | {
      root_pane: PaneInfo;
      tab: TabInfo;
      type: 'worktree_created';
      workspace: WorkspaceInfo;
      worktree: WorktreeInfo;
    }
  | {
      already_open: boolean;
      root_pane: PaneInfo;
      tab: TabInfo;
      type: 'worktree_opened';
      workspace: WorkspaceInfo;
      worktree: WorktreeInfo;
    }
  | {
      forced: boolean;
      path: string;
      type: 'worktree_removed';
      workspace_id: string;
    }
  | {
      tab: TabInfo;
      type: 'tab_info';
    }
  | {
      root_pane: PaneInfo;
      tab: TabInfo;
      type: 'tab_created';
    }
  | {
      tabs: TabInfo[];
      type: 'tab_list';
    }
  | {
      agent: AgentInfo;
      type: 'agent_info';
    }
  | {
      agent: AgentInfo;
      argv: string[];
      type: 'agent_started';
    }
  | {
      agent: AgentInfo;
      type: 'agent_prompted';
    }
  | {
      agents: AgentInfo[];
      type: 'agent_list';
    }
  | {
      active: boolean;
      label?: string | null;
      source?: string | null;
      type: 'agent_view';
    }
  | {
      pane: PaneInfo;
      type: 'pane_info';
    }
  | {
      panes: PaneInfo[];
      type: 'pane_list';
    }
  | {
      pane: PaneInfo;
      type: 'pane_current';
    }
  | {
      swap: PaneSwapResult;
      type: 'pane_swap';
    }
  | {
      move_result: PaneMoveResult;
      type: 'pane_move';
    }
  | {
      type: 'pane_zoom';
      zoom: PaneZoomResult;
    }
  | {
      layout: PaneLayoutSnapshot;
      type: 'pane_layout';
    }
  | {
      process_info: PaneProcessInfo;
      type: 'pane_process_info';
    }
  | {
      layout: LayoutDescription;
      type: 'layout_export';
    }
  | {
      layout: LayoutDescription;
      type: 'layout_apply';
    }
  | {
      layout: LayoutDescription;
      type: 'layout_split_ratio_set';
    }
  | {
      neighbor: PaneNeighborResult;
      type: 'pane_neighbor';
    }
  | {
      edges: PaneEdgesResult;
      type: 'pane_edges';
    }
  | {
      focus: PaneFocusDirectionResult;
      type: 'pane_focus_direction';
    }
  | {
      resize: PaneResizeResult;
      type: 'pane_resize';
    }
  | {
      read: PaneReadResult;
      type: 'pane_read';
    }
  | {
      revision: number;
      sequence: number;
      type: 'pane_graphics_frame_ack';
    }
  | {
      cell_height_px: number;
      cell_width_px: number;
      /**
       * Accepts damage metadata while still consuming a complete canonical file.
       */
      file_frame_damage?: boolean;
      file_frame_direct_max_bytes?: number | null;
      file_frame_directory?: string | null;
      file_frame_formats?: string[];
      file_frame_max_bytes?: number | null;
      file_frame_transport?: string | null;
      max_layers_per_pane?: number;
      /**
       * True only when this pane is on the currently rendered terminal surface.
       */
      pane_visible: boolean;
      pixel_mouse?: boolean;
      type: 'pane_graphics_info';
    }
  | {
      explain: unknown;
      type: 'agent_explain';
    }
  | {
      type: 'subscription_started';
    }
  | {
      event: EventEnvelope;
      type: 'wait_matched';
    }
  | {
      matched_line?: string | null;
      pane_id: string;
      read: PaneReadResult;
      revision: number;
      type: 'output_matched';
    }
  | {
      reason: NotificationShowReason;
      shown: boolean;
      type: 'notification_show';
    }
  | {
      changed: boolean;
      reason: ClientWindowTitleReason;
      type: 'client_window_title';
    }
  | {
      details: IntegrationInstallResult;
      target: IntegrationTarget;
      type: 'integration_install';
    }
  | {
      details: IntegrationUninstallResult;
      target: IntegrationTarget;
      type: 'integration_uninstall';
    }
  | {
      manifests: AgentManifestInfo[];
      type: 'agent_manifest_reload';
    }
  | {
      last_check_unix?: number | null;
      last_result?: string | null;
      manifests: AgentManifestInfo[];
      type: 'agent_manifest_status';
    }
  | {
      plugin: InstalledPluginInfo;
      type: 'plugin_linked';
    }
  | {
      plugins: InstalledPluginInfo[];
      type: 'plugin_list';
    }
  | {
      plugin_id: string;
      removed: boolean;
      type: 'plugin_unlinked';
    }
  | {
      plugin: InstalledPluginInfo;
      type: 'plugin_enabled';
    }
  | {
      plugin: InstalledPluginInfo;
      type: 'plugin_disabled';
    }
  | {
      actions: PluginActionInfo[];
      type: 'plugin_action_list';
    }
  | {
      action: PluginActionInfo;
      context: PluginInvocationContext;
      log: PluginCommandLogInfo;
      type: 'plugin_action_invoked';
    }
  | {
      logs: PluginCommandLogInfo[];
      type: 'plugin_log_list';
    }
  | {
      plugin_pane: PluginPaneInfo;
      type: 'plugin_pane_opened';
    }
  | {
      plugin_pane: PluginPaneInfo;
      type: 'plugin_pane_focused';
    }
  | {
      pane_id: string;
      type: 'plugin_pane_closed';
    }
  | {
      diagnostics: string[];
      status: ConfigReloadStatus;
      type: 'config_reload';
    }
  | {
      type: 'ok';
    };
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "AgentSessionRefKind".
 */
export type AgentSessionRefKind = 'id' | 'path';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "AgentStatus".
 */
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "SplitDirection".
 */
export type SplitDirection = 'right' | 'down';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneSwapReason".
 */
export type PaneSwapReason = 'no_neighbor' | 'same_pane' | 'not_found' | 'cross_tab';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneMoveReason".
 */
export type PaneMoveReason = 'same_tab' | 'zoomed_tab';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneZoomReason".
 */
export type PaneZoomReason = 'single_pane' | 'already_zoomed' | 'already_unzoomed';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "LayoutNode".
 */
export type LayoutNode =
  | {
      command?: string[] | null;
      cwd?: string | null;
      env?: {
        [k: string]: string;
      };
      label?: string | null;
      pane_id?: string | null;
      type: 'pane';
    }
  | {
      direction: SplitDirection;
      first: LayoutNode;
      ratio: number;
      second: LayoutNode;
      type: 'split';
    };
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneDirection".
 */
export type PaneDirection = 'left' | 'right' | 'up' | 'down';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneFocusDirectionReason".
 */
export type PaneFocusDirectionReason = 'no_neighbor';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneResizeReason".
 */
export type PaneResizeReason = 'unchanged';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "ReadFormat".
 */
export type ReadFormat = 'text' | 'ansi';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "ReadSource".
 */
export type ReadSource = 'visible' | 'recent' | 'recent_unwrapped' | 'detection';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "EventData".
 */
export type EventData =
  | {
      type: 'workspace_created';
      workspace: WorkspaceInfo;
    }
  | {
      type: 'workspace_updated';
      workspace: WorkspaceInfo;
    }
  | {
      type: 'workspace_metadata_updated';
      workspace: WorkspaceInfo;
    }
  | {
      type: 'workspace_closed';
      workspace?: WorkspaceInfo | null;
      workspace_id: string;
    }
  | {
      label: string;
      type: 'workspace_renamed';
      workspace_id: string;
    }
  | {
      insert_index: number;
      type: 'workspace_moved';
      workspace_id: string;
      workspaces: WorkspaceInfo[];
    }
  | {
      before_workspace_id?: string | null;
      type: 'workspace_reordered';
      workspace_ids: string[];
      workspaces: WorkspaceInfo[];
    }
  | {
      type: 'workspace_focused';
      workspace_id: string;
    }
  | {
      type: 'worktree_created';
      workspace: WorkspaceInfo;
      worktree: WorktreeInfo;
    }
  | {
      already_open: boolean;
      type: 'worktree_opened';
      workspace: WorkspaceInfo;
      worktree: WorktreeInfo;
    }
  | {
      forced: boolean;
      type: 'worktree_removed';
      workspace?: WorkspaceInfo | null;
      workspace_id: string;
      worktree: WorktreeInfo;
    }
  | {
      tab: TabInfo;
      type: 'tab_created';
    }
  | {
      tab_id: string;
      type: 'tab_closed';
      workspace_id: string;
    }
  | {
      label: string;
      tab_id: string;
      type: 'tab_renamed';
      workspace_id: string;
    }
  | {
      insert_index: number;
      tab_id: string;
      tabs: TabInfo[];
      type: 'tab_moved';
      workspace_id: string;
    }
  | {
      tab_id: string;
      type: 'tab_focused';
      workspace_id: string;
    }
  | {
      pane: PaneInfo;
      type: 'pane_created';
    }
  | {
      pane_id: string;
      type: 'pane_closed';
      workspace_id: string;
    }
  | {
      pane: PaneInfo;
      type: 'pane_updated';
    }
  | {
      pane_id: string;
      type: 'pane_focused';
      workspace_id: string;
    }
  | {
      closed_tab_id?: string | null;
      closed_workspace_id?: string | null;
      created_tab?: TabInfo | null;
      created_workspace?: WorkspaceInfo | null;
      pane: PaneInfo;
      previous_pane_id: string;
      previous_tab_id: string;
      previous_workspace_id: string;
      type: 'pane_moved';
    }
  | {
      pane_id: string;
      revision: number;
      type: 'pane_output_changed';
      workspace_id: string;
    }
  | {
      pane_id: string;
      type: 'pane_exited';
      workspace_id: string;
    }
  | {
      agent?: string | null;
      final_status?: AgentStatus | null;
      pane_id: string;
      released?: boolean;
      type: 'pane_agent_detected';
      workspace_id: string;
    }
  | {
      agent?: string | null;
      agent_status: AgentStatus;
      display_agent?: string | null;
      pane_id: string;
      state_labels?: {
        [k: string]: string;
      };
      title?: string | null;
      type: 'pane_agent_status_changed';
      workspace_id: string;
    }
  | {
      layout: PaneLayoutSnapshot;
      type: 'layout_updated';
    };
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "EventKind".
 */
export type EventKind =
  | 'workspace_created'
  | 'workspace_updated'
  | 'workspace_metadata_updated'
  | 'workspace_closed'
  | 'workspace_renamed'
  | 'workspace_moved'
  | 'workspace_reordered'
  | 'workspace_focused'
  | 'worktree_created'
  | 'worktree_opened'
  | 'worktree_removed'
  | 'tab_created'
  | 'tab_closed'
  | 'tab_renamed'
  | 'tab_moved'
  | 'tab_focused'
  | 'pane_created'
  | 'pane_closed'
  | 'pane_updated'
  | 'pane_focused'
  | 'pane_moved'
  | 'pane_output_changed'
  | 'pane_exited'
  | 'pane_agent_detected'
  | 'pane_agent_status_changed'
  | 'layout_updated';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "NotificationShowReason".
 */
export type NotificationShowReason =
  'shown' | 'disabled' | 'rate_limited' | 'no_foreground_client' | 'busy';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "ClientWindowTitleReason".
 */
export type ClientWindowTitleReason = 'set' | 'cleared' | 'no_foreground_client';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "IntegrationTarget".
 */
export type IntegrationTarget =
  | 'pi'
  | 'omp'
  | 'claude'
  | 'codex'
  | 'copilot'
  | 'devin'
  | 'droid'
  | 'kimi'
  | 'opencode'
  | 'kilo'
  | 'hermes'
  | 'qodercli'
  | 'qwen'
  | 'cursor'
  | 'mastracode'
  | 'antigravity_cli'
  | 'grok';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginActionContext".
 */
export type PluginActionContext = 'global' | 'workspace' | 'tab' | 'pane' | 'selection';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginPlatform".
 */
export type PluginPlatform = 'linux' | 'macos' | 'windows';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PopupSize".
 */
export type PopupSize = number | string;
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginCommandStatus".
 */
export type PluginCommandStatus = 'running' | 'succeeded' | 'failed';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "ConfigReloadStatus".
 */
export type ConfigReloadStatus = 'applied' | 'partial' | 'failed';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginPanePlacement".
 */
export type PluginPanePlacement = 'overlay' | 'popup' | 'split' | 'tab' | 'zoomed';
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginSourceKind".
 */
export type PluginSourceKind = 'local' | 'github';

export interface SuccessResponse {
  id: string;
  result: ResponseResult;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "ServerCapabilities".
 */
export interface ServerCapabilities {
  detached_server_daemon?: boolean;
  live_handoff: boolean;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "SessionSnapshot".
 */
export interface SessionSnapshot {
  agents: AgentInfo[];
  focused_pane_id?: string | null;
  focused_tab_id?: string | null;
  focused_workspace_id?: string | null;
  layouts: PaneLayoutSnapshot[];
  panes: PaneInfo[];
  protocol: number;
  tabs: TabInfo[];
  version: string;
  workspaces: WorkspaceInfo[];
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "AgentInfo".
 */
export interface AgentInfo {
  agent?: string | null;
  agent_session?: AgentSessionInfo | null;
  agent_status: AgentStatus;
  cwd?: string | null;
  display_agent?: string | null;
  focused: boolean;
  foreground_cwd?: string | null;
  interactive_ready?: boolean;
  launch_pending?: boolean;
  name?: string | null;
  pane_id: string;
  revision: number;
  screen_detection_skipped?: boolean;
  state_change_seq?: number;
  state_labels?: {
    [k: string]: string;
  };
  tab_id: string;
  terminal_id: string;
  terminal_title?: string | null;
  terminal_title_stripped?: string | null;
  title?: string | null;
  tokens?: {
    [k: string]: string;
  };
  workspace_id: string;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "AgentSessionInfo".
 */
export interface AgentSessionInfo {
  agent: string;
  kind: AgentSessionRefKind;
  source: string;
  value: string;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneLayoutSnapshot".
 */
export interface PaneLayoutSnapshot {
  area: PaneLayoutRect;
  focused_pane_id: string;
  panes: PaneLayoutPane[];
  splits: PaneLayoutSplit[];
  tab_id: string;
  workspace_id: string;
  zoomed: boolean;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneLayoutRect".
 */
export interface PaneLayoutRect {
  height: number;
  width: number;
  x: number;
  y: number;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneLayoutPane".
 */
export interface PaneLayoutPane {
  focused: boolean;
  pane_id: string;
  rect: PaneLayoutRect;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneLayoutSplit".
 */
export interface PaneLayoutSplit {
  direction: SplitDirection;
  id: string;
  ratio: number;
  rect: PaneLayoutRect;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneInfo".
 */
export interface PaneInfo {
  agent?: string | null;
  agent_session?: AgentSessionInfo | null;
  agent_status: AgentStatus;
  cwd?: string | null;
  display_agent?: string | null;
  focused: boolean;
  foreground_cwd?: string | null;
  label?: string | null;
  pane_id: string;
  revision: number;
  scroll?: PaneScrollInfo | null;
  state_labels?: {
    [k: string]: string;
  };
  tab_id: string;
  terminal_id: string;
  terminal_title?: string | null;
  terminal_title_stripped?: string | null;
  title?: string | null;
  tokens?: {
    [k: string]: string;
  };
  workspace_id: string;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneScrollInfo".
 */
export interface PaneScrollInfo {
  max_offset_from_bottom: number;
  offset_from_bottom: number;
  viewport_rows: number;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "TabInfo".
 */
export interface TabInfo {
  agent_status: AgentStatus;
  focused: boolean;
  label: string;
  number: number;
  pane_count: number;
  tab_id: string;
  workspace_id: string;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "WorkspaceInfo".
 */
export interface WorkspaceInfo {
  active_tab_id: string;
  agent_status: AgentStatus;
  focused: boolean;
  label: string;
  number: number;
  pane_count: number;
  tab_count: number;
  tokens?: {
    [k: string]: string;
  };
  workspace_id: string;
  worktree?: WorkspaceWorktreeInfo | null;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "WorkspaceWorktreeInfo".
 */
export interface WorkspaceWorktreeInfo {
  checkout_path: string;
  is_linked_worktree: boolean;
  repo_key: string;
  repo_name: string;
  repo_root: string;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "WorktreeSourceInfo".
 */
export interface WorktreeSourceInfo {
  repo_key: string;
  repo_name: string;
  repo_root: string;
  source_checkout_path: string;
  source_workspace_id?: string | null;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "WorktreeInfo".
 */
export interface WorktreeInfo {
  branch?: string | null;
  is_bare: boolean;
  is_detached: boolean;
  is_linked_worktree: boolean;
  is_prunable: boolean;
  label: string;
  open_workspace_id?: string | null;
  path: string;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneSwapResult".
 */
export interface PaneSwapResult {
  changed: boolean;
  focused_pane_id: string;
  layout: PaneLayoutSnapshot;
  reason?: PaneSwapReason | null;
  source_pane_id: string;
  target_pane_id?: string | null;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneMoveResult".
 */
export interface PaneMoveResult {
  changed: boolean;
  closed_tab_id?: string | null;
  closed_workspace_id?: string | null;
  created_tab?: TabInfo | null;
  created_workspace?: WorkspaceInfo | null;
  focused_pane_id: string;
  pane: PaneInfo;
  previous_pane_id: string;
  previous_tab_id: string;
  previous_workspace_id: string;
  reason?: PaneMoveReason | null;
  source_layout?: PaneLayoutSnapshot | null;
  target_layout: PaneLayoutSnapshot;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneZoomResult".
 */
export interface PaneZoomResult {
  changed: boolean;
  focus_changed: boolean;
  focused_pane_id: string;
  layout: PaneLayoutSnapshot;
  pane_id: string;
  reason?: PaneZoomReason | null;
  zoom_changed: boolean;
  zoomed: boolean;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneProcessInfo".
 */
export interface PaneProcessInfo {
  foreground_process_group_id?: number | null;
  foreground_processes?: PaneProcessInfoProcess[];
  pane_id: string;
  shell_pid?: number | null;
  tty?: string | null;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneProcessInfoProcess".
 */
export interface PaneProcessInfoProcess {
  argv?: string[] | null;
  argv0?: string | null;
  cmdline?: string | null;
  cwd?: string | null;
  name: string;
  pid: number;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "LayoutDescription".
 */
export interface LayoutDescription {
  focused_pane_id: string;
  root: LayoutNode;
  tab_id: string;
  workspace_id: string;
  zoomed: boolean;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneNeighborResult".
 */
export interface PaneNeighborResult {
  direction: PaneDirection;
  layout: PaneLayoutSnapshot;
  neighbor_pane_id?: string | null;
  pane_id: string;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneEdgesResult".
 */
export interface PaneEdgesResult {
  down: boolean;
  layout: PaneLayoutSnapshot;
  left: boolean;
  pane_id: string;
  right: boolean;
  up: boolean;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneFocusDirectionResult".
 */
export interface PaneFocusDirectionResult {
  changed: boolean;
  focused_pane_id?: string | null;
  layout: PaneLayoutSnapshot;
  reason?: PaneFocusDirectionReason | null;
  source_pane_id: string;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PaneResizeResult".
 */
export interface PaneResizeResult {
  changed: boolean;
  focused_pane_id: string;
  layout: PaneLayoutSnapshot;
  pane_id: string;
  reason?: PaneResizeReason | null;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
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
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "EventEnvelope".
 */
export interface EventEnvelope {
  data: EventData;
  event: EventKind;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "IntegrationInstallResult".
 */
export interface IntegrationInstallResult {
  messages: string[];
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "IntegrationUninstallResult".
 */
export interface IntegrationUninstallResult {
  messages: string[];
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "AgentManifestInfo".
 */
export interface AgentManifestInfo {
  active_version?: string | null;
  agent: string;
  cached_remote_version?: string | null;
  local_override_shadowing_remote: boolean;
  remote_last_checked_unix?: number | null;
  remote_update_error?: string | null;
  remote_update_result?: string | null;
  source: string;
  source_kind: string;
  warning?: string | null;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "InstalledPluginInfo".
 */
export interface InstalledPluginInfo {
  actions?: PluginManifestAction[];
  build?: PluginManifestBuild[];
  description?: string | null;
  enabled: boolean;
  events?: PluginManifestEventHook[];
  link_handlers?: PluginManifestLinkHandler[];
  manifest_path: string;
  min_herdr_version?: string;
  name: string;
  panes?: PluginManifestPane[];
  platforms?: PluginPlatform[] | null;
  plugin_id: string;
  plugin_root: string;
  source?: PluginSourceInfo;
  startup?: PluginManifestStartup[];
  version: string;
  /**
   * Warnings collected at link time or on registry load (e.g. unknown event names,
   * missing manifest file). Non-fatal — the entry is kept and surfaced by plugin.list.
   */
  warnings?: string[];
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginManifestAction".
 */
export interface PluginManifestAction {
  command: string[];
  contexts?: PluginActionContext[];
  description?: string | null;
  id: string;
  platforms?: PluginPlatform[] | null;
  title: string;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginManifestBuild".
 */
export interface PluginManifestBuild {
  command: string[];
  platforms?: PluginPlatform[] | null;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginManifestEventHook".
 */
export interface PluginManifestEventHook {
  command: string[];
  on: string;
  platforms?: PluginPlatform[] | null;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginManifestLinkHandler".
 */
export interface PluginManifestLinkHandler {
  action: string;
  id: string;
  pattern: string;
  platforms?: PluginPlatform[] | null;
  title: string;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginManifestPane".
 */
export interface PluginManifestPane {
  command: string[];
  description?: string | null;
  height?: PopupSize | null;
  id: string;
  placement?: 'overlay' | 'popup' | 'split' | 'tab' | 'zoomed';
  platforms?: PluginPlatform[] | null;
  title: string;
  width?: PopupSize | null;
}
export interface PluginSourceInfo {
  installed_unix_ms?: number | null;
  kind?: 'local' | 'github';
  managed_path?: string | null;
  owner?: string | null;
  repo?: string | null;
  requested_ref?: string | null;
  resolved_commit?: string | null;
  subdir?: string | null;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginManifestStartup".
 */
export interface PluginManifestStartup {
  command: string[];
  platforms?: PluginPlatform[] | null;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginActionInfo".
 */
export interface PluginActionInfo {
  action_id: string;
  command: string[];
  contexts?: PluginActionContext[];
  description?: string | null;
  platforms?: PluginPlatform[] | null;
  plugin_id: string;
  title: string;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginInvocationContext".
 */
export interface PluginInvocationContext {
  clicked_url?: string | null;
  correlation_id?: string | null;
  focused_pane_agent?: string | null;
  focused_pane_cwd?: string | null;
  focused_pane_id?: string | null;
  focused_pane_status?: AgentStatus | null;
  invocation_source?: string | null;
  link_handler_id?: string | null;
  selected_text?: string | null;
  tab_id?: string | null;
  tab_label?: string | null;
  workspace_cwd?: string | null;
  workspace_id?: string | null;
  workspace_label?: string | null;
  worktree?: WorkspaceWorktreeInfo | null;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginCommandLogInfo".
 */
export interface PluginCommandLogInfo {
  action_id?: string | null;
  command: string[];
  error?: string | null;
  event?: string | null;
  exit_code?: number | null;
  finished_unix_ms?: number | null;
  log_id: string;
  plugin_id: string;
  started_unix_ms: number;
  status: PluginCommandStatus;
  stderr?: string | null;
  stdout?: string | null;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginPaneInfo".
 */
export interface PluginPaneInfo {
  entrypoint: string;
  pane: PaneInfo;
  plugin_id: string;
}
/**
 * This interface was referenced by `SuccessResponse`'s JSON-Schema
 * via the `definition` "PluginSourceInfo".
 */
export interface PluginSourceInfo1 {
  installed_unix_ms?: number | null;
  kind?: 'local' | 'github';
  managed_path?: string | null;
  owner?: string | null;
  repo?: string | null;
  requested_ref?: string | null;
  resolved_commit?: string | null;
  subdir?: string | null;
}

// ── error_response ────────────────────────────────────────────────

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

// ── event ─────────────────────────────────────────────────────────

/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "EventData".
 */
export type EventData =
  | {
      type: 'workspace_created';
      workspace: WorkspaceInfo;
    }
  | {
      type: 'workspace_updated';
      workspace: WorkspaceInfo;
    }
  | {
      type: 'workspace_metadata_updated';
      workspace: WorkspaceInfo;
    }
  | {
      type: 'workspace_closed';
      workspace?: WorkspaceInfo | null;
      workspace_id: string;
    }
  | {
      label: string;
      type: 'workspace_renamed';
      workspace_id: string;
    }
  | {
      insert_index: number;
      type: 'workspace_moved';
      workspace_id: string;
      workspaces: WorkspaceInfo[];
    }
  | {
      before_workspace_id?: string | null;
      type: 'workspace_reordered';
      workspace_ids: string[];
      workspaces: WorkspaceInfo[];
    }
  | {
      type: 'workspace_focused';
      workspace_id: string;
    }
  | {
      type: 'worktree_created';
      workspace: WorkspaceInfo;
      worktree: WorktreeInfo;
    }
  | {
      already_open: boolean;
      type: 'worktree_opened';
      workspace: WorkspaceInfo;
      worktree: WorktreeInfo;
    }
  | {
      forced: boolean;
      type: 'worktree_removed';
      workspace?: WorkspaceInfo | null;
      workspace_id: string;
      worktree: WorktreeInfo;
    }
  | {
      tab: TabInfo;
      type: 'tab_created';
    }
  | {
      tab_id: string;
      type: 'tab_closed';
      workspace_id: string;
    }
  | {
      label: string;
      tab_id: string;
      type: 'tab_renamed';
      workspace_id: string;
    }
  | {
      insert_index: number;
      tab_id: string;
      tabs: TabInfo[];
      type: 'tab_moved';
      workspace_id: string;
    }
  | {
      tab_id: string;
      type: 'tab_focused';
      workspace_id: string;
    }
  | {
      pane: PaneInfo;
      type: 'pane_created';
    }
  | {
      pane_id: string;
      type: 'pane_closed';
      workspace_id: string;
    }
  | {
      pane: PaneInfo;
      type: 'pane_updated';
    }
  | {
      pane_id: string;
      type: 'pane_focused';
      workspace_id: string;
    }
  | {
      closed_tab_id?: string | null;
      closed_workspace_id?: string | null;
      created_tab?: TabInfo | null;
      created_workspace?: WorkspaceInfo | null;
      pane: PaneInfo;
      previous_pane_id: string;
      previous_tab_id: string;
      previous_workspace_id: string;
      type: 'pane_moved';
    }
  | {
      pane_id: string;
      revision: number;
      type: 'pane_output_changed';
      workspace_id: string;
    }
  | {
      pane_id: string;
      type: 'pane_exited';
      workspace_id: string;
    }
  | {
      agent?: string | null;
      final_status?: AgentStatus | null;
      pane_id: string;
      released?: boolean;
      type: 'pane_agent_detected';
      workspace_id: string;
    }
  | {
      agent?: string | null;
      agent_status: AgentStatus;
      display_agent?: string | null;
      pane_id: string;
      state_labels?: {
        [k: string]: string;
      };
      title?: string | null;
      type: 'pane_agent_status_changed';
      workspace_id: string;
    }
  | {
      layout: PaneLayoutSnapshot;
      type: 'layout_updated';
    };
/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "AgentStatus".
 */
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';
/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "AgentSessionRefKind".
 */
export type AgentSessionRefKind = 'id' | 'path';
/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "SplitDirection".
 */
export type SplitDirection = 'right' | 'down';
/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "EventKind".
 */
export type EventKind =
  | 'workspace_created'
  | 'workspace_updated'
  | 'workspace_metadata_updated'
  | 'workspace_closed'
  | 'workspace_renamed'
  | 'workspace_moved'
  | 'workspace_reordered'
  | 'workspace_focused'
  | 'worktree_created'
  | 'worktree_opened'
  | 'worktree_removed'
  | 'tab_created'
  | 'tab_closed'
  | 'tab_renamed'
  | 'tab_moved'
  | 'tab_focused'
  | 'pane_created'
  | 'pane_closed'
  | 'pane_updated'
  | 'pane_focused'
  | 'pane_moved'
  | 'pane_output_changed'
  | 'pane_exited'
  | 'pane_agent_detected'
  | 'pane_agent_status_changed'
  | 'layout_updated';

export interface Event {
  data: EventData;
  event: EventKind;
}
/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "WorkspaceInfo".
 */
export interface WorkspaceInfo {
  active_tab_id: string;
  agent_status: AgentStatus;
  focused: boolean;
  label: string;
  number: number;
  pane_count: number;
  tab_count: number;
  tokens?: {
    [k: string]: string;
  };
  workspace_id: string;
  worktree?: WorkspaceWorktreeInfo | null;
}
/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "WorkspaceWorktreeInfo".
 */
export interface WorkspaceWorktreeInfo {
  checkout_path: string;
  is_linked_worktree: boolean;
  repo_key: string;
  repo_name: string;
  repo_root: string;
}
/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "WorktreeInfo".
 */
export interface WorktreeInfo {
  branch?: string | null;
  is_bare: boolean;
  is_detached: boolean;
  is_linked_worktree: boolean;
  is_prunable: boolean;
  label: string;
  open_workspace_id?: string | null;
  path: string;
}
/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "TabInfo".
 */
export interface TabInfo {
  agent_status: AgentStatus;
  focused: boolean;
  label: string;
  number: number;
  pane_count: number;
  tab_id: string;
  workspace_id: string;
}
/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "PaneInfo".
 */
export interface PaneInfo {
  agent?: string | null;
  agent_session?: AgentSessionInfo | null;
  agent_status: AgentStatus;
  cwd?: string | null;
  display_agent?: string | null;
  focused: boolean;
  foreground_cwd?: string | null;
  label?: string | null;
  pane_id: string;
  revision: number;
  scroll?: PaneScrollInfo | null;
  state_labels?: {
    [k: string]: string;
  };
  tab_id: string;
  terminal_id: string;
  terminal_title?: string | null;
  terminal_title_stripped?: string | null;
  title?: string | null;
  tokens?: {
    [k: string]: string;
  };
  workspace_id: string;
}
/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "AgentSessionInfo".
 */
export interface AgentSessionInfo {
  agent: string;
  kind: AgentSessionRefKind;
  source: string;
  value: string;
}
/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "PaneScrollInfo".
 */
export interface PaneScrollInfo {
  max_offset_from_bottom: number;
  offset_from_bottom: number;
  viewport_rows: number;
}
/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "PaneLayoutSnapshot".
 */
export interface PaneLayoutSnapshot {
  area: PaneLayoutRect;
  focused_pane_id: string;
  panes: PaneLayoutPane[];
  splits: PaneLayoutSplit[];
  tab_id: string;
  workspace_id: string;
  zoomed: boolean;
}
/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "PaneLayoutRect".
 */
export interface PaneLayoutRect {
  height: number;
  width: number;
  x: number;
  y: number;
}
/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "PaneLayoutPane".
 */
export interface PaneLayoutPane {
  focused: boolean;
  pane_id: string;
  rect: PaneLayoutRect;
}
/**
 * This interface was referenced by `Event`'s JSON-Schema
 * via the `definition` "PaneLayoutSplit".
 */
export interface PaneLayoutSplit {
  direction: SplitDirection;
  id: string;
  ratio: number;
  rect: PaneLayoutRect;
}

// ── subscription_event ────────────────────────────────────────────

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
