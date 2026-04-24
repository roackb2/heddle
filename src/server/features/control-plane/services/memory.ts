import { resolve } from 'node:path';
import {
  listMemoryNotePaths,
  loadMemoryStatus,
  readMemoryNote,
  searchMemoryNotes,
} from '../../../../core/memory/visibility.js';

export async function readControlPlaneMemoryStatus(stateRoot: string) {
  return await loadMemoryStatus({ memoryRoot: resolve(stateRoot, 'memory') });
}

export async function listControlPlaneMemoryNotes(stateRoot: string, path?: string) {
  return {
    memoryRoot: resolve(stateRoot, 'memory'),
    notes: await listMemoryNotePaths({ memoryRoot: resolve(stateRoot, 'memory'), path }),
  };
}

export async function readControlPlaneMemoryNote(stateRoot: string, path: string, options?: { offset?: number; maxLines?: number }) {
  return {
    memoryRoot: resolve(stateRoot, 'memory'),
    path,
    content: await readMemoryNote({
      memoryRoot: resolve(stateRoot, 'memory'),
      path,
      offset: options?.offset,
      maxLines: options?.maxLines,
    }),
  };
}

export async function searchControlPlaneMemoryNotes(stateRoot: string, query: string, options?: { path?: string; maxResults?: number }) {
  return {
    memoryRoot: resolve(stateRoot, 'memory'),
    query,
    matches: await searchMemoryNotes({
      memoryRoot: resolve(stateRoot, 'memory'),
      query,
      path: options?.path,
      maxResults: options?.maxResults,
    }),
  };
}
