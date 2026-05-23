import {
  FileHeartbeatTaskService,
  HeartbeatTaskRunnerService,
  type HeartbeatTaskRunner,
} from '@/core/heartbeat/index.js';

type CreateHeartbeatTaskArgs = {
  workspaceId?: string;
  id?: string;
  name?: string;
  task: string;
  enabled?: boolean;
  intervalMs?: number;
  defer?: boolean;
  model?: string;
  maxSteps?: number;
  workspaceRoot?: string;
  stateDir?: string;
  searchIgnoreDirs?: string[];
  systemContext?: string;
};

type RunHeartbeatTaskNowArgs = {
  taskId: string;
  workspaceRoot: string;
  stateDir?: string;
  apiKey?: string;
  preferApiKey?: boolean;
  model?: string;
  maxSteps?: number;
  searchIgnoreDirs?: string[];
  systemContext?: string;
  runner?: HeartbeatTaskRunner;
};

export class ControlPlaneHeartbeatController {
  static async listTasks(stateRoot: string) {
    return await new FileHeartbeatTaskService({ stateRoot }).listTaskViews();
  }

  static async listRuns(
    stateRoot: string,
    options: { taskId?: string; limit?: number } = {},
  ) {
    return await new FileHeartbeatTaskService({ stateRoot }).listRunViews(options);
  }

  static async createTask(
    stateRoot: string,
    args: CreateHeartbeatTaskArgs,
  ) {
    return await new FileHeartbeatTaskService({ stateRoot }).createTask(args);
  }

  static async readTask(
    stateRoot: string,
    taskId: string,
    options: { runLimit?: number } = {},
  ) {
    return await new FileHeartbeatTaskService({ stateRoot }).readTask(taskId, options);
  }

  static async readRun(
    stateRoot: string,
    taskId: string,
    runId: string,
  ) {
    return await new FileHeartbeatTaskService({ stateRoot }).readRun(taskId, runId);
  }

  static async setTaskEnabled(
    stateRoot: string,
    taskId: string,
    enabled: boolean,
  ) {
    return await new FileHeartbeatTaskService({ stateRoot }).setTaskEnabled(taskId, enabled);
  }

  static async triggerTaskRun(stateRoot: string, taskId: string) {
    return await new FileHeartbeatTaskService({ stateRoot }).triggerTaskRun(taskId);
  }

  static async runTaskNow(
    stateRoot: string,
    args: RunHeartbeatTaskNowArgs,
  ) {
    const tasks = new FileHeartbeatTaskService({ stateRoot });
    const result = await HeartbeatTaskRunnerService.runTaskById({
      store: tasks,
      taskId: args.taskId,
      runner: args.runner,
      runtime: args.runner ? undefined : {
        apiKey: args.apiKey,
        apiKeyProvider: args.apiKey ? 'explicit' : undefined,
        model: args.model,
        maxSteps: args.maxSteps,
        workspaceRoot: args.workspaceRoot,
        stateDir: args.stateDir ?? stateRoot,
        searchIgnoreDirs: args.searchIgnoreDirs,
        systemContext: args.systemContext,
        preferApiKey: args.preferApiKey,
      },
    });
    const [run] = await tasks.listRunViews({
      taskId: args.taskId,
      limit: 1,
    });
    return {
      ...result,
      task: tasks.projectTaskView(await tasks.requireTask(args.taskId)),
      run: run ?? null,
    };
  }
}
