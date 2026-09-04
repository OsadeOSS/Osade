/**
 * GENERATED — DO NOT EDIT.
 *
 * Source: vendor/herdr/0.8.2-p20/api-schema.json
 * Regenerate: pnpm herdr:codegen
 *
 * OSADE.md §4.1 — the pinned schema is the only codegen source. Never hand-write a herdr
 * method name, and never derive one from backend/.
 */
import type * as T from './types/request.js';

/** Every method name in the pinned schema. Derived, never typed by hand. */
export type HerdrMethod =
  | 'agent.explain'
  | 'agent.focus'
  | 'agent.get'
  | 'agent.list'
  | 'agent.prompt'
  | 'agent.read'
  | 'agent.rename'
  | 'agent.send_keys'
  | 'agent.start'
  | 'agent.view.clear'
  | 'agent.view.set'
  | 'agent.wait'
  | 'client.window_title.clear'
  | 'client.window_title.set'
  | 'events.subscribe'
  | 'events.wait'
  | 'integration.install'
  | 'integration.uninstall'
  | 'layout.apply'
  | 'layout.export'
  | 'layout.set_split_ratio'
  | 'notification.show'
  | 'pane.clear_agent_authority'
  | 'pane.close'
  | 'pane.current'
  | 'pane.edges'
  | 'pane.focus'
  | 'pane.focus_direction'
  | 'pane.get'
  | 'pane.graphics.clear'
  | 'pane.graphics.info'
  | 'pane.graphics.set'
  | 'pane.input.set'
  | 'pane.layout'
  | 'pane.list'
  | 'pane.move'
  | 'pane.neighbor'
  | 'pane.process_info'
  | 'pane.read'
  | 'pane.release_agent'
  | 'pane.rename'
  | 'pane.report_agent'
  | 'pane.report_agent_session'
  | 'pane.report_metadata'
  | 'pane.resize'
  | 'pane.send_input'
  | 'pane.send_keys'
  | 'pane.send_text'
  | 'pane.split'
  | 'pane.swap'
  | 'pane.wait_for_output'
  | 'pane.zoom'
  | 'ping'
  | 'plugin.action.invoke'
  | 'plugin.action.list'
  | 'plugin.disable'
  | 'plugin.enable'
  | 'plugin.link'
  | 'plugin.list'
  | 'plugin.log.list'
  | 'plugin.pane.close'
  | 'plugin.pane.focus'
  | 'plugin.pane.open'
  | 'plugin.unlink'
  | 'popup.close'
  | 'server.agent_manifests'
  | 'server.live_handoff'
  | 'server.reload_agent_manifests'
  | 'server.reload_config'
  | 'server.stop'
  | 'session.snapshot'
  | 'tab.close'
  | 'tab.create'
  | 'tab.focus'
  | 'tab.get'
  | 'tab.list'
  | 'tab.move'
  | 'tab.rename'
  | 'workspace.close'
  | 'workspace.create'
  | 'workspace.focus'
  | 'workspace.get'
  | 'workspace.list'
  | 'workspace.move'
  | 'workspace.move_block'
  | 'workspace.rename'
  | 'workspace.report_metadata'
  | 'worktree.create'
  | 'worktree.list'
  | 'worktree.open'
  | 'worktree.remove';

/** Method name → params type, from the request schema's oneOf. */
export interface HerdrMethodParams {
  'agent.explain': T.AgentTarget;
  'agent.focus': T.AgentTarget;
  'agent.get': T.AgentTarget;
  'agent.list': T.EmptyParams;
  'agent.prompt': T.AgentPromptParams;
  'agent.read': T.AgentReadParams;
  'agent.rename': T.AgentRenameParams;
  'agent.send_keys': T.AgentSendKeysParams;
  'agent.start': T.AgentStartParams;
  'agent.view.clear': T.AgentViewClearParams;
  'agent.view.set': T.AgentViewSetParams;
  'agent.wait': T.AgentWaitParams;
  'client.window_title.clear': T.EmptyParams;
  'client.window_title.set': T.ClientWindowTitleSetParams;
  'events.subscribe': T.EventsSubscribeParams;
  'events.wait': T.EventsWaitParams;
  'integration.install': T.IntegrationInstallParams;
  'integration.uninstall': T.IntegrationUninstallParams;
  'layout.apply': T.LayoutApplyParams;
  'layout.export': T.LayoutExportParams;
  'layout.set_split_ratio': T.LayoutSetSplitRatioParams;
  'notification.show': T.NotificationShowParams;
  'pane.clear_agent_authority': T.PaneClearAgentAuthorityParams;
  'pane.close': T.PaneTarget;
  'pane.current': T.PaneCurrentParams;
  'pane.edges': T.PaneEdgesParams;
  'pane.focus': T.PaneTarget;
  'pane.focus_direction': T.PaneFocusDirectionParams;
  'pane.get': T.PaneTarget;
  'pane.graphics.clear': T.PaneGraphicsClearParams;
  'pane.graphics.info': T.PaneTarget;
  'pane.graphics.set': T.PaneGraphicsSetParams;
  'pane.input.set': T.PaneInputSetParams;
  'pane.layout': T.PaneLayoutParams;
  'pane.list': T.PaneListParams;
  'pane.move': T.PaneMoveParams;
  'pane.neighbor': T.PaneNeighborParams;
  'pane.process_info': T.PaneProcessInfoParams;
  'pane.read': T.PaneReadParams;
  'pane.release_agent': T.PaneReleaseAgentParams;
  'pane.rename': T.PaneRenameParams;
  'pane.report_agent': T.PaneReportAgentParams;
  'pane.report_agent_session': T.PaneReportAgentSessionParams;
  'pane.report_metadata': T.PaneReportMetadataParams;
  'pane.resize': T.PaneResizeParams;
  'pane.send_input': T.PaneSendInputParams;
  'pane.send_keys': T.PaneSendKeysParams;
  'pane.send_text': T.PaneSendTextParams;
  'pane.split': T.PaneSplitParams;
  'pane.swap': T.PaneSwapParams;
  'pane.wait_for_output': T.PaneWaitForOutputParams;
  'pane.zoom': T.PaneZoomParams;
  'ping': T.PingParams;
  'plugin.action.invoke': T.PluginActionInvokeParams;
  'plugin.action.list': T.PluginActionListParams;
  'plugin.disable': T.PluginSetEnabledParams;
  'plugin.enable': T.PluginSetEnabledParams;
  'plugin.link': T.PluginLinkParams;
  'plugin.list': T.PluginListParams;
  'plugin.log.list': T.PluginLogListParams;
  'plugin.pane.close': T.PluginPaneCloseParams;
  'plugin.pane.focus': T.PluginPaneFocusParams;
  'plugin.pane.open': T.PluginPaneOpenParams;
  'plugin.unlink': T.PluginUnlinkParams;
  'popup.close': T.EmptyParams;
  'server.agent_manifests': T.EmptyParams;
  'server.live_handoff': T.ServerLiveHandoffParams;
  'server.reload_agent_manifests': T.EmptyParams;
  'server.reload_config': T.EmptyParams;
  'server.stop': T.EmptyParams;
  'session.snapshot': T.EmptyParams;
  'tab.close': T.TabTarget;
  'tab.create': T.TabCreateParams;
  'tab.focus': T.TabTarget;
  'tab.get': T.TabTarget;
  'tab.list': T.TabListParams;
  'tab.move': T.TabMoveParams;
  'tab.rename': T.TabRenameParams;
  'workspace.close': T.WorkspaceTarget;
  'workspace.create': T.WorkspaceCreateParams;
  'workspace.focus': T.WorkspaceTarget;
  'workspace.get': T.WorkspaceTarget;
  'workspace.list': T.EmptyParams;
  'workspace.move': T.WorkspaceMoveParams;
  'workspace.move_block': T.WorkspaceMoveBlockParams;
  'workspace.rename': T.WorkspaceRenameParams;
  'workspace.report_metadata': T.WorkspaceReportMetadataParams;
  'worktree.create': T.WorktreeCreateParams;
  'worktree.list': T.WorktreeListParams;
  'worktree.open': T.WorktreeOpenParams;
  'worktree.remove': T.WorktreeRemoveParams;
}

/** Runtime list, for the drift check and for tests. */
export const HERDR_METHODS: readonly HerdrMethod[] = Object.freeze([
  'agent.explain',
  'agent.focus',
  'agent.get',
  'agent.list',
  'agent.prompt',
  'agent.read',
  'agent.rename',
  'agent.send_keys',
  'agent.start',
  'agent.view.clear',
  'agent.view.set',
  'agent.wait',
  'client.window_title.clear',
  'client.window_title.set',
  'events.subscribe',
  'events.wait',
  'integration.install',
  'integration.uninstall',
  'layout.apply',
  'layout.export',
  'layout.set_split_ratio',
  'notification.show',
  'pane.clear_agent_authority',
  'pane.close',
  'pane.current',
  'pane.edges',
  'pane.focus',
  'pane.focus_direction',
  'pane.get',
  'pane.graphics.clear',
  'pane.graphics.info',
  'pane.graphics.set',
  'pane.input.set',
  'pane.layout',
  'pane.list',
  'pane.move',
  'pane.neighbor',
  'pane.process_info',
  'pane.read',
  'pane.release_agent',
  'pane.rename',
  'pane.report_agent',
  'pane.report_agent_session',
  'pane.report_metadata',
  'pane.resize',
  'pane.send_input',
  'pane.send_keys',
  'pane.send_text',
  'pane.split',
  'pane.swap',
  'pane.wait_for_output',
  'pane.zoom',
  'ping',
  'plugin.action.invoke',
  'plugin.action.list',
  'plugin.disable',
  'plugin.enable',
  'plugin.link',
  'plugin.list',
  'plugin.log.list',
  'plugin.pane.close',
  'plugin.pane.focus',
  'plugin.pane.open',
  'plugin.unlink',
  'popup.close',
  'server.agent_manifests',
  'server.live_handoff',
  'server.reload_agent_manifests',
  'server.reload_config',
  'server.stop',
  'session.snapshot',
  'tab.close',
  'tab.create',
  'tab.focus',
  'tab.get',
  'tab.list',
  'tab.move',
  'tab.rename',
  'workspace.close',
  'workspace.create',
  'workspace.focus',
  'workspace.get',
  'workspace.list',
  'workspace.move',
  'workspace.move_block',
  'workspace.rename',
  'workspace.report_metadata',
  'worktree.create',
  'worktree.list',
  'worktree.open',
  'worktree.remove',
]) as readonly HerdrMethod[];
