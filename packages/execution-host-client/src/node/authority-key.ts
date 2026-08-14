import { constants } from 'node:fs';
import {
  open,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { z } from 'zod';
import type { ExecutionAuthorityKeyPair } from '../authority/index.js';

const MAX_PRIVATE_JWK_BYTES = 16 * 1_024;
const ECDSA_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const Base64UrlSchema = z.string().min(1).regex(/^[A-Za-z0-9_-]+$/);
const PrivateP256JwkSchema = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: Base64UrlSchema,
  y: Base64UrlSchema,
  d: Base64UrlSchema,
}).passthrough();

/** Generates a non-persisted ES256 pair for tests and disposable local demos. */
export async function generateEphemeralExecutionAuthorityKeyPair(): Promise<
  ExecutionAuthorityKeyPair
> {
  return webcrypto.subtle.generateKey(
    ECDSA_P256,
    false,
    ['sign', 'verify'],
  );
}

/**
 * Creates a new owner-only ES256 private-JWK file for local development.
 * Existing paths are never overwritten.
 */
export async function generateExecutionAuthorityKeyFile(
  filePath: string,
): Promise<void> {
  const keyPair = await webcrypto.subtle.generateKey(
    ECDSA_P256,
    true,
    ['sign', 'verify'],
  );
  const jwk = PrivateP256JwkSchema.parse(
    await webcrypto.subtle.exportKey('jwk', keyPair.privateKey),
  );
  const body = `${JSON.stringify({
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    d: jwk.d,
  })}\n`;

  let file: FileHandle | undefined;
  let created = false;
  try {
    file = await open(filePath, 'wx', 0o600);
    created = true;
    await file.writeFile(body, 'utf8');
    await file.sync();
    await file.close();
    file = undefined;
  } catch {
    if (created) {
      await file?.close().catch(() => undefined);
      file = undefined;
      await unlink(filePath).catch(() => undefined);
    }
    throw new ExecutionAuthorityKeyFileError(
      'Execution authority signing JWK could not be generated at the requested path.',
    );
  } finally {
    await file?.close().catch(() => undefined);
  }
}

/** Loads a non-exportable ES256 signing pair from an owner-only private JWK. */
export async function loadExecutionAuthorityKeyPairFromFile(
  filePath: string,
): Promise<ExecutionAuthorityKeyPair> {
  let file: FileHandle | undefined;
  try {
    file = await open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const metadata = await file.stat();
    if (
      !metadata.isFile()
      || metadata.size <= 0
      || metadata.size > MAX_PRIVATE_JWK_BYTES
    ) {
      throw new ExecutionAuthorityKeyFileError(
        'Execution authority signing JWK must be a small regular file.',
      );
    }
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw new ExecutionAuthorityKeyFileError(
        'Execution authority signing JWK must not be group- or world-accessible.',
      );
    }
    const jwk = PrivateP256JwkSchema.parse(
      JSON.parse(await file.readFile('utf8')) as unknown,
    );
    const privateKey = await webcrypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d },
      ECDSA_P256,
      false,
      ['sign'],
    );
    const publicKey = await webcrypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      ECDSA_P256,
      true,
      ['verify'],
    );
    await file.close();
    file = undefined;
    return { privateKey, publicKey };
  } catch (error) {
    if (error instanceof ExecutionAuthorityKeyFileError) {
      throw error;
    }
    throw new ExecutionAuthorityKeyFileError(
      'Execution authority signing JWK could not be loaded.',
    );
  } finally {
    await file?.close().catch(() => undefined);
  }
}

export class ExecutionAuthorityKeyFileError extends Error {
  readonly name = 'ExecutionAuthorityKeyFileError';
}
