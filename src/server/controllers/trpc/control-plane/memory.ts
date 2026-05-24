import { resolve } from 'node:path';
import { MemoryVisibilityService } from '@/core/memory/visibility.js';

export class ControlPlaneMemoryController {
  static async readStatus(stateRoot: string) {
    return await ControlPlaneMemoryController.memory(stateRoot).loadStatus();
  }

  static async listNotes(stateRoot: string, path?: string) {
    const memoryRoot = ControlPlaneMemoryController.memoryRoot(stateRoot);
    return {
      memoryRoot,
      notes: await new MemoryVisibilityService(memoryRoot).listNotePaths(path),
    };
  }

  static async readNote(stateRoot: string, path: string, options?: { offset?: number; maxLines?: number }) {
    const memoryRoot = ControlPlaneMemoryController.memoryRoot(stateRoot);
    return {
      memoryRoot,
      path,
      content: await new MemoryVisibilityService(memoryRoot).readNote({
        path,
        offset: options?.offset,
        maxLines: options?.maxLines,
      }),
    };
  }

  static async searchNotes(stateRoot: string, query: string, options?: { path?: string; maxResults?: number }) {
    const memoryRoot = ControlPlaneMemoryController.memoryRoot(stateRoot);
    return {
      memoryRoot,
      query,
      matches: await new MemoryVisibilityService(memoryRoot).searchNotes({
        query,
        path: options?.path,
        maxResults: options?.maxResults,
      }),
    };
  }

  private static memoryRoot(stateRoot: string): string {
    return resolve(stateRoot, 'memory');
  }

  private static memory(stateRoot: string): MemoryVisibilityService {
    return new MemoryVisibilityService(ControlPlaneMemoryController.memoryRoot(stateRoot));
  }
}
