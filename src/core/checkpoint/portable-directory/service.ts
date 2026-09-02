import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  type FileHandle,
} from 'node:fs/promises';
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path';
import { PortableDirectoryCheckpointCodec } from './codec.js';
import {
  PortableDirectoryCheckpointCaptureError,
  PortableDirectoryCheckpointCorruptionError,
  PortableDirectoryCheckpointRestoreTargetError,
} from './errors.js';
import { PortableDirectoryCheckpointPolicy } from './policy.js';
import type { PortableDirectoryCheckpointFile } from './schemas.js';

const READ_CHUNK_BYTES = 64 * 1024;

type CaptureState = {
  files: PortableDirectoryCheckpointFile[];
  totalBytes: number;
};

type PreparedFile = {
  path: string;
  content: Buffer;
};

type RestoreTargetState =
  | { kind: 'absent' }
  | { kind: 'empty-directory'; device: number; inode: number };

/**
 * Owns bounded, symlink-free capture and staged restore for one selected local
 * directory. Domain generations, manifests, scopes, stores, and lifecycle
 * timing remain the responsibility of the specialization using this service.
 */
export class PortableDirectoryCheckpointService {
  private readonly directoryRoot: string;

  constructor(
    directoryRoot: string,
    private readonly policy: PortableDirectoryCheckpointPolicy,
  ) {
    this.directoryRoot = resolve(directoryRoot);
  }

  /** Captures selected regular files in canonical bytewise path order. */
  async capture(): Promise<PortableDirectoryCheckpointFile[]> {
    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(this.directoryRoot);
    } catch (error) {
      throw new PortableDirectoryCheckpointCaptureError(
        this.directoryRoot,
        'directory root does not exist',
        { cause: error },
      );
    }

    let root: Awaited<ReturnType<typeof lstat>>;
    try {
      root = await lstat(canonicalRoot);
    } catch (error) {
      throw new PortableDirectoryCheckpointCaptureError(
        this.directoryRoot,
        'directory root could not be inspected safely',
        { cause: error },
      );
    }
    if (!root.isDirectory()) {
      throw new PortableDirectoryCheckpointCaptureError(this.directoryRoot, 'directory root is not a directory');
    }

    const state: CaptureState = { files: [], totalBytes: 0 };
    try {
      await this.walk(canonicalRoot, canonicalRoot, state);
      return state.files.sort((left, right) => PortableDirectoryCheckpointCodec.comparePaths(
        left.path,
        right.path,
      ));
    } catch (error) {
      if (error instanceof PortableDirectoryCheckpointCaptureError) {
        throw error;
      }
      throw new PortableDirectoryCheckpointCaptureError(
        this.directoryRoot,
        PortableDirectoryCheckpointService.errorMessage(error),
        { cause: error },
      );
    }
  }

  /** Validates every file before atomically presenting a staged working copy. */
  async restore(files: readonly PortableDirectoryCheckpointFile[]): Promise<string> {
    const preparedFiles = this.prepareFiles(files);
    const targetState = await this.inspectRestoreTarget();
    const parent = dirname(this.directoryRoot);
    await mkdir(parent, { recursive: true });
    const stagingRoot = await mkdtemp(join(parent, `.${basename(this.directoryRoot)}.restore-`));

    try {
      for (const file of preparedFiles) {
        const targetPath = resolve(stagingRoot, ...file.path.split('/'));
        await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
        const handle = await open(targetPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
        try {
          await handle.writeFile(file.content);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }

      await this.commitStagedRestore(targetState, stagingRoot);
      return this.directoryRoot;
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }

  private async walk(root: string, directory: string, state: CaptureState): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => PortableDirectoryCheckpointCodec.comparePaths(left.name, right.name));

    for (const entry of entries) {
      const path = join(directory, entry.name);
      const portablePath = relative(root, path).split(sep).join('/');

      if (entry.isSymbolicLink()) {
        throw new PortableDirectoryCheckpointCaptureError(
          this.directoryRoot,
          `symbolic links are not portable directory state: ${portablePath}`,
        );
      }
      const safePath = PortableDirectoryCheckpointCodec.isSafeRelativePath(portablePath);
      if (entry.isDirectory()) {
        if (!safePath && this.policy.unsafePathBehavior === 'reject') {
          throw new PortableDirectoryCheckpointCaptureError(
            this.directoryRoot,
            `unsafe relative file path: ${portablePath}`,
          );
        }
        await this.walk(root, path, state);
        continue;
      }
      if (!safePath) {
        if (this.policy.unsafePathBehavior === 'exclude') {
          continue;
        }
        throw new PortableDirectoryCheckpointCaptureError(
          this.directoryRoot,
          `unsafe relative file path: ${portablePath}`,
        );
      }
      if (!this.policy.includes(portablePath)) {
        continue;
      }
      if (!entry.isFile()) {
        throw new PortableDirectoryCheckpointCaptureError(
          this.directoryRoot,
          `selected path is not a regular file: ${portablePath}`,
        );
      }

      this.assertCaptureFileCount(state.files.length + 1);
      const content = await this.readBoundedFile(path, portablePath, state.totalBytes);
      state.files.push(PortableDirectoryCheckpointCodec.createFile(portablePath, content));
      state.totalBytes += content.byteLength;
    }
  }

  private async readBoundedFile(
    path: string,
    portablePath: string,
    capturedBytes: number,
  ): Promise<Buffer> {
    let pathIdentity: Awaited<ReturnType<typeof lstat>>;
    try {
      pathIdentity = await lstat(path);
    } catch (error) {
      throw new PortableDirectoryCheckpointCaptureError(
        this.directoryRoot,
        `selected file could not be inspected safely: ${portablePath}`,
        { cause: error },
      );
    }
    if (!pathIdentity.isFile() || pathIdentity.isSymbolicLink()) {
      throw new PortableDirectoryCheckpointCaptureError(
        this.directoryRoot,
        pathIdentity.isSymbolicLink()
          ? `symbolic links are not portable directory state: ${portablePath}`
          : `selected path is not a regular file: ${portablePath}`,
      );
    }

    let handle: FileHandle;
    try {
      // O_NOFOLLOW is unavailable on Windows. The lstat/fstat identity check
      // below is the portable fallback and also closes leaf replacement races
      // on platforms that do support the flag.
      handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      const detail = PortableDirectoryCheckpointService.isErrorWithCode(error, 'ELOOP')
        ? `symbolic links are not portable directory state: ${portablePath}`
        : `selected file could not be opened safely: ${portablePath}`;
      throw new PortableDirectoryCheckpointCaptureError(this.directoryRoot, detail, { cause: error });
    }

    try {
      const file = await handle.stat();
      if (!file.isFile() || file.dev !== pathIdentity.dev || file.ino !== pathIdentity.ino) {
        throw new PortableDirectoryCheckpointCaptureError(
          this.directoryRoot,
          `selected file changed identity during capture: ${portablePath}`,
        );
      }
      this.assertCaptureBytes(portablePath, file.size, capturedBytes);

      const chunks: Buffer[] = [];
      let byteLength = 0;
      let position = 0;
      while (true) {
        const remaining = Math.min(
          this.policy.limits.maxFileBytes - byteLength,
          this.policy.limits.maxTotalBytes - capturedBytes - byteLength,
        );
        const readLength = remaining >= READ_CHUNK_BYTES ? READ_CHUNK_BYTES : remaining + 1;
        const chunk = Buffer.allocUnsafe(Math.max(1, readLength));
        const result = await handle.read(chunk, 0, chunk.byteLength, position);
        if (result.bytesRead === 0) {
          break;
        }

        byteLength += result.bytesRead;
        this.assertCaptureBytes(portablePath, byteLength, capturedBytes);
        chunks.push(Buffer.from(chunk.subarray(0, result.bytesRead)));
        position += result.bytesRead;
      }
      return Buffer.concat(chunks, byteLength);
    } finally {
      await handle.close();
    }
  }

  private prepareFiles(files: readonly PortableDirectoryCheckpointFile[]): PreparedFile[] {
    if (files.length > this.policy.limits.maxFileCount) {
      throw new PortableDirectoryCheckpointCorruptionError(
        `file count ${files.length} exceeds limit ${this.policy.limits.maxFileCount}`,
      );
    }

    const paths = new Set<string>();
    let totalBytes = 0;
    const prepared = files.map(file => {
      const content = PortableDirectoryCheckpointCodec.decodeFile(file);
      if (!this.policy.includes(file.path)) {
        throw new PortableDirectoryCheckpointCorruptionError(`file is excluded by policy: ${file.path}`);
      }
      if (paths.has(file.path)) {
        throw new PortableDirectoryCheckpointCorruptionError(`duplicate file path: ${file.path}`);
      }
      if (content.byteLength > this.policy.limits.maxFileBytes) {
        throw new PortableDirectoryCheckpointCorruptionError(
          `file ${file.path} has ${content.byteLength} bytes, exceeding limit ${this.policy.limits.maxFileBytes}`,
        );
      }

      const nextTotal = totalBytes + content.byteLength;
      if (!Number.isSafeInteger(nextTotal) || nextTotal > this.policy.limits.maxTotalBytes) {
        throw new PortableDirectoryCheckpointCorruptionError(
          `total bytes ${nextTotal} exceed limit ${this.policy.limits.maxTotalBytes}`,
        );
      }

      paths.add(file.path);
      totalBytes = nextTotal;
      return { path: file.path, content };
    });

    for (const path of paths) {
      let ancestor = posix.dirname(path);
      while (ancestor !== '.') {
        if (paths.has(ancestor)) {
          throw new PortableDirectoryCheckpointCorruptionError(
            `file path conflicts with descendant: ${ancestor}`,
          );
        }
        ancestor = posix.dirname(ancestor);
      }
    }

    return prepared.sort((left, right) => PortableDirectoryCheckpointCodec.comparePaths(left.path, right.path));
  }

  private async inspectRestoreTarget(): Promise<RestoreTargetState> {
    try {
      const target = await lstat(this.directoryRoot);
      if (!target.isDirectory() || target.isSymbolicLink() || (await readdir(this.directoryRoot)).length > 0) {
        throw new PortableDirectoryCheckpointRestoreTargetError(this.directoryRoot);
      }
      return { kind: 'empty-directory', device: target.dev, inode: target.ino };
    } catch (error) {
      if (PortableDirectoryCheckpointService.isErrorWithCode(error, 'ENOENT')) {
        return { kind: 'absent' };
      }
      throw error;
    }
  }

  private async commitStagedRestore(state: RestoreTargetState, stagingRoot: string): Promise<void> {
    if (state.kind === 'absent') {
      try {
        await lstat(this.directoryRoot);
        throw new PortableDirectoryCheckpointRestoreTargetError(this.directoryRoot);
      } catch (error) {
        if (!PortableDirectoryCheckpointService.isErrorWithCode(error, 'ENOENT')) {
          throw error;
        }
      }
    } else {
      const target = await lstat(this.directoryRoot);
      const targetChanged = !target.isDirectory()
        || target.isSymbolicLink()
        || target.dev !== state.device
        || target.ino !== state.inode
        || (await readdir(this.directoryRoot)).length > 0;
      if (targetChanged) {
        throw new PortableDirectoryCheckpointRestoreTargetError(this.directoryRoot);
      }
      await rmdir(this.directoryRoot);
    }

    await rename(stagingRoot, this.directoryRoot);
  }

  private assertCaptureFileCount(fileCount: number): void {
    if (fileCount > this.policy.limits.maxFileCount) {
      throw new PortableDirectoryCheckpointCaptureError(
        this.directoryRoot,
        `file count ${fileCount} exceeds limit ${this.policy.limits.maxFileCount}`,
      );
    }
  }

  private assertCaptureBytes(path: string, fileBytes: number, capturedBytes: number): void {
    if (!Number.isSafeInteger(fileBytes) || fileBytes > this.policy.limits.maxFileBytes) {
      throw new PortableDirectoryCheckpointCaptureError(
        this.directoryRoot,
        `file ${path} has ${fileBytes} bytes, exceeding limit ${this.policy.limits.maxFileBytes}`,
      );
    }

    const totalBytes = capturedBytes + fileBytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > this.policy.limits.maxTotalBytes) {
      throw new PortableDirectoryCheckpointCaptureError(
        this.directoryRoot,
        `total bytes ${totalBytes} exceed limit ${this.policy.limits.maxTotalBytes}`,
      );
    }
  }

  private static errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private static isErrorWithCode(error: unknown, code: string): error is Error & { code: string } {
    return error instanceof Error && 'code' in error && error.code === code;
  }
}
