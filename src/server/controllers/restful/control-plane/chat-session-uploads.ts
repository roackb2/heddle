import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import {
  CHAT_SESSION_IMAGE_UPLOAD_LIMITS,
  ChatSessionImageUploadService,
  ChatSessionUploadError,
  isChatSessionUploadError,
} from '@/server/services/control-plane/chat-session-image-uploads.js';

export class ChatSessionUploadsRestController {
  readonly uploadImagesMiddleware: RequestHandler;

  constructor(private readonly imageUploads: ChatSessionImageUploadService) {
    this.uploadImagesMiddleware = this.createUploadImagesMiddleware();
  }

  uploadImages = (request: Request, response: Response): void => {
    response.json(this.imageUploads.completeUploads(request));
  };

  handleUploadError: ErrorRequestHandler = (error, _request, response, _next): void => {
    this.sendUploadError(response, error);
  };

  private createUploadImagesMiddleware(): RequestHandler {
    const upload = multer({
      storage: multer.diskStorage({
        destination: (request, _file, callback) => {
          void this.imageUploads.resolveUploadDirectory(request)
            .then((directory) => callback(null, directory))
            .catch((error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), ''));
        },
        filename: (_request, file, callback) => {
          callback(null, this.imageUploads.createStoredFilename(file));
        },
      }),
      limits: {
        fileSize: CHAT_SESSION_IMAGE_UPLOAD_LIMITS.maxFileSizeBytes,
        files: CHAT_SESSION_IMAGE_UPLOAD_LIMITS.maxFiles,
      },
      fileFilter: (_request, file, callback) => {
        if (!this.imageUploads.acceptsImageFile(file)) {
          callback(new ChatSessionUploadError(400, 'Upload supports .png, .jpg, .jpeg, .gif, and .webp images only.'));
          return;
        }

        callback(null, true);
      },
    });

    return upload.fields([
      { name: 'images', maxCount: CHAT_SESSION_IMAGE_UPLOAD_LIMITS.maxFiles },
      { name: 'files', maxCount: CHAT_SESSION_IMAGE_UPLOAD_LIMITS.maxFiles },
      { name: 'file', maxCount: CHAT_SESSION_IMAGE_UPLOAD_LIMITS.maxFiles },
    ]);
  }

  private sendUploadError(response: Response, error: unknown): void {
    if (isChatSessionUploadError(error)) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }

    if (error instanceof multer.MulterError) {
      response.status(400).json({ error: this.formatMulterError(error) });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    response.status(500).json({ error: message || 'Image upload failed.' });
  }

  private formatMulterError(error: multer.MulterError): string {
    const errorMessages: Partial<Record<multer.MulterError['code'], string>> = {
      LIMIT_FILE_SIZE: `Each image must be ${this.formatBytes(CHAT_SESSION_IMAGE_UPLOAD_LIMITS.maxFileSizeBytes)} or smaller.`,
      LIMIT_FILE_COUNT: `Upload at most ${CHAT_SESSION_IMAGE_UPLOAD_LIMITS.maxFiles} images at a time.`,
      LIMIT_UNEXPECTED_FILE: 'Unexpected image upload field.',
    };

    return errorMessages[error.code] ?? error.message;
  }

  private formatBytes(bytes: number): string {
    return `${Math.floor(bytes / (1024 * 1024))} MB`;
  }
}
