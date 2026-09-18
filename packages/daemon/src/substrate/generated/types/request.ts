/**
 * GENERATED — DO NOT EDIT.
 *
 * Source: vendor/runtime/0.8.2-p20/api-schema.json
 * Regenerate: pnpm substrate:codegen
 *
 * OSADE.md §4.1 — the pinned schema is the only codegen source. Never hand-write a substrate
 * method name, and never derive one from backend/.
 */

/* eslint-disable */

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
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';
export type ReadSource = 'visible' | 'recent' | 'recent_unwrapped' | 'detection';
export type AgentViewBuiltinField =
  'status' | 'workspace_id' | 'tab_id' | 'pane_id' | 'agent' | 'seen' | 'state_change_seq';
export type AgentViewBuiltinSortField =
  | 'workspace_order'
  | 'tab_order'
  | 'pane_order'
  | 'attention'
  | 'status'
  | 'agent'
  | 'seen'
  | 'state_change_seq';
export type AgentViewContext = 'current_workspace_id' | 'current_tab_id';
export type AgentViewField =
  | AgentViewBuiltinField
  | {
      token: string;
    };
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
export type AgentViewValue =
  | string
  | boolean
  | number
  | {
      context: AgentViewContext;
    };
export type AgentViewSortField =
  | AgentViewBuiltinSortField
  | {
      token: string;
    };
export type AgentViewSortOrder = 'asc' | 'desc';
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
export type OutputMatch =
  | {
      type: 'substring';
      value: string;
    }
  | {
      type: 'regex';
      value: string;
    };
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
export type SplitDirection = 'right' | 'down';
export type ToastSubstratePosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type NotificationShowSound = 'none' | 'done' | 'request';
export type PaneAgentState = 'idle' | 'working' | 'blocked' | 'unknown';
export type PaneDirection = 'left' | 'right' | 'up' | 'down';
export type PaneGraphicsFormat = 'png' | 'rgb' | 'rgba' | 'bgra';
export type PaneRightClickTarget = 'osade' | 'pane';
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
export type PaneZoomMode = 'toggle' | 'on' | 'off';
export type PopupSize = number | string;
export type PluginPanePlacement = 'overlay' | 'popup' | 'split' | 'tab' | 'zoomed';
export type PluginSourceKind = 'local' | 'github';
export type ReadFormat = 'text' | 'ansi';

export interface AgentPromptParams {
  target: string;
  text: string;
  wait?: AgentPromptWaitOptions | null;
}
export interface AgentPromptWaitOptions {
  timeout_ms?: number | null;
  until?: AgentStatus[];
}
export interface AgentReadParams {
  format?: 'text' | 'ansi';
  lines?: number | null;
  source: ReadSource;
  strip_ansi?: boolean;
  target: string;
}
export interface AgentRenameParams {
  name?: string | null;
  target: string;
}
export interface AgentSendKeysParams {
  keys: string[];
  target: string;
}
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
export interface AgentTarget {
  target: string;
}
export interface AgentViewClearParams {
  source?: string | null;
}
export interface AgentViewSetParams {
  filter?: AgentViewFilter | null;
  label?: string | null;
  sort?: AgentViewSort[];
  source: string;
}
export interface AgentViewSort {
  field: AgentViewSortField;
  order?: 'asc' | 'desc';
}
export interface AgentWaitParams {
  target: string;
  timeout_ms?: number | null;
  until?: AgentStatus[];
}
export interface ClientWindowTitleSetParams {
  title: string;
}
export interface EmptyParams {}
export interface EventsSubscribeParams {
  subscriptions: Subscription[];
}
export interface EventsWaitParams {
  match_event: EventMatch;
  timeout_ms?: number | null;
}
export interface IntegrationInstallParams {
  target: IntegrationTarget;
}
export interface IntegrationUninstallParams {
  target: IntegrationTarget;
}
export interface LayoutApplyParams {
  focus?: boolean;
  root: LayoutNode;
  tab_id?: string | null;
  tab_label?: string | null;
  workspace_id?: string | null;
}
export interface LayoutExportParams {
  pane_id?: string | null;
  tab_id?: string | null;
}
export interface LayoutSetSplitRatioParams {
  pane_id?: string | null;
  path: boolean[];
  ratio: number;
  tab_id?: string | null;
}
export interface NotificationShowParams {
  body?: string | null;
  position?: ToastSubstratePosition | null;
  sound?: NotificationShowSound;
  title: string;
}
export interface PaneClearAgentAuthorityParams {
  pane_id: string;
  seq?: number | null;
  source?: string | null;
}
export interface PaneCurrentParams {
  caller_pane_id?: string | null;
}
export interface PaneEdgesParams {
  pane_id?: string | null;
}
export interface PaneFocusDirectionParams {
  direction: PaneDirection;
  pane_id?: string | null;
}
export interface PaneGraphicsClearParams {
  layer_id?: string | null;
  pane_id: string;
}
export interface PaneGraphicsPlacementParams {
  grid_cols?: number;
  grid_rows?: number;
  viewport_col?: number;
  viewport_row?: number;
}
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
export interface PaneInputSetParams {
  pane_id: string;
  right_click: PaneRightClickTarget;
}
export interface PaneLayoutParams {
  pane_id?: string | null;
}
export interface PaneListParams {
  workspace_id?: string | null;
}
export interface PaneMoveParams {
  destination: PaneMoveDestination;
  focus?: boolean;
  pane_id: string;
}
export interface PaneNeighborParams {
  direction: PaneDirection;
  pane_id?: string | null;
}
export interface PaneProcessInfoParams {
  pane_id?: string | null;
}
export interface PaneReadParams {
  format?: 'text' | 'ansi';
  lines?: number | null;
  pane_id: string;
  source: ReadSource;
  strip_ansi?: boolean;
}
export interface PaneReleaseAgentParams {
  agent: string;
  pane_id: string;
  seq?: number | null;
  source: string;
}
export interface PaneRenameParams {
  label?: string | null;
  pane_id: string;
}
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
export interface PaneReportAgentSessionParams {
  agent: string;
  agent_session_id?: string | null;
  agent_session_path?: string | null;
  pane_id: string;
  seq?: number | null;
  session_start_source?: string | null;
  source: string;
}
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
export interface PaneResizeParams {
  amount?: number | null;
  direction: PaneDirection;
  pane_id?: string | null;
}
export interface PaneSendInputParams {
  keys?: string[];
  pane_id: string;
  text?: string;
}
export interface PaneSendKeysParams {
  keys: string[];
  pane_id: string;
}
export interface PaneSendTextParams {
  pane_id: string;
  text: string;
}
export interface PaneSplitParams {
  cwd?: string | null;
  direction: SplitDirection;
  env?: {
    [k: string]: string;
  };
  focus?: boolean;
  ratio?: number | null;
  right_click?: 'osade' | 'pane';
  target_pane_id?: string | null;
  workspace_id?: string | null;
}
export interface PaneSwapParams {
  direction?: PaneDirection | null;
  pane_id?: string | null;
  source_pane_id?: string | null;
  target_pane_id?: string | null;
}
export interface PaneTarget {
  pane_id: string;
}
export interface PaneWaitForOutputParams {
  lines?: number | null;
  match: OutputMatch;
  pane_id: string;
  source: ReadSource;
  strip_ansi?: boolean;
  timeout_ms?: number | null;
}
export interface PaneZoomParams {
  mode?: 'toggle' | 'on' | 'off';
  pane_id?: string | null;
}
export interface PingParams {}
export interface PluginActionInvokeParams {
  action_id: string;
  context?: PluginInvocationContext | null;
  plugin_id?: string | null;
}
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
export interface WorkspaceWorktreeInfo {
  checkout_path: string;
  is_linked_worktree: boolean;
  repo_key: string;
  repo_name: string;
  repo_root: string;
}
export interface PluginActionListParams {
  plugin_id?: string | null;
}
export interface PluginLinkParams {
  enabled?: boolean;
  path: string;
  source?: PluginSourceInfo | null;
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
export interface PluginListParams {
  plugin_id?: string | null;
}
export interface PluginLogListParams {
  limit?: number | null;
  plugin_id?: string | null;
}
export interface PluginPaneCloseParams {
  pane_id: string;
}
export interface PluginPaneFocusParams {
  pane_id: string;
}
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
export interface PluginSetEnabledParams {
  plugin_id: string;
}
export interface PluginUnlinkParams {
  plugin_id: string;
}
export interface ServerLiveHandoffParams {
  expected_protocol?: number | null;
  expected_version?: string | null;
  import_exe?: string | null;
}
export interface TabCreateParams {
  cwd?: string | null;
  env?: {
    [k: string]: string;
  };
  focus?: boolean;
  label?: string | null;
  workspace_id?: string | null;
}
export interface TabListParams {
  workspace_id?: string | null;
}
export interface TabMoveParams {
  insert_index: number;
  tab_id: string;
}
export interface TabRenameParams {
  label: string;
  tab_id: string;
}
export interface TabTarget {
  tab_id: string;
}
export interface WorkspaceCreateParams {
  cwd?: string | null;
  env?: {
    [k: string]: string;
  };
  focus?: boolean;
  label?: string | null;
}
export interface WorkspaceMoveBlockParams {
  before_workspace_id?: string | null;
  workspace_ids: string[];
}
export interface WorkspaceMoveParams {
  insert_index: number;
  workspace_id: string;
}
export interface WorkspaceRenameParams {
  label: string;
  workspace_id: string;
}
export interface WorkspaceReportMetadataParams {
  seq?: number | null;
  source: string;
  tokens: {
    [k: string]: string | null;
  };
  ttl_ms?: number | null;
  workspace_id: string;
}
export interface WorkspaceTarget {
  workspace_id: string;
}
export interface WorktreeCreateParams {
  base?: string | null;
  branch?: string | null;
  cwd?: string | null;
  focus?: boolean;
  label?: string | null;
  path?: string | null;
  workspace_id?: string | null;
}
export interface WorktreeListParams {
  cwd?: string | null;
  workspace_id?: string | null;
}
export interface WorktreeOpenParams {
  branch?: string | null;
  cwd?: string | null;
  focus?: boolean;
  label?: string | null;
  path?: string | null;
  workspace_id?: string | null;
}
export interface WorktreeRemoveParams {
  force?: boolean;
  workspace_id: string;
}
