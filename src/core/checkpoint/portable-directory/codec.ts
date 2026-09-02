import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { PortableDirectoryCheckpointCorruptionError } from './errors.js';
import {
  PortableDirectoryCheckpointFileSchema,
  type PortableDirectoryCheckpointFile,
} from './schemas.js';

const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:/u;

/** Owns the shared file envelope and path-independent integrity checks. */
export class PortableDirectoryCheckpointCodec {
  static isSafeRelativePath(path: string): boolean {
    const segments = path.split('/');
    return Boolean(path)
      && !path.includes('\\')
      && !path.includes('\0')
      && !posix.isAbsolute(path)
      && !win32.isAbsolute(path)
      && !WINDOWS_DRIVE_PREFIX.test(path)
      && posix.normalize(path) === path
      && segments.every(segment => Boolean(segment) && segment !== '.' && segment !== '..');
  }

  static createFile(path: string, content: Buffer): PortableDirectoryCheckpointFile {
    if (!PortableDirectoryCheckpointCodec.isSafeRelativePath(path)) {
      throw new PortableDirectoryCheckpointCorruptionError(`unsafe relative file path: ${path}`);
    }

    return PortableDirectoryCheckpointFileSchema.parse({
      path,
      contentBase64: content.toString('base64'),
      byteLength: content.byteLength,
      sha256: PortableDirectoryCheckpointCodec.sha256(content),
    });
  }

  static decodeFile(value: unknown): Buffer {
    const parsed = PortableDirectoryCheckpointFileSchema.safeParse(value);
    if (!parsed.success) {
      throw new PortableDirectoryCheckpointCorruptionError(
        'file does not match the supported integrity envelope',
        { cause: parsed.error },
      );
    }

    const file = parsed.data;
    if (!PortableDirectoryCheckpointCodec.isSafeRelativePath(file.path)) {
      throw new PortableDirectoryCheckpointCorruptionError(`unsafe relative file path: ${file.path}`);
    }

    const content = Buffer.from(file.contentBase64, 'base64');
    if (content.toString('base64') !== file.contentBase64) {
      throw new PortableDirectoryCheckpointCorruptionError(`file has invalid base64 content: ${file.path}`);
    }
    if (content.byteLength !== file.byteLength) {
      throw new PortableDirectoryCheckpointCorruptionError(
        `file byte length does not match content: ${file.path}`,
      );
    }
    if (PortableDirectoryCheckpointCodec.sha256(content) !== file.sha256) {
      throw new PortableDirectoryCheckpointCorruptionError(`file checksum does not match content: ${file.path}`);
    }
    return content;
  }

  static comparePaths(left: string, right: string): number {
    return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
  }

  private static sha256(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
