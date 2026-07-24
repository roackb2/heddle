import { Router } from 'express';
import type { HeddleServerRequestAccessService } from '@/server/access/index.js';
import { createChatSessionEventRouter } from './control-plane-chat-session-events.js';
import { createChatSessionUploadRouter } from './control-plane-chat-session-uploads.js';

type CreateControlPlaneApiRouterOptions = {
  workspaceRoot: string;
  stateRoot: string;
  requestAccess: HeddleServerRequestAccessService;
};

export function createControlPlaneApiRouter(options: CreateControlPlaneApiRouterOptions): Router {
  const controlPlaneApi = Router();

  controlPlaneApi.use('/control-plane', createChatSessionUploadRouter(options));
  controlPlaneApi.use('/control-plane', createChatSessionEventRouter(options));

  return controlPlaneApi;
}
