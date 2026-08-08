/**
 * File-backed heartbeat task repository.
 *
 * Owns task, checkpoint, and run-record file I/O for heartbeat scheduling.
 * Scheduler and host code should depend on this repository contract instead of
 * reading heartbeat JSON files directly.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import dayjs from 'dayjs';
import type { AgentLoopCheckpoint } from '@/core/runtime/loop/index.js';
import { AgentLoopCheckpointSchema, HeartbeatTaskRunRecordSchema, HeartbeatTaskSchema } from './schemas.js';
import { HeartbeatTaskStateProjector } from './task-state.js';
import type {
  FileHeartbeatTaskRepositoryOptions,
  HeartbeatTask,
  HeartbeatTaskRunRecord,
  HeartbeatTaskRunRecordEntry,
} from './types.js';

export class FileHeartbeatTaskRepository {
  private readonly tasksDir: string;
  private readonly checkpointsDir: string;
  private readonly runsDir: string;

  constructor(options: FileHeartbeatTaskRepositoryOptions) {
    this.tasksDir = join(options.dir, 'tasks');
    this.checkpointsDir = join(options.dir, 'checkpoints');
    this.runsDir = join(options.dir, 'runs');
  }

  async listTasks(): Promise<HeartbeatTask[]> {
    if (!existsSync(this.tasksDir)) {
      return [];
    }

    return readdirSync(this.tasksDir)
      .filter((entry) => entry.endsWith('.json'))
      .flatMap((entry) => this.readTaskFile(join(this.tasksDir, entry)))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async loadTask(taskId: string): Promise<HeartbeatTask | undefined> {
    const path = join(this.tasksDir, `${FileHeartbeatTaskRepository.safeTaskFileName(taskId)}.json`);
    return this.readTaskFile(path).at(0);
  }

  async saveTask(task: HeartbeatTask): Promise<void> {
    const path = join(this.tasksDir, `${FileHeartbeatTaskRepository.safeTaskFileName(task.id)}.json`);
    this.writeJsonAtomically(path, HeartbeatTaskSchema.parse(HeartbeatTaskStateProjector.normalize(task)));
  }

  async deleteTask(task: HeartbeatTask): Promise<void> {
    const safeTaskId = FileHeartbeatTaskRepository.safeTaskFileName(task.id);
    rmSync(join(this.tasksDir, `${safeTaskId}.json`), { force: true });
    rmSync(this.checkpointPathForTask(task), { force: true });
    await this.deleteRunRecordsForTask(task.id);
  }

  async loadCheckpoint(task: HeartbeatTask): Promise<AgentLoopCheckpoint | undefined> {
    const path = this.checkpointPathForTask(task);
    if (!existsSync(path)) {
      return undefined;
    }

    try {
      const parsed = AgentLoopCheckpointSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
      return parsed.success ? parsed.data as AgentLoopCheckpoint : undefined;
    } catch {
      return undefined;
    }
  }

  async saveCheckpoint(task: HeartbeatTask, checkpoint: AgentLoopCheckpoint): Promise<void> {
    const path = this.checkpointPathForTask(task);
    this.writeJsonAtomically(path, AgentLoopCheckpointSchema.parse(checkpoint));
  }

  async saveRunRecord(record: HeartbeatTaskRunRecord): Promise<void> {
    const timestamp = dayjs().toISOString().replaceAll(':', '-');
    const path = join(
      this.runsDir,
      `${timestamp}-${FileHeartbeatTaskRepository.safeTaskFileName(record.task.id)}-${randomUUID()}.json`,
    );
    this.writeJsonAtomically(path, HeartbeatTaskRunRecordSchema.parse(record));
  }

  async listRunRecords(options: { taskId?: string; limit?: number } = {}): Promise<HeartbeatTaskRunRecordEntry[]> {
    if (!existsSync(this.runsDir)) {
      return [];
    }

    const entries = readdirSync(this.runsDir)
      .filter((entry) => entry.endsWith('.json'))
      .flatMap((entry) => this.readRunRecordFile(join(this.runsDir, entry), options))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return options.limit ? entries.slice(0, options.limit) : entries;
  }

  async loadRunRecord(id: string): Promise<HeartbeatTaskRunRecordEntry | undefined> {
    const entries = await this.listRunRecords();
    return entries.find((entry) => entry.id === id || entry.executionId === id || entry.runId === id);
  }

  private async deleteRunRecordsForTask(taskId: string): Promise<void> {
    const entries = await this.listRunRecords({ taskId });
    entries.forEach((entry) => rmSync(entry.path, { force: true }));
  }

  private readTaskFile(path: string): HeartbeatTask[] {
    try {
      const parsed = HeartbeatTaskSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
      return parsed.success ? [HeartbeatTaskStateProjector.normalize(parsed.data as HeartbeatTask)] : [];
    } catch {
      return [];
    }
  }

  private readRunRecordFile(
    path: string,
    options: { taskId?: string },
  ): HeartbeatTaskRunRecordEntry[] {
    try {
      const parsed = HeartbeatTaskRunRecordSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
      if (!parsed.success || (options.taskId && parsed.data.task.id !== options.taskId)) {
        return [];
      }

      return [FileHeartbeatTaskRepository.runRecordEntryFromPath(path, parsed.data as HeartbeatTaskRunRecord)];
    } catch {
      return [];
    }
  }

  private checkpointPathForTask(task: HeartbeatTask): string {
    return task.checkpointPath ?? join(
      this.checkpointsDir,
      `${FileHeartbeatTaskRepository.safeTaskFileName(task.id)}.json`,
    );
  }

  /**
   * Replaces one JSON document through a sibling temporary file so readers see
   * either the previous complete document or the next complete document.
   */
  private writeJsonAtomically(path: string, value: unknown): void {
    const directory = dirname(path);
    const temporaryPath = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
    mkdirSync(directory, { recursive: true });

    try {
      writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
      renameSync(temporaryPath, path);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }

  private static safeTaskFileName(id: string): string {
    if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
      throw new Error(`Invalid heartbeat task id "${id}". Use only letters, numbers, dots, underscores, and hyphens.`);
    }
    return id;
  }

  private static runRecordEntryFromPath(path: string, record: HeartbeatTaskRunRecord): HeartbeatTaskRunRecordEntry {
    const id = basename(path, '.json');
    const outcome = FileHeartbeatTaskRepository.resolveRecordOutcome(record);
    return {
      id,
      path,
      taskId: record.task.id,
      workspaceId: record.task.workspaceId,
      executionId: outcome.executionId,
      runId: record.result?.state.runId,
      createdAt: outcome.finishedAt,
      record,
    };
  }

  private static resolveRecordOutcome(record: HeartbeatTaskRunRecord) {
    if (record.outcome) {
      return record.outcome;
    }

    if (!record.result) {
      throw new Error(`Heartbeat record for task ${record.task.id} has no execution outcome.`);
    }

    return {
      kind: 'agent' as const,
      executionId: record.result.state.runId,
      summary: record.result.summary,
      finishedAt: record.result.state.finishedAt,
    };
  }
}
