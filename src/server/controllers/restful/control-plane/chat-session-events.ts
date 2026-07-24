import { watch } from 'node:fs';
import type { Request, Response } from 'express';
import {
  HeddleServerAccessError,
  type HeddleServerRequestAccessService,
} from '@/server/access/index.js';
import type { WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';
import { controlPlaneChatSessionsController } from '@/server/controllers/trpc/control-plane/chat-sessions-controller.js';

type ChatSessionEventsRestControllerOptions = {
  requestAccess: HeddleServerRequestAccessService;
};

export class ChatSessionEventsRestController {
  constructor(private readonly options: ChatSessionEventsRestControllerOptions) {}

  streamEvents = async (request: Request, response: Response): Promise<void> => {
    const sessionId = typeof request.params.sessionId === 'string' ? request.params.sessionId.trim() : '';
    if (!sessionId) {
      response.status(400).json({ error: 'Missing sessionId' });
      return;
    }

    const workspaceId = this.readWorkspaceId(request);
    let workspace: WorkspaceDescriptor;
    try {
      workspace = this.options.requestAccess.resolveWorkspace(request, workspaceId);
      await this.options.requestAccess.authorizeOperation(request, {
        name: 'sessionEvents',
        type: 'subscription',
        workspaceId: workspace.id,
        sessionId,
      });
    } catch (error) {
      if (error instanceof HeddleServerAccessError) {
        response.status(error.statusCode).json({ error: error.message });
        return;
      }
      throw error;
    }

    const sessionFilePath = controlPlaneChatSessionsController.resolveFilePath(
      workspace.stateRoot,
      sessionId,
    );
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();

    const send = (event: string, data: Record<string, unknown>) => {
      response.write(`event: ${event}\n`);
      response.write(`data: ${JSON.stringify(data)}\n\n`);
      (response as typeof response & { flush?: () => void }).flush?.();
    };

    send('ready', { sessionId, workspaceId: workspace.id });
    const heartbeat = setInterval(() => {
      send('heartbeat', { sessionId, workspaceId: workspace.id, timestamp: new Date().toISOString() });
    }, 15000);

    const unsubscribe = controlPlaneChatSessionsController.subscribeToEvents({
      workspaceId: workspace.id,
      sessionId,
    }, (payload) => {
      send(payload.type, payload);
    });

    let watcher: ReturnType<typeof watch> | undefined;
    try {
      watcher = watch(sessionFilePath, { persistent: false }, () => {
        send('session.updated', { sessionId, workspaceId: workspace.id, timestamp: new Date().toISOString() });
      });
    } catch {
      send('waiting', { sessionId, workspaceId: workspace.id, timestamp: new Date().toISOString() });
    }

    request.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      watcher?.close();
      response.end();
    });
  };

  private readWorkspaceId(request: Request): string | undefined {
    const rawWorkspaceId = request.query.workspaceId;
    const workspaceId = typeof rawWorkspaceId === 'string' ? rawWorkspaceId.trim() : '';
    return workspaceId || undefined;
  }
}
