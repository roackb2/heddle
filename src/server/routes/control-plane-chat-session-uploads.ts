import { Router } from 'express';
import type { HeddleServerRequestAccessService } from '@/server/access/index.js';
import { ChatSessionImageUploadService } from '@/server/services/control-plane/chat-session-image-uploads.js';
import { ChatSessionUploadsRestController } from '@/server/controllers/restful/control-plane/chat-session-uploads.js';

type CreateChatSessionUploadRouterOptions = {
  requestAccess: HeddleServerRequestAccessService;
};

export function createChatSessionUploadRouter(options: CreateChatSessionUploadRouterOptions): Router {
  const router = Router();
  const imageUploads = new ChatSessionImageUploadService(options);
  const controller = new ChatSessionUploadsRestController(imageUploads);

  router.post(
    '/sessions/:sessionId/uploads',
    controller.authorizeUpload,
    controller.uploadImagesMiddleware,
    controller.uploadImages,
  );
  router.use(controller.handleUploadError);

  return router;
}
