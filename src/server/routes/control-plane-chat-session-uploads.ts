import { Router } from 'express';
import { ChatSessionImageUploadService } from '@/server/services/control-plane/chat-session-image-uploads.js';
import { ChatSessionUploadsRestController } from '@/server/controllers/restful/control-plane/chat-session-uploads.js';

type CreateChatSessionUploadRouterOptions = {
  workspaceRoot: string;
  stateRoot: string;
};

export function createChatSessionUploadRouter(options: CreateChatSessionUploadRouterOptions): Router {
  const router = Router();
  const imageUploads = new ChatSessionImageUploadService(options);
  const controller = new ChatSessionUploadsRestController(imageUploads);

  router.post('/sessions/:sessionId/uploads', controller.uploadImagesMiddleware, controller.uploadImages);
  router.use(controller.handleUploadError);

  return router;
}
