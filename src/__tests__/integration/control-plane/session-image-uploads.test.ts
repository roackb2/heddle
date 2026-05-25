import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
import { RuntimeWorkspaceService } from '@/core/runtime/workspaces/index.js';
import { createHeddleServerApp } from '@/server/app.js';

describe('control-plane session image uploads', () => {
  it('stores multiple uploaded images under the session upload directory', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-session-image-upload-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const sessionId = 'session-images';
    new FileChatSessionRepository({
      sessionStoragePath: join(stateRoot, 'chat-sessions.catalog.json'),
    }).save([
      ChatSessionRecords.create({
        id: sessionId,
        name: 'Image session',
        apiKeyPresent: true,
      }),
    ]);

    const server = createHeddleServerApp({ workspaceRoot, stateRoot }).listen(0, '127.0.0.1');
    await onceListening(server);
    const address = server.address() as AddressInfo;

    try {
      const formData = new FormData();
      formData.append('images', new Blob(['fake-png'], { type: 'image/png' }), 'screen.png');
      formData.append('images', new Blob(['fake-webp'], { type: 'image/webp' }), 'detail.webp');
      formData.append('images', new Blob(['fake-screenshot'], { type: 'image/png' }), '截圖 2026-05-24 上午 11.26.12.png');

      const response = await fetch(`http://127.0.0.1:${address.port}/control-plane/sessions/${sessionId}/uploads`, {
        method: 'POST',
        body: formData,
      });
      const body = await response.json() as {
        uploads?: Array<{ path: string; originalName: string; mediaType: string; sizeBytes: number }>;
      };

      expect(response.status).toBe(200);
      expect(body.uploads).toHaveLength(3);
      expect(body.uploads?.map((upload) => upload.originalName)).toEqual([
        'screen.png',
        'detail.webp',
        '截圖 2026-05-24 上午 11.26.12.png',
      ]);
      expect(body.uploads?.map((upload) => upload.mediaType)).toEqual(['image/png', 'image/webp', 'image/png']);
      expect(body.uploads?.every((upload) => upload.path.includes(join('.heddle', 'uploads', 'sessions', sessionId)))).toBe(true);
      expect(body.uploads?.every((upload) => existsSync(upload.path))).toBe(true);
      const log = await readLogUntil(join(stateRoot, 'logs', 'server.log'), 'Control-plane session images uploaded');
      expect(log).toContain(sessionId);
    } finally {
      await closeServer(server);
    }
  });

  it('rejects unsupported upload types', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-session-image-upload-reject-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const sessionId = 'session-images';
    new FileChatSessionRepository({
      sessionStoragePath: join(stateRoot, 'chat-sessions.catalog.json'),
    }).save([
      ChatSessionRecords.create({
        id: sessionId,
        name: 'Image session',
        apiKeyPresent: true,
      }),
    ]);

    const server = createHeddleServerApp({ workspaceRoot, stateRoot }).listen(0, '127.0.0.1');
    await onceListening(server);
    const address = server.address() as AddressInfo;

    try {
      const formData = new FormData();
      formData.append('images', new Blob(['not-image'], { type: 'text/plain' }), 'notes.txt');

      const response = await fetch(`http://127.0.0.1:${address.port}/control-plane/sessions/${sessionId}/uploads`, {
        method: 'POST',
        body: formData,
      });
      const body = await response.json() as { error?: string };

      expect(response.status).toBe(400);
      expect(body.error).toContain('Upload supports');
    } finally {
      await closeServer(server);
    }
  });

  it('stores uploads and upload logs under the requested workspace state root', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-session-image-upload-workspaces-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    RuntimeWorkspaceService.ensureCatalog({ workspaceRoot, stateRoot });
    const resolved = RuntimeWorkspaceService.createDescriptor({
      workspaceRoot,
      stateRoot,
      name: 'Second workspace',
      newWorkspaceRoot: join(workspaceRoot, 'second'),
      setActive: false,
      nextId: 'workspace-2',
    });
    const secondWorkspace = resolved.workspaces.find((workspace) => workspace.id === 'workspace-2');
    if (!secondWorkspace) {
      throw new Error('expected second workspace');
    }

    const sessionId = 'session-images';
    new FileChatSessionRepository({
      sessionStoragePath: join(secondWorkspace.stateRoot, 'chat-sessions.catalog.json'),
    }).save([
      ChatSessionRecords.create({
        id: sessionId,
        name: 'Image session',
        apiKeyPresent: true,
        workspaceId: secondWorkspace.id,
      }),
    ]);

    const server = createHeddleServerApp({ workspaceRoot, stateRoot }).listen(0, '127.0.0.1');
    await onceListening(server);
    const address = server.address() as AddressInfo;

    try {
      const formData = new FormData();
      formData.append('images', new Blob(['fake-png'], { type: 'image/png' }), 'screen.png');

      const response = await fetch(`http://127.0.0.1:${address.port}/control-plane/sessions/${sessionId}/uploads?workspaceId=${secondWorkspace.id}`, {
        method: 'POST',
        body: formData,
      });
      const body = await response.json() as {
        uploads?: Array<{ path: string; originalName: string; mediaType: string; sizeBytes: number }>;
      };

      expect(response.status).toBe(200);
      expect(body.uploads).toHaveLength(1);
      expect(body.uploads?.[0]?.path).toContain(join(secondWorkspace.stateRoot, 'uploads', 'sessions', sessionId));
      expect(body.uploads?.[0]?.path).not.toContain(join(stateRoot, 'uploads', 'sessions', sessionId));
      const secondLog = await readLogUntil(join(secondWorkspace.stateRoot, 'logs', 'server.log'), 'Control-plane session images uploaded');
      expect(secondLog).toContain(secondWorkspace.id);
      const defaultLogPath = join(stateRoot, 'logs', 'server.log');
      const defaultLog = existsSync(defaultLogPath) ? readFileSync(defaultLogPath, 'utf8') : '';
      expect(defaultLog).not.toContain('Control-plane session images uploaded');
    } finally {
      await closeServer(server);
    }
  });
});

async function onceListening(server: { once: (event: 'listening', listener: () => void) => void; listening?: boolean }) {
  if (server.listening) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
}

async function closeServer(server: { close: (listener: (error?: Error) => void) => void }) {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function readLogUntil(path: string, expectedText: string): Promise<string> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8');
      if (text.includes(expectedText)) {
        return text;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}
