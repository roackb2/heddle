import { Router } from 'express';
import { createChatSessionEventRouter } from './control-plane-chat-session-events.js';
import { createChatSessionUploadRouter } from './control-plane-chat-session-uploads.js';

type CreateControlPlaneApiRouterOptions = {
  workspaceRoot: string;
  stateRoot: string;
};

export function createControlPlaneApiRouter(options: CreateControlPlaneApiRouterOptions): Router {
  const controlPlaneApi = Router();

  controlPlaneApi.use('/control-plane', createChatSessionUploadRouter(options));
  controlPlaneApi.use('/control-plane', createChatSessionEventRouter(options));

  return controlPlaneApi;
}
