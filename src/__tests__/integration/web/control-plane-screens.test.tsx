// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlPlaneState, WorkspaceDirectoryListing } from '../../../web/lib/api.js';
import { OverviewScreen } from '../../../web/features/control-plane/screens/OverviewScreen.js';
import { TasksScreen } from '../../../web/features/control-plane/screens/TasksScreen.js';
import { WorkspacesScreen } from '../../../web/features/control-plane/screens/WorkspacesScreen.js';
import { browseWorkspaceDirectories } from '../../../web/lib/api.js';

vi.mock('../../../web/lib/api.js', () => ({
  browseWorkspaceDirectories: vi.fn(),
}));

describe('control-plane screens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDesktopViewport();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders overview workspace, runtime, recent activity, and overflow hints', () => {
    render(<OverviewScreen state={createControlPlaneState()} />);

    const activeWorkspace = screen.getByTestId('overview-active-workspace');
    expect(within(activeWorkspace).getByText('Primary')).toBeTruthy();
    expect(within(activeWorkspace).getByText('/Users/example/primary')).toBeTruthy();
    expect(within(activeWorkspace).getByText('Repos')).toBeTruthy();
    expect(within(activeWorkspace).getByText('Sessions')).toBeTruthy();
    expect(within(activeWorkspace).getByText('Tasks')).toBeTruthy();

    expect(screen.getByText('Runtime host')).toBeTruthy();
    expect(screen.getByText('127.0.0.1:4873')).toBeTruthy();
    expect(screen.getByText('session-one')).toBeTruthy();
    expect(screen.getByText('session-three')).toBeTruthy();
    expect(screen.queryByText('session-four')).toBeNull();
    expect(screen.getByText('Open Sessions to browse the full conversation catalog.')).toBeTruthy();
    expect(screen.getByText('run-1')).toBeTruthy();
    expect(screen.getByText('Open Tasks to inspect the full run history.')).toBeTruthy();
    expect(screen.getByText('Missing catalogs')).toBeTruthy();
    expect(screen.getByText('memory-run-1')).toBeTruthy();
  });

  it('preserves desktop task selection, actions, run history, and run details', () => {
    const state = createControlPlaneState();
    const task = state.heartbeat.tasks[0];
    const run = state.heartbeat.runs[0];
    const onSelectTask = vi.fn();
    const onSelectRun = vi.fn();
    const onDisableTask = vi.fn(async () => undefined);
    const onEnableTask = vi.fn(async () => undefined);
    const onTriggerTask = vi.fn(async () => undefined);

    render(
      <TasksScreen
        tasks={state.heartbeat.tasks}
        runs={state.heartbeat.runs}
        selectedTask={task}
        selectedTaskId={task.taskId}
        onSelectTask={onSelectTask}
        selectedRun={run}
        selectedRunId={run.id}
        onSelectRun={onSelectRun}
        selectedTaskRuns={state.heartbeat.runs.filter((candidate) => candidate.taskId === task.taskId)}
        onEnableTask={onEnableTask}
        onDisableTask={onDisableTask}
        onTriggerTask={onTriggerTask}
      />,
    );

    expect(screen.getByText('Tasks')).toBeTruthy();
    expect(screen.getAllByText('Sync memory')).toHaveLength(2);
    expect(screen.getAllByText('Summarize workspace state')).toHaveLength(2);
    expect(screen.getByText('Runtime status')).toBeTruthy();
    expect(screen.getByText('Latest summary')).toBeTruthy();
    expect(screen.getByText('History')).toBeTruthy();
    expect(screen.getByText('Run detail')).toBeTruthy();
    expect(screen.getAllByText('Heartbeat completed')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /Sync memory/ }));
    expect(onSelectTask).toHaveBeenCalledWith('task-1');

    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect(onTriggerTask).toHaveBeenCalledWith('task-1');

    fireEvent.click(screen.getByRole('button', { name: 'Pause task' }));
    expect(onDisableTask).toHaveBeenCalledWith('task-1');

    fireEvent.click(screen.getByRole('button', { name: /run-1/ }));
    expect(onSelectRun).toHaveBeenCalledWith('run-1');
    expect(onEnableTask).not.toHaveBeenCalled();
  });

  it('preserves workspace rename, switching, creation, recent workspace, and picker behavior', async () => {
    const state = createControlPlaneState();
    const onCreateWorkspace = vi.fn(async () => undefined);
    const onRenameWorkspace = vi.fn(async () => undefined);
    const onSetActiveWorkspace = vi.fn();
    vi.mocked(browseWorkspaceDirectories).mockResolvedValue(createWorkspaceListing('/Users/example'));

    render(
      <WorkspacesScreen
        state={state}
        onCreateWorkspace={onCreateWorkspace}
        onRenameWorkspace={onRenameWorkspace}
        onSetActiveWorkspace={onSetActiveWorkspace}
      />,
    );

    expect(screen.getByTestId('workspace-list')).toBeTruthy();
    expect(screen.getByTestId('recent-workspace-list')).toBeTruthy();
    expect(within(screen.getByTestId('workspace-card-primary')).getByText('Primary')).toBeTruthy();
    expect(within(screen.getByTestId('workspace-card-secondary')).getByText('Secondary')).toBeTruthy();

    const secondaryCard = screen.getByTestId('workspace-card-secondary');
    fireEvent.change(within(secondaryCard).getByLabelText('Workspace name'), { target: { value: 'Renamed secondary' } });
    fireEvent.click(within(secondaryCard).getByRole('button', { name: 'Rename' }));
    expect(onRenameWorkspace).toHaveBeenCalledWith('secondary', 'Renamed secondary');

    fireEvent.click(within(secondaryCard).getByRole('button', { name: 'Switch to workspace' }));
    expect(onSetActiveWorkspace).toHaveBeenCalledWith('secondary');

    fireEvent.change(screen.getByTestId('workspace-create-name'), { target: { value: 'Fresh' } });
    fireEvent.change(screen.getByTestId('workspace-create-path'), { target: { value: '/Users/example/fresh' } });
    fireEvent.click(screen.getByTestId('workspace-create-submit'));
    await waitFor(() => {
      expect(onCreateWorkspace).toHaveBeenCalledWith({
        name: 'Fresh',
        anchorRoot: '/Users/example/fresh',
        setActive: true,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: /Archived/ }));
    expect(onCreateWorkspace).toHaveBeenLastCalledWith({
      name: 'Archived',
      anchorRoot: '/Users/example/archived',
      setActive: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose workspace folder' });
    expect(within(dialog).getByText('Choose a project root')).toBeTruthy();
    await waitFor(() => {
      expect(browseWorkspaceDirectories).toHaveBeenCalledWith(undefined, false);
      expect(within(dialog).getByText('fresh')).toBeTruthy();
    });

    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Select' })[0]);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Choose workspace folder' })).toBeNull();
    });
    expect(screen.getByTestId('workspace-create-path')).toHaveProperty('value', '/Users/example/fresh');
  });
});

function createControlPlaneState(): ControlPlaneState {
  return {
    workspaceRoot: '/Users/example/primary',
    stateRoot: '/Users/example/primary/.heddle',
    auth: {
      preferApiKey: false,
      openai: { type: 'missing', provider: 'openai' },
      anthropic: { type: 'missing', provider: 'anthropic' },
    },
    activeWorkspaceId: 'primary',
    workspace: {
      id: 'primary',
      name: 'Primary',
      anchorRoot: '/Users/example/primary',
      repoRoots: ['/Users/example/primary'],
      stateRoot: '/Users/example/primary/.heddle',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
    },
    workspaces: [
      {
        id: 'primary',
        name: 'Primary',
        anchorRoot: '/Users/example/primary',
        repoRoots: ['/Users/example/primary'],
        stateRoot: '/Users/example/primary/.heddle',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-02T00:00:00.000Z',
      },
      {
        id: 'secondary',
        name: 'Secondary',
        anchorRoot: '/Users/example/secondary',
        repoRoots: ['/Users/example/secondary'],
        stateRoot: '/Users/example/secondary/.heddle',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
      },
    ],
    knownWorkspaces: [
      {
        id: 'archived',
        name: 'Archived',
        anchorRoot: '/Users/example/archived',
        repoRoots: ['/Users/example/archived'],
        stateRoot: '/Users/example/archived/.heddle',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
      },
    ],
    runtimeHost: {
      mode: 'daemon',
      ownerId: 'owner-1',
      registryPath: '/Users/example/.heddle/daemon.json',
      endpoint: { host: '127.0.0.1', port: 4873 },
      startedAt: '2026-04-02T00:00:00.000Z',
      workspaceOwner: { ownerId: 'owner-1', workspaceRoot: '/Users/example/primary', stateRoot: '/Users/example/primary/.heddle', lastSeenAt: '2026-04-02T00:10:00.000Z' },
    },
    sessions: [
      createSession('session-one', 'gpt-5.4', 3),
      createSession('session-two', 'gpt-5.4', 2),
      createSession('session-three', 'gpt-5.4', 1),
      createSession('session-four', undefined, 0),
    ],
    heartbeat: {
      tasks: [
        {
          taskId: 'task-1',
          workspaceId: 'primary',
          name: 'Sync memory',
          task: 'Summarize workspace state',
          enabled: true,
          status: 'waiting',
          decision: 'continue',
          outcome: 'done',
          progress: 'Progress update',
          summary: 'Latest task summary',
          nextRunAt: '2026-04-02T01:00:00.000Z',
          lastRunAt: '2026-04-02T00:30:00.000Z',
          lastRunId: 'run-1',
          loadedCheckpoint: true,
          resumable: true,
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
          intervalMs: 60_000,
          model: 'gpt-5.4',
        },
      ],
      runs: [
        {
          id: 'run-1',
          taskId: 'task-1',
          workspaceId: 'primary',
          runId: 'agent-run-1',
          createdAt: '2026-04-02T00:30:00.000Z',
          task: 'Summarize workspace state',
          enabled: true,
          status: 'complete',
          decision: 'continue',
          outcome: 'done',
          progress: 'Run progress',
          summary: 'Heartbeat completed',
          loadedCheckpoint: true,
          resumable: true,
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
        {
          id: 'run-2',
          taskId: 'task-1',
          workspaceId: 'primary',
          runId: 'agent-run-2',
          createdAt: '2026-04-02T00:20:00.000Z',
          task: 'Summarize workspace state',
          enabled: true,
          status: 'complete',
          decision: 'continue',
          outcome: 'done',
          summary: 'Previous heartbeat completed',
          loadedCheckpoint: false,
          resumable: true,
        },
        {
          id: 'run-3',
          taskId: 'task-1',
          workspaceId: 'primary',
          runId: 'agent-run-3',
          createdAt: '2026-04-02T00:10:00.000Z',
          task: 'Summarize workspace state',
          enabled: true,
          status: 'complete',
          decision: 'continue',
          outcome: 'done',
          summary: 'Older heartbeat completed',
          loadedCheckpoint: false,
          resumable: true,
        },
        {
          id: 'run-4',
          taskId: 'task-1',
          workspaceId: 'primary',
          runId: 'agent-run-4',
          createdAt: '2026-04-02T00:00:00.000Z',
          task: 'Summarize workspace state',
          enabled: true,
          status: 'complete',
          decision: 'continue',
          outcome: 'done',
          summary: 'Oldest heartbeat completed',
          loadedCheckpoint: false,
          resumable: true,
        },
      ],
    },
    memory: {
      memoryRoot: '/Users/example/primary/.heddle/memory',
      catalog: { ok: false, missing: ['README.md'] },
      notes: { count: 4 },
      candidates: { pending: 2 },
      runs: {
        latest: [{
          id: 'memory-run-1',
          startedAt: '2026-04-02T00:00:00.000Z',
          finishedAt: '2026-04-02T00:01:00.000Z',
          source: 'test',
          outcome: 'done',
          summary: 'Memory maintenance completed',
          candidateIds: ['candidate-1'],
          processedCandidateIds: ['candidate-1'],
          failedCandidateIds: [],
          catalogValid: false,
          catalogMissing: ['README.md'],
        }],
      },
    },
  };
}

function createSession(id: string, model: string | undefined, turnCount: number): ControlPlaneState['sessions'][number] {
  return {
    id,
    name: id,
    workspaceId: 'primary',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-02T00:00:00.000Z',
    model,
    driftEnabled: false,
    messageCount: turnCount + 1,
    turnCount,
    lastSummary: `${id} summary`,
  };
}

function createWorkspaceListing(path: string): WorkspaceDirectoryListing {
  return {
    path,
    parentPath: '/Users',
    entries: [{
      name: 'fresh',
      path: '/Users/example/fresh',
      hasGit: true,
      hasPackageJson: true,
      hasHeddleState: false,
    }],
  };
}

function mockDesktopViewport() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: !query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
