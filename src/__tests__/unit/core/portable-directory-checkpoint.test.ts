import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PortableDirectoryCheckpointCodec,
  PortableDirectoryCheckpointCorruptionError,
  PortableDirectoryCheckpointPolicy,
  PortableDirectoryCheckpointPolicyError,
  PortableDirectoryCheckpointRestoreTargetError,
  PortableDirectoryCheckpointService,
  type PortableDirectoryCheckpointFile,
  type PortableDirectoryCheckpointLimits,
} from '@/core/checkpoint/portable-directory/index.js';

const GENEROUS_LIMITS: PortableDirectoryCheckpointLimits = {
  maxFileCount: 20,
  maxFileBytes: 1024,
  maxTotalBytes: 4096,
};

describe('PortableDirectoryCheckpointService', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
  });

  it('round-trips selected binary files in canonical path order', async () => {
    const directoryRoot = await createDirectoryRoot();
    await mkdir(join(directoryRoot, 'a'), { recursive: true });
    await mkdir(join(directoryRoot, 'excluded'), { recursive: true });
    await writeFile(join(directoryRoot, 'a.md'), Buffer.from('top-level'));
    await writeFile(join(directoryRoot, 'a', 'binary.dat'), Buffer.from([0x00, 0xff, 0x10]));
    await writeFile(join(directoryRoot, 'z.txt'), Buffer.from('last'));
    await writeFile(join(directoryRoot, 'excluded', 'secret.txt'), Buffer.from('not portable'));
    const service = createService(directoryRoot, {
      includeFile: path => !path.startsWith('excluded/'),
    });

    const files = await service.capture();

    expect(files.map(file => file.path)).toEqual(['a.md', 'a/binary.dat', 'z.txt']);
    await rm(directoryRoot, { recursive: true });
    await expect(service.restore(files)).resolves.toBe(directoryRoot);
    await expect(readFile(join(directoryRoot, 'a', 'binary.dat')))
      .resolves.toEqual(Buffer.from([0x00, 0xff, 0x10]));
    await expect(lstat(join(directoryRoot, 'excluded'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recognizes canonical relative paths across POSIX and Windows syntax', () => {
    expect(PortableDirectoryCheckpointCodec.isSafeRelativePath('notes/current.md')).toBe(true);
    expect([
      '',
      '.',
      '../escape.txt',
      'notes/../escape.txt',
      '/absolute.txt',
      'C:/absolute.txt',
      'C:drive-relative.txt',
      'notes\\windows.txt',
      'notes//duplicate-separator.txt',
    ].map(path => PortableDirectoryCheckpointCodec.isSafeRelativePath(path)))
      .toEqual([false, false, false, false, false, false, false, false, false]);
  });

  it.runIf(process.platform !== 'win32')('rejects unsafe relative names and symbolic links during capture', async () => {
    const unsafeRoot = await createDirectoryRoot();
    await writeFile(join(unsafeRoot, 'unsafe\\name.txt'), 'unsafe');
    await expect(createService(unsafeRoot).capture()).rejects.toMatchObject({
      code: 'PORTABLE_DIRECTORY_CHECKPOINT_CAPTURE_ERROR',
      detail: expect.stringContaining('unsafe relative file path'),
    });

    const symlinkRoot = await createDirectoryRoot();
    await writeFile(join(symlinkRoot, 'source.txt'), 'source');
    await symlink(join(symlinkRoot, 'source.txt'), join(symlinkRoot, 'link.txt'));
    await expect(createService(symlinkRoot).capture()).rejects.toMatchObject({
      code: 'PORTABLE_DIRECTORY_CHECKPOINT_CAPTURE_ERROR',
      detail: expect.stringContaining('symbolic links'),
    });
  });

  it.each([
    {
      name: 'file count',
      limits: { maxFileCount: 1, maxFileBytes: 10, maxTotalBytes: 20 },
      files: [['one.txt', '1'], ['two.txt', '2']],
      detail: 'file count 2 exceeds limit 1',
    },
    {
      name: 'per-file bytes',
      limits: { maxFileCount: 2, maxFileBytes: 2, maxTotalBytes: 20 },
      files: [['large.txt', '123']],
      detail: 'file large.txt has 3 bytes, exceeding limit 2',
    },
    {
      name: 'total bytes',
      limits: { maxFileCount: 2, maxFileBytes: 4, maxTotalBytes: 5 },
      files: [['one.txt', '123'], ['two.txt', '456']],
      detail: 'total bytes 6 exceed limit 5',
    },
  ])('fails closed when capture exceeds the $name limit', async ({ limits, files, detail }) => {
    const directoryRoot = await createDirectoryRoot();
    await Promise.all(files.map(([path, content]) => writeFile(join(directoryRoot, path), content)));

    await expect(createService(directoryRoot, { limits }).capture()).rejects.toMatchObject({
      code: 'PORTABLE_DIRECTORY_CHECKPOINT_CAPTURE_ERROR',
      detail,
    });
  });

  it.each([
    {
      name: 'file count',
      limits: { maxFileCount: 1, maxFileBytes: 10, maxTotalBytes: 20 },
      files: [createFile('one.txt', '1'), createFile('two.txt', '2')],
      detail: 'file count 2 exceeds limit 1',
    },
    {
      name: 'per-file bytes',
      limits: { maxFileCount: 2, maxFileBytes: 2, maxTotalBytes: 20 },
      files: [createFile('large.txt', '123')],
      detail: 'file large.txt has 3 bytes, exceeding limit 2',
    },
    {
      name: 'total bytes',
      limits: { maxFileCount: 2, maxFileBytes: 4, maxTotalBytes: 5 },
      files: [createFile('one.txt', '123'), createFile('two.txt', '456')],
      detail: 'total bytes 6 exceed limit 5',
    },
  ])('fails closed when restore exceeds the $name limit', async ({ limits, files, detail }) => {
    const directoryRoot = await createAbsentDirectoryRoot();

    await expect(createService(directoryRoot, { limits }).restore(files)).rejects.toMatchObject({
      code: 'PORTABLE_DIRECTORY_CHECKPOINT_CORRUPTION',
      detail,
    });
    await expect(lstat(directoryRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('validates integrity, policy, and path conflicts before creating the target', async () => {
    const corruptRoot = await createAbsentDirectoryRoot();
    const valid = createFile('valid.txt', 'valid');
    await expect(createService(corruptRoot).restore([
      { ...valid, contentBase64: Buffer.from('corrupt').toString('base64') },
    ])).rejects.toBeInstanceOf(PortableDirectoryCheckpointCorruptionError);
    await expect(lstat(corruptRoot)).rejects.toMatchObject({ code: 'ENOENT' });

    const unsafeRoot = await createAbsentDirectoryRoot();
    await expect(createService(unsafeRoot).restore([{ ...valid, path: '../escape.txt' }]))
      .rejects.toBeInstanceOf(PortableDirectoryCheckpointCorruptionError);
    await expect(lstat(unsafeRoot)).rejects.toMatchObject({ code: 'ENOENT' });

    const conflictRoot = await createAbsentDirectoryRoot();
    await expect(createService(conflictRoot).restore([
      createFile('entry', 'file'),
      createFile('entry/child.txt', 'child'),
    ])).rejects.toMatchObject({
      code: 'PORTABLE_DIRECTORY_CHECKPOINT_CORRUPTION',
      detail: 'file path conflicts with descendant: entry',
    });
    await expect(lstat(conflictRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restores through an empty target but does not merge with a populated target', async () => {
    const emptyRoot = await createDirectoryRoot();
    await expect(createService(emptyRoot).restore([createFile('restored.txt', 'restored')]))
      .resolves.toBe(emptyRoot);
    await expect(readFile(join(emptyRoot, 'restored.txt'), 'utf8')).resolves.toBe('restored');

    const populatedRoot = await createDirectoryRoot();
    await writeFile(join(populatedRoot, 'existing.txt'), 'keep');

    await expect(createService(populatedRoot).restore([createFile('next.txt', 'next')]))
      .rejects.toBeInstanceOf(PortableDirectoryCheckpointRestoreTargetError);
    await expect(readFile(join(populatedRoot, 'existing.txt'), 'utf8')).resolves.toBe('keep');
  });

  it('requires every policy limit to be an explicit non-negative safe integer', () => {
    expect(() => new PortableDirectoryCheckpointPolicy({
      includeFile: () => true,
      limits: { maxFileCount: Number.POSITIVE_INFINITY, maxFileBytes: 1, maxTotalBytes: 1 },
    })).toThrow(PortableDirectoryCheckpointPolicyError);
  });

  async function createDirectoryRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'heddle-portable-directory-'));
    temporaryRoots.push(root);
    return root;
  }

  async function createAbsentDirectoryRoot(): Promise<string> {
    const parent = await createDirectoryRoot();
    return join(parent, 'restored');
  }
});

function createService(
  directoryRoot: string,
  options: {
    limits?: PortableDirectoryCheckpointLimits;
    includeFile?: (path: string) => boolean;
  } = {},
): PortableDirectoryCheckpointService {
  return new PortableDirectoryCheckpointService(
    directoryRoot,
    new PortableDirectoryCheckpointPolicy({
      limits: options.limits ?? GENEROUS_LIMITS,
      includeFile: options.includeFile ?? (() => true),
    }),
  );
}

function createFile(path: string, content: string): PortableDirectoryCheckpointFile {
  return PortableDirectoryCheckpointCodec.createFile(path, Buffer.from(content));
}
