import { existsSync, mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChatSessionRecords } from '@/core/chat/engine/sessions/records/index.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';
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
