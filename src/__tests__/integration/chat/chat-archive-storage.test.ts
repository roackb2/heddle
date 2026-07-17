import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ChatArchiveStorageCorruptionError,
  FileChatArchiveRepository,
} from '@/core/chat/engine/sessions/archives/index.js';

describe('file chat archive repository', () => {
  it('persists exact messages, summaries, and a valid v1 manifest for a fresh repository instance', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-chat-archives-'));
    const writer = new FileChatArchiveRepository({ stateRoot });

    const appended = await writer.append({
      sessionId: 'session-1',
      archive: {
        id: 'archive-1',
        shortDescription: 'Investigated the storage boundary',
        messageCount: 2,
        createdAt: '2026-07-17T00:00:00.000Z',
        summaryModel: 'gpt-5.4',
      },
      messages: [
        { role: 'user', content: 'Inspect the repository.' },
        { role: 'assistant', content: 'The storage boundary is here.' },
      ],
      summary: '# Rolling summary\n\nStorage boundary inspected.',
    });

    const reopened = new FileChatArchiveRepository({ stateRoot });
    const manifest = await reopened.loadManifest('session-1');
    const paths = reopened.deriveStoragePaths('session-1');

    expect(appended.archive).toEqual(expect.objectContaining({
      id: 'archive-1',
      path: '.heddle/chat-sessions/session-1/archives/archive-1.jsonl',
      summaryPath: '.heddle/chat-sessions/session-1/archives/archive-1.summary.md',
    }));
    expect(manifest).toEqual(appended.manifest);
    await expect(reopened.readSummary(appended.archive.summaryPath)).resolves.toContain('Storage boundary inspected.');
    expect(await readFile(join(paths.archivesDir, 'archive-1.jsonl'), 'utf8')).toContain(
      '"content":"Inspect the repository."',
    );
  });

  it('serializes concurrent appends across repository instances without losing an archive', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-chat-archive-race-'));
    const first = new FileChatArchiveRepository({ stateRoot });
    const second = new FileChatArchiveRepository({ stateRoot });

    await Promise.all([
      first.append(appendInput('archive-a', 'First summary')),
      second.append(appendInput('archive-b', 'Second summary')),
    ]);

    const manifest = await new FileChatArchiveRepository({ stateRoot }).loadManifest('session-1');
    expect(manifest.archives.map((archive) => archive.id).sort()).toEqual(['archive-a', 'archive-b']);
    expect(manifest.currentSummaryPath).toMatch(/archive-(a|b)\.summary\.md$/);
  });

  it('fails loudly for malformed or session-mismatched manifests', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-chat-archive-corrupt-'));
    const repository = new FileChatArchiveRepository({ stateRoot });
    const paths = repository.deriveStoragePaths('session-1');
    await mkdir(paths.archivesDir, { recursive: true });
    await writeFile(paths.manifestPath, JSON.stringify({
      version: 1,
      sessionId: 'another-session',
      archives: [],
    }));

    await expect(repository.loadManifest('session-1'))
      .rejects.toBeInstanceOf(ChatArchiveStorageCorruptionError);

    await writeFile(paths.manifestPath, '{not-json');
    await expect(repository.loadManifest('session-1'))
      .rejects.toBeInstanceOf(ChatArchiveStorageCorruptionError);
  });

  it('keeps host-provided session and archive ids inside the archive root', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-chat-archive-path-safety-'));
    const repository = new FileChatArchiveRepository({ stateRoot });

    const appended = await repository.append({
      ...appendInput('../archive', 'Safe summary'),
      sessionId: '../session',
    });

    expect(appended.archive.path).toBe(
      '.heddle/chat-sessions/..%2Fsession/archives/..%2Farchive.jsonl',
    );
    await expect(readFile(
      join(stateRoot, 'chat-sessions', '..%2Fsession', 'archives', '..%2Farchive.jsonl'),
      'utf8',
    )).resolves.toContain('../archive');
  });

  it('rejects summary locators outside the configured state root', async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'heddle-chat-archive-locator-safety-'));
    const repository = new FileChatArchiveRepository({ stateRoot });

    await expect(repository.readSummary('/tmp/untrusted-summary.md'))
      .rejects.toBeInstanceOf(ChatArchiveStorageCorruptionError);
    await expect(repository.readSummary('.heddle/../../untrusted-summary.md'))
      .rejects.toBeInstanceOf(ChatArchiveStorageCorruptionError);
  });
});

function appendInput(archiveId: string, summary: string) {
  return {
    sessionId: 'session-1',
    archive: {
      id: archiveId,
      messageCount: 1,
      createdAt: '2026-07-17T00:00:00.000Z',
      summaryModel: 'gpt-5.4',
    },
    messages: [{ role: 'user' as const, content: archiveId }],
    summary,
  };
}
