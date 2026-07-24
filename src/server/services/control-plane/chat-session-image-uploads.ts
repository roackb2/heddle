import { Buffer } from 'node:buffer';
import { mkdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { HeddleServerRequestAccessService } from '@/server/access/index.js';
import type { WorkspaceDescriptor } from '@/core/runtime/workspaces/index.js';
import { controlPlaneChatSessionsController } from '@/server/controllers/trpc/control-plane/chat-sessions-controller.js';
import { getWorkspaceOperationLogger } from '@/server/logging/workspace-operation-logger.js';

export const CHAT_SESSION_IMAGE_UPLOAD_LIMITS = {
  maxFiles: 10,
  maxFileSizeBytes: 10 * 1024 * 1024,
} as const;

export type ChatSessionImageUpload = {
  id: string;
  path: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
};

export type ChatSessionImageUploadResult = {
  uploads: ChatSessionImageUpload[];
};

type ChatSessionImageUploadServiceOptions = {
  requestAccess: HeddleServerRequestAccessService;
};

const SUPPORTED_IMAGE_TYPES = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
} as const;

/**
 * Owns browser-uploaded session image storage for the local control plane.
 *
 * Images are persisted under the selected workspace state root so the runtime can
 * later inspect them through the existing filesystem-backed view_image tool.
 */
export class ChatSessionImageUploadService {
  constructor(private readonly options: ChatSessionImageUploadServiceOptions) {}

  async authorizeUpload(request: Request): Promise<void> {
    const sessionId = this.readSessionId(request);
    const workspace = this.resolveWorkspace(request);
    await this.options.requestAccess.authorizeOperation(request, {
      name: 'sessionImageUpload',
      type: 'mutation',
      workspaceId: workspace.id,
      sessionId,
    });
  }

  resolveWorkspace(request: Request): WorkspaceDescriptor {
    const workspaceId = this.readWorkspaceId(request);
    return this.options.requestAccess.resolveWorkspace(request, workspaceId);
  }

  async resolveUploadDirectory(request: Request): Promise<string> {
    const sessionId = this.readSessionId(request);
    const workspace = this.resolveWorkspace(request);
    await this.requireSession(workspace, sessionId);
    const uploadDirectory = join(workspace.stateRoot, 'uploads', 'sessions', sessionId);
    await mkdir(uploadDirectory, { recursive: true });
    return uploadDirectory;
  }

  createStoredFilename(file: Pick<Express.Multer.File, 'mimetype' | 'originalname'>): string {
    return `${randomUUID()}${this.resolveSupportedExtension(file)}`;
  }

  acceptsImageFile(file: Pick<Express.Multer.File, 'mimetype' | 'originalname'>): boolean {
    return Boolean(this.resolveSupportedExtension(file));
  }

  async completeUploads(request: Request): Promise<ChatSessionImageUploadResult> {
    const sessionId = this.readSessionId(request);
    const workspace = this.resolveWorkspace(request);
    await this.requireSession(workspace, sessionId);

    const files = this.readUploadedFiles(request.files);
    if (!files.length) {
      throw new ChatSessionUploadError(400, 'Upload at least one image file.');
    }

    if (files.length > CHAT_SESSION_IMAGE_UPLOAD_LIMITS.maxFiles) {
      throw new ChatSessionUploadError(400, `Upload at most ${CHAT_SESSION_IMAGE_UPLOAD_LIMITS.maxFiles} images at a time.`);
    }

    const uploadRoot = resolve(workspace.stateRoot, 'uploads', 'sessions', sessionId);
    const uploads = files.map((file) => this.projectUploadedFile(uploadRoot, file));
    getWorkspaceOperationLogger(workspace.stateRoot).info({
      sessionId,
      uploadCount: uploads.length,
      workspaceId: workspace.id,
      workspaceRoot: workspace.workspaceRoot,
      stateRoot: workspace.stateRoot,
    }, 'Control-plane session images uploaded');

    return {
      uploads,
    };
  }

  private async requireSession(workspace: WorkspaceDescriptor, sessionId: string): Promise<void> {
    const session = await controlPlaneChatSessionsController.readDetail({
      workspaceRoot: workspace.workspaceRoot,
      stateRoot: workspace.stateRoot,
      sessionStoragePath: resolve(workspace.stateRoot, 'chat-sessions.catalog.json'),
      workspaceId: workspace.id,
    }, sessionId);
    if (!session) {
      throw new ChatSessionUploadError(404, `Chat session not found: ${sessionId}`);
    }
  }

  private projectUploadedFile(uploadRoot: string, file: Express.Multer.File): ChatSessionImageUpload {
    const resolvedPath = resolve(file.path);
    if (!resolvedPath.startsWith(`${uploadRoot}/`)) {
      throw new ChatSessionUploadError(400, 'Uploaded file was stored outside the session upload directory.');
    }

    return {
      id: basename(file.filename, extname(file.filename)),
      path: resolvedPath,
      originalName: this.decodeOriginalFilename(file.originalname),
      mediaType: file.mimetype,
      sizeBytes: file.size,
    };
  }

  private readUploadedFiles(files: Request['files']): Express.Multer.File[] {
    if (Array.isArray(files)) {
      return files;
    }

    if (!files || typeof files !== 'object') {
      return [];
    }

    return Object.values(files).flat();
  }

  private resolveSupportedExtension(file: Pick<Express.Multer.File, 'mimetype' | 'originalname'>): keyof typeof SUPPORTED_IMAGE_TYPES | undefined {
    const extension = extname(file.originalname).toLowerCase() as keyof typeof SUPPORTED_IMAGE_TYPES;
    const expectedMediaType = SUPPORTED_IMAGE_TYPES[extension];
    if (!expectedMediaType) {
      return undefined;
    }

    return !file.mimetype || file.mimetype === expectedMediaType ? extension : undefined;
  }

  private readSessionId(request: Request): string {
    const sessionId = typeof request.params.sessionId === 'string' ? request.params.sessionId.trim() : '';
    if (!sessionId) {
      throw new ChatSessionUploadError(400, 'Missing sessionId.');
    }

    return sessionId;
  }

  private readWorkspaceId(request: Request): string | undefined {
    const rawWorkspaceId = request.query.workspaceId;
    const workspaceId = typeof rawWorkspaceId === 'string' ? rawWorkspaceId.trim() : '';
    return workspaceId || undefined;
  }

  private decodeOriginalFilename(originalName: string): string {
    if (!looksLikeMojibake(originalName)) {
      return originalName;
    }

    const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? originalName : decoded;
  }
}

function looksLikeMojibake(value: string): boolean {
  return /[ÃÂâÆæÅå]/.test(value);
}

export class ChatSessionUploadError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ChatSessionUploadError';
  }
}

export function isChatSessionUploadError(error: unknown): error is ChatSessionUploadError {
  return error instanceof ChatSessionUploadError;
}
