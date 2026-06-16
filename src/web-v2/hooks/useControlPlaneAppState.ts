import type {
  ControlPlaneHeartbeatTaskView,
  ControlPlaneCustomAgentCreateInput,
  ControlPlaneSessionDetail,
  ControlPlaneSessions,
} from '@web/api/client';
import { trpcReact } from '@web/api/client';
import type { WorkspaceCreateInput } from '@web/components/settings';
import { useControlPlaneErrorToasts } from './useControlPlaneErrorToasts';
import { useControlPlaneHeartbeatEvents } from './tasks/useControlPlaneHeartbeatEvents';
import { useControlPlaneSessionDetail } from './sessions/useControlPlaneSessionDetail';
import { useControlPlaneWorkspaceSessionEvents } from './sessions/useControlPlaneWorkspaceSessionEvents';
import { useControlPlaneSessionArchive } from './shell/useControlPlaneSessionArchive';
import { useControlPlaneSidebarData } from './shell/useControlPlaneSidebarData';
import { useControlPlaneTaskActions } from './tasks/useControlPlaneTaskActions';
import { useControlPlaneTaskSelection } from './tasks/useControlPlaneTaskSelection';
import { useControlPlaneNotifications } from './notifications/useControlPlaneNotifications';
import { useWorkbenchNavigation } from './useWorkbenchNavigation';

export type ControlPlaneRightPanelProps = {
  activeRouteMode: ReturnType<typeof useWorkbenchNavigation>['activeRouteMode'];
  workspaceId?: string;
  taskRun: {
    error?: string;
    liveTask?: ControlPlaneHeartbeatTaskView;
    loading: boolean;
    run: ReturnType<typeof useControlPlaneTaskSelection>['runDetail']['run'];
    selectedRunId?: string;
  };
};

export function useControlPlaneAppState() {
  const navigation = useWorkbenchNavigation();
  const utils = trpcReact.useUtils();
  const notifications = useControlPlaneNotifications();
  const createSessionMutation = trpcReact.controlPlane.sessionCreate.useMutation();
  const renameSessionMutation = trpcReact.controlPlane.sessionRename.useMutation();
  const sessionPinnedUpdateMutation = trpcReact.controlPlane.sessionPinnedUpdate.useMutation();
  const workspaceCreateMutation = trpcReact.controlPlane.workspaceCreate.useMutation();
  const workspaceRenameMutation = trpcReact.controlPlane.workspaceRename.useMutation();
  const workspaceSetActiveMutation = trpcReact.controlPlane.workspaceSetActive.useMutation();
  const skillActivateMutation = trpcReact.controlPlane.skillActivate.useMutation();
  const skillDisableMutation = trpcReact.controlPlane.skillDisable.useMutation();
  const customAgentCreateMutation = trpcReact.controlPlane.customAgentCreate.useMutation();
  const customAgentDeleteMutation = trpcReact.controlPlane.customAgentDelete.useMutation();
  const browserAutomationSetEnabledMutation = trpcReact.controlPlane.browserAutomationSetEnabled.useMutation();
  const browserAutomationSettingsUpdateMutation = trpcReact.controlPlane.browserAutomationSettingsUpdate.useMutation();
  const browserAutomationProfileOpenMutation = trpcReact.controlPlane.browserAutomationProfileOpen.useMutation();
  const browserAutomationProfileCloseMutation = trpcReact.controlPlane.browserAutomationProfileClose.useMutation();
  const browserAutomationNativeLaunchMutation = trpcReact.controlPlane.browserAutomationNativeLaunch.useMutation();
  const browserAutomationNativeStatusMutation = trpcReact.controlPlane.browserAutomationNativeStatus.useMutation();
  const mcpServerEnableMutation = trpcReact.controlPlane.mcpServerEnable.useMutation();
  const mcpServerDisableMutation = trpcReact.controlPlane.mcpServerDisable.useMutation();
  const mcpServerRefreshMutation = trpcReact.controlPlane.mcpServerRefresh.useMutation();
  const mcpConfigSaveMutation = trpcReact.controlPlane.mcpConfigSave.useMutation();
  const taskEvents = useControlPlaneHeartbeatEvents({
    enabled: Boolean(navigation.selectedWorkspaceId),
    onNotificationIntent: notifications.deliver,
    workspaceId: navigation.selectedWorkspaceId,
  });
  const sidebar = useControlPlaneSidebarData({ navigation, taskEvents });
  useControlPlaneWorkspaceSessionEvents({
    onNotificationIntent: notifications.deliver,
    workspaceId: sidebar.workspaceId,
  });
  const memoryStatusQuery = trpcReact.controlPlane.memoryStatus.useQuery(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined, {
    enabled: navigation.settingsOpen && navigation.activeSettingsSectionId === 'memory',
  });
  const skillsQuery = trpcReact.controlPlane.skills.useQuery(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined, {
    enabled: navigation.settingsOpen && navigation.activeSettingsSectionId === 'skills',
  });
  const customAgentsQuery = trpcReact.controlPlane.customAgents.useQuery(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined, {
    enabled: (navigation.settingsOpen && navigation.activeSettingsSectionId === 'agents') || navigation.activeSurfaceId === 'sessions',
  });
  const browserAutomationQuery = trpcReact.controlPlane.browserAutomation.useQuery(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined, {
    enabled: navigation.settingsOpen && navigation.activeSettingsSectionId === 'browserAutomation',
  });
  const mcpQuery = trpcReact.controlPlane.mcpServers.useQuery(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined, {
    enabled: navigation.settingsOpen && navigation.activeSettingsSectionId === 'mcp',
  });
  const mcpConfigQuery = trpcReact.controlPlane.mcpConfig.useQuery(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined, {
    enabled: navigation.settingsOpen && navigation.activeSettingsSectionId === 'mcp',
  });
  const selectedSession = useControlPlaneSessionDetail({
    onNotificationIntent: notifications.deliver,
    workspaceId: sidebar.workspaceId,
    sessionId: navigation.selectedSessionId,
  });
  const taskSelection = useControlPlaneTaskSelection({
    navigation,
    taskEvents,
    workspaceId: sidebar.workspaceId,
  });
  const taskActions = useControlPlaneTaskActions({
    navigation,
    selectedTask: taskSelection.task,
    sidebarTasks: sidebar.tasks,
    taskEvents,
    workspaceId: sidebar.workspaceId,
  });
  const state = sidebar.stateQuery.data;
  const stateMemoryStatus = state && state.activeWorkspaceId === sidebar.workspaceId ? state.memory : undefined;
  const sessionArchive = useControlPlaneSessionArchive({
    workspaceId: sidebar.workspaceId,
    selectedSessionId: navigation.selectedSessionId,
    selectSession: navigation.selectSession,
    selectSurface: navigation.selectSurface,
  });

  useControlPlaneErrorToasts({
    stateError: sidebar.stateQuery.error,
    sessionError: selectedSession.error,
  });

  async function createSession() {
    const session = await createSessionMutation.mutateAsync(
      sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined,
    );
    navigation.selectSession(session.id, { workspaceId: sidebar.workspaceId });
    await utils.controlPlane.state.invalidate();
    await utils.controlPlane.sessions.invalidate(
      sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined,
    );
  }

  async function renameSession(sessionId: string, name: string) {
    await renameSessionMutation.mutateAsync(
      sidebar.workspaceId ? { workspaceId: sidebar.workspaceId, id: sessionId, name } : { id: sessionId, name },
    );
    await Promise.all([
      utils.controlPlane.sessions.invalidate(
        sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined,
      ),
      utils.controlPlane.session.invalidate(
        sidebar.workspaceId ? { workspaceId: sidebar.workspaceId, id: sessionId } : { id: sessionId },
      ),
    ]);
  }

  async function setSessionPinned(sessionId: string, pinned: boolean) {
    const sessionsInput = sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined;
    const sessionInput = sidebar.workspaceId ? { workspaceId: sidebar.workspaceId, id: sessionId } : { id: sessionId };
    const previousSessions = utils.controlPlane.sessions.getData(sessionsInput);
    const previousSession = utils.controlPlane.session.getData(sessionInput);

    utils.controlPlane.sessions.setData(
      sessionsInput,
      (current) => applyPinnedSessionToSessions(current, sessionId, pinned),
    );
    utils.controlPlane.session.setData(
      sessionInput,
      (current) => applyPinnedSessionToDetail(current, pinned),
    );

    try {
      const updated = await sessionPinnedUpdateMutation.mutateAsync({ ...sessionInput, pinned });
      utils.controlPlane.sessions.setData(
        sessionsInput,
        (current) => applyPinnedSessionToSessions(current, sessionId, updated.pinned),
      );
      utils.controlPlane.session.setData(sessionInput, updated);
    } catch (error) {
      utils.controlPlane.sessions.setData(sessionsInput, previousSessions);
      utils.controlPlane.session.setData(sessionInput, previousSession);
      throw error;
    } finally {
      await Promise.all([
        utils.controlPlane.sessions.invalidate(sessionsInput),
        utils.controlPlane.session.invalidate(sessionInput),
      ]);
    }
  }

  async function switchWorkspace(workspaceId: string) {
    const result = await workspaceSetActiveMutation.mutateAsync({ workspaceId });
    navigation.selectWorkspace(workspaceId);
    await utils.controlPlane.state.invalidate();
    await Promise.all([
      utils.controlPlane.sessions.invalidate({ workspaceId: result.activeWorkspaceId }),
      utils.controlPlane.heartbeatTasks.invalidate({ workspaceId: result.activeWorkspaceId }),
    ]);
  }

  async function createWorkspace(input: WorkspaceCreateInput) {
    const result = await workspaceCreateMutation.mutateAsync(input);
    await utils.controlPlane.state.invalidate();
    if (input.setActive) {
      navigation.selectWorkspace(result.workspace.id);
      await Promise.all([
        utils.controlPlane.sessions.invalidate({ workspaceId: result.workspace.id }),
        utils.controlPlane.heartbeatTasks.invalidate({ workspaceId: result.workspace.id }),
      ]);
    }
  }

  async function renameWorkspace(workspaceId: string, name: string) {
    await workspaceRenameMutation.mutateAsync({ workspaceId, name });
    await utils.controlPlane.state.invalidate();
  }

  async function setSkillActive(name: string, active: boolean) {
    const input = sidebar.workspaceId ? { workspaceId: sidebar.workspaceId, name } : { name };
    if (active) {
      await skillActivateMutation.mutateAsync(input);
    } else {
      await skillDisableMutation.mutateAsync(input);
    }
    await utils.controlPlane.skills.invalidate(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined);
  }

  async function deleteProjectAgent(agentProfileId: string) {
    await customAgentDeleteMutation.mutateAsync(
      sidebar.workspaceId ? { workspaceId: sidebar.workspaceId, agentProfileId } : { agentProfileId },
    );
    await utils.controlPlane.customAgents.invalidate(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined);
  }

  async function createProjectAgent(input: Omit<ControlPlaneCustomAgentCreateInput, 'workspaceId'>) {
    await customAgentCreateMutation.mutateAsync(
      sidebar.workspaceId ? { workspaceId: sidebar.workspaceId, ...input } : input,
    );
    await utils.controlPlane.customAgents.invalidate(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined);
  }

  async function setBrowserAutomationEnabled(enabled: boolean) {
    const input = sidebar.workspaceId ? { workspaceId: sidebar.workspaceId, enabled } : { enabled };
    const result = await browserAutomationSetEnabledMutation.mutateAsync(input);
    if (!result.ok) {
      throw new Error(`Browser Automation skill not found: ${result.overview.skillName}`);
    }
    await Promise.all([
      utils.controlPlane.browserAutomation.invalidate(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined),
      utils.controlPlane.skills.invalidate(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined),
    ]);
  }

  async function updateBrowserAutomationSettings(input: {
    profileId?: string;
    backend?: 'playwright-managed' | 'native-chrome-cdp';
    channel?: 'chromium' | 'chrome' | 'msedge';
    headless?: boolean;
    cdpEndpoint?: string;
  }) {
    const result = await browserAutomationSettingsUpdateMutation.mutateAsync(
      sidebar.workspaceId ? { workspaceId: sidebar.workspaceId, ...input } : input,
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    await utils.controlPlane.browserAutomation.invalidate(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined);
  }

  async function openBrowserAutomationProfile(url?: string) {
    const result = await browserAutomationProfileOpenMutation.mutateAsync(
      sidebar.workspaceId ? { workspaceId: sidebar.workspaceId, url } : { url },
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    await utils.controlPlane.browserAutomation.invalidate(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined);
  }

  async function closeBrowserAutomationProfile() {
    const result = await browserAutomationProfileCloseMutation.mutateAsync(
      sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : {},
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    await utils.controlPlane.browserAutomation.invalidate(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined);
  }

  async function launchNativeChromeBrowser(url?: string) {
    const result = await browserAutomationNativeLaunchMutation.mutateAsync(
      sidebar.workspaceId ? { workspaceId: sidebar.workspaceId, url } : { url },
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    await utils.controlPlane.browserAutomation.invalidate(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined);
  }

  async function checkNativeChromeBrowser() {
    await browserAutomationNativeStatusMutation.mutateAsync(
      sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : {},
    );
    await utils.controlPlane.browserAutomation.invalidate(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined);
  }

  async function setMcpServerEnabled(serverId: string, enabled: boolean) {
    const input = sidebar.workspaceId ? { workspaceId: sidebar.workspaceId, serverId } : { serverId };
    if (enabled) {
      await mcpServerEnableMutation.mutateAsync(input);
    } else {
      await mcpServerDisableMutation.mutateAsync(input);
    }
    await utils.controlPlane.mcpServers.invalidate(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined);
  }

  async function refreshMcpServer(serverId: string) {
    const input = sidebar.workspaceId ? { workspaceId: sidebar.workspaceId, serverId } : { serverId };
    await mcpServerRefreshMutation.mutateAsync(input);
    await utils.controlPlane.mcpServers.invalidate(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined);
  }

  async function saveMcpConfig(content: string) {
    const input = sidebar.workspaceId ? { workspaceId: sidebar.workspaceId, content } : { content };
    const result = await mcpConfigSaveMutation.mutateAsync(input);
    if (!result.ok) {
      throw new Error(result.error);
    }
    await Promise.all([
      utils.controlPlane.mcpConfig.invalidate(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined),
      utils.controlPlane.mcpServers.invalidate(sidebar.workspaceId ? { workspaceId: sidebar.workspaceId } : undefined),
    ]);
  }

  return {
    frameProps: {
      activeSurfaceId: navigation.activeSurfaceId,
      activeSettingsSectionId: navigation.activeSettingsSectionId,
      settingsOpen: navigation.settingsOpen,
      selectedWorkspaceId: sidebar.workspaceId,
      selectedSessionId: navigation.selectedSessionId,
      selectedTaskId: navigation.selectedTaskId,
      workspaces: sidebar.stateQuery.data?.workspaces ?? [],
      sessions: sidebar.sessions,
      tasks: sidebar.tasks,
      onOpenSettings: navigation.openSettings,
      onOpenWorkspaceSettings: () => navigation.openSettings('workspaces'),
      onCloseSettings: navigation.closeSettings,
      onCreateSession: createSession,
      onCreateTask: taskActions.openCreateDialog,
      onRenameSession: renameSession,
      onSetSessionArchived: sessionArchive.setSessionArchived,
      onSetSessionPinned: setSessionPinned,
      onSelectWorkspace: (workspaceId: string) => void switchWorkspace(workspaceId),
      onSelectSession: navigation.selectSession,
      onSelectTask: navigation.selectTask,
    },
    routeProps: {
      activeSurfaceId: navigation.activeSurfaceId,
      activeSettingsSectionId: navigation.activeSettingsSectionId,
      generalSettingsView: {
        notificationPermission: notifications.permission,
        onRequestNotificationPermission: notifications.requestPermission,
      },
      agentsSettingsView: {
        agents: customAgentsQuery.data,
        loading: customAgentsQuery.isLoading || sidebar.stateQuery.isLoading,
        error: customAgentsQuery.error instanceof Error ? customAgentsQuery.error.message : undefined,
        creating: customAgentCreateMutation.isPending,
        deleting: customAgentDeleteMutation.isPending,
        onCreateProjectAgent: createProjectAgent,
        onDeleteProjectAgent: deleteProjectAgent,
      },
      memorySettingsView: {
        status: memoryStatusQuery.data ?? stateMemoryStatus,
        loading: memoryStatusQuery.isLoading || sidebar.stateQuery.isLoading,
        error: memoryStatusQuery.error instanceof Error ? memoryStatusQuery.error.message : undefined,
      },
      browserAutomationSettingsView: {
        browserAutomation: browserAutomationQuery.data,
        loading: browserAutomationQuery.isLoading || sidebar.stateQuery.isLoading,
        error: browserAutomationQuery.error instanceof Error ? browserAutomationQuery.error.message : undefined,
        updating:
          browserAutomationSetEnabledMutation.isPending
          || browserAutomationSettingsUpdateMutation.isPending
          || browserAutomationProfileOpenMutation.isPending
          || browserAutomationProfileCloseMutation.isPending
          || browserAutomationNativeLaunchMutation.isPending
          || browserAutomationNativeStatusMutation.isPending,
        onSetEnabled: setBrowserAutomationEnabled,
        onUpdateSettings: updateBrowserAutomationSettings,
        onOpenProfile: openBrowserAutomationProfile,
        onCloseProfile: closeBrowserAutomationProfile,
        onLaunchNativeChrome: launchNativeChromeBrowser,
        onCheckNativeChrome: checkNativeChromeBrowser,
      },
      skillsSettingsView: {
        skills: skillsQuery.data,
        loading: skillsQuery.isLoading || sidebar.stateQuery.isLoading,
        error: skillsQuery.error instanceof Error ? skillsQuery.error.message : undefined,
        updating: skillActivateMutation.isPending || skillDisableMutation.isPending,
        onSetSkillActive: setSkillActive,
      },
      mcpSettingsView: {
        mcp: mcpQuery.data,
        config: mcpConfigQuery.data,
        loading: mcpQuery.isLoading || mcpConfigQuery.isLoading || sidebar.stateQuery.isLoading,
        error: mcpQuery.error instanceof Error ? mcpQuery.error.message : mcpConfigQuery.error instanceof Error ? mcpConfigQuery.error.message : undefined,
        updating: mcpServerEnableMutation.isPending || mcpServerDisableMutation.isPending,
        refreshing: mcpServerRefreshMutation.isPending,
        savingConfig: mcpConfigSaveMutation.isPending,
        onSaveConfig: saveMcpConfig,
        onSetServerEnabled: setMcpServerEnabled,
        onRefreshServer: refreshMcpServer,
      },
      workspaceSettingsView: {
        state,
        selectedWorkspaceId: sidebar.workspaceId,
        loading: sidebar.stateQuery.isLoading,
        error: sidebar.stateQuery.error instanceof Error ? sidebar.stateQuery.error.message : undefined,
        updating: workspaceCreateMutation.isPending || workspaceRenameMutation.isPending || workspaceSetActiveMutation.isPending,
        onCreateWorkspace: createWorkspace,
        onRenameWorkspace: renameWorkspace,
        onSwitchWorkspace: switchWorkspace,
      },
      sessionView: {
        workspaceId: sidebar.workspaceId,
        session: selectedSession.session,
        loading: selectedSession.loading,
        submitting: selectedSession.submitting,
        running: selectedSession.running,
        cancelling: selectedSession.cancelling,
        liveStatus: selectedSession.liveStatus,
        currentActivity: selectedSession.currentActivity,
        latestUpdate: selectedSession.latestUpdate,
        activePlan: selectedSession.activePlan,
        runtimeContext: selectedSession.runtimeContext,
        agents: customAgentsQuery.data,
        pendingApproval: selectedSession.pendingApproval,
        approvalResolving: selectedSession.approvalResolving,
        approvalError: selectedSession.approvalError,
        modelOptions: selectedSession.modelOptions,
        settingsUpdating: selectedSession.settingsUpdating,
        settingsError: selectedSession.settingsError,
        queueUpdating: selectedSession.queueUpdating,
        directShellConfirmation: selectedSession.directShellConfirmation,
        onSubmitPrompt: selectedSession.submitPrompt,
        onConfirmDirectShell: selectedSession.confirmDirectShell,
        onCancelDirectShellConfirmation: selectedSession.cancelDirectShellConfirmation,
        onUpdateQueuedPrompt: selectedSession.updateQueuedPrompt,
        onDeleteQueuedPrompt: selectedSession.deleteQueuedPrompt,
        onCancelRun: selectedSession.cancelRun,
        onUpdateDriftEnabled: selectedSession.updateDriftEnabled,
        onUpdatePermissionMode: selectedSession.updatePermissionMode,
        onUpdateModel: selectedSession.updateModel,
        onUpdateReasoningEffort: selectedSession.updateReasoningEffort,
        onResolveApproval: selectedSession.resolvePendingApproval,
      },
      taskView: {
        task: taskSelection.task,
        runs: taskSelection.runs,
        selectedRunId: taskSelection.selectedRunId,
        loading: taskSelection.loading,
        error: taskSelection.error,
        running: taskActions.taskSubmitting,
        onEditTask: taskActions.openEditDialog,
        onDeleteTask: taskActions.openDeleteDialog,
        onRunNow: taskActions.runSelectedTaskNow,
        onResumeTask: taskActions.resumeSelectedTask,
        onSetTaskEnabled: taskActions.setSelectedTaskEnabled,
        onSelectRun: taskSelection.selectRun,
      },
    },
    rightPanelProps: {
      activeRouteMode: navigation.activeRouteMode,
      workspaceId: sidebar.workspaceId,
      taskRun: {
        error: taskSelection.runDetail.error,
        liveTask: taskSelection.task,
        loading: taskSelection.runDetail.loading,
        run: taskSelection.runDetail.run,
        selectedRunId: taskSelection.selectedRunId,
      },
    } satisfies ControlPlaneRightPanelProps,
    taskCreateDialogProps: taskActions.createDialogProps,
    taskDeleteDialogProps: taskActions.deleteDialogProps,
    taskEditDialogProps: taskActions.editDialogProps,
  };

}

function applyPinnedSessionToSessions(
  current: ControlPlaneSessions | undefined,
  sessionId: string,
  pinned: boolean,
): ControlPlaneSessions | undefined {
  if (!current) {
    return current;
  }

  return {
    ...current,
    sessions: current.sessions.map((session) => (
      session.id === sessionId ? { ...session, pinned } : session
    )),
  };
}

function applyPinnedSessionToDetail(
  current: ControlPlaneSessionDetail | undefined,
  pinned: boolean,
): ControlPlaneSessionDetail | undefined {
  return current ? { ...current, pinned } : current;
}
