import { resolve } from 'node:path';
import {
  listMemoryNotePaths,
  loadMemoryStatus,
  readMemoryNote,
  searchMemoryNotes,
} from '../../../../core/memory/visibility.js';

export class ControlPlaneMemoryController {
  static async readStatus(stateRoot: string) {
    return await loadMemoryStatus({ memoryRoot: ControlPlaneMemoryController.memoryRoot(stateRoot) });
  }

  static async listNotes(stateRoot: string, path?: string) {
    const memoryRoot = ControlPlaneMemoryController.memoryRoot(stateRoot);
    return {
      memoryRoot,
      notes: await listMemoryNotePaths({ memoryRoot, path }),
    };
  }

  static async readNote(stateRoot: string, path: string, options?: { offset?: number; maxLines?: number }) {
    const memoryRoot = ControlPlaneMemoryController.memoryRoot(stateRoot);
    return {
      memoryRoot,
      path,
      content: await readMemoryNote({
        memoryRoot,
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
      matches: await searchMemoryNotes({
        memoryRoot,
        query,
        path: options?.path,
        maxResults: options?.maxResults,
      }),
    };
  }

  private static memoryRoot(stateRoot: string): string {
    return resolve(stateRoot, 'memory');
  }
}
