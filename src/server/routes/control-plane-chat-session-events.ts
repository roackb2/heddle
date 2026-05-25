import { Router } from 'express';
import { ChatSessionEventsRestController } from '@/server/controllers/restful/control-plane/chat-session-events.js';

type CreateChatSessionEventRouterOptions = {
  workspaceRoot: string;
  stateRoot: string;
};

export function createChatSessionEventRouter(options: CreateChatSessionEventRouterOptions): Router {
  const router = Router();
  const controller = new ChatSessionEventsRestController(options);

  router.get('/sessions/:sessionId/events', controller.streamEvents);

  return router;
}
