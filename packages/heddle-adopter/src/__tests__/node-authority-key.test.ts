import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { JoseExecutionAuthority } from '../authority/index.js';
import {
  DirectExecutionHostCredentials,
  ExecutionAuthorityKeyFileError,
  generateEphemeralExecutionAuthorityKeyPair,
  generateExecutionAuthorityKeyFile,
  loadExecutionAuthorityKeyPairFromFile,
} from '../node/index.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'heddle-adopter-key-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Node execution-authority key utilities', () => {
  it('generates an owner-only file and loads a non-exportable signing key', async () => {
    const filePath = join(root, 'execution-authority.jwk');

    await generateExecutionAuthorityKeyFile(filePath);
    const metadata = await stat(filePath);
    const encoded = await readFile(filePath, 'utf8');
    const pair = await loadExecutionAuthorityKeyPairFromFile(filePath);
    const authority = await JoseExecutionAuthority.create({
      issuer: 'https://api.example.test',
      adopterId: 'example-adopter',
      executionAudience: 'urn:heddle-execution-host:example',
      keyId: 'execution-key-001',
      executionTtlSeconds: 300,
    }, pair);

    if (process.platform !== 'win32') {
      expect(metadata.mode & 0o777).toBe(0o600);
    }
    expect(JSON.parse(encoded)).toMatchObject({
      kty: 'EC',
      crv: 'P-256',
      x: expect.any(String),
      y: expect.any(String),
      d: expect.any(String),
    });
    expect(pair.privateKey.extractable).toBe(false);
    expect(authority.publicJwks().keys).toHaveLength(1);
  });

  it('never overwrites an existing path', async () => {
    const filePath = join(root, 'existing.jwk');
    await writeFile(filePath, 'keep-me', { mode: 0o600 });

    await expect(generateExecutionAuthorityKeyFile(filePath))
      .rejects.toThrow(/could not be generated/);
    await expect(readFile(filePath, 'utf8')).resolves.toBe('keep-me');
  });

  it.runIf(process.platform !== 'win32')(
    'rejects a group-readable private key',
    async () => {
      const filePath = join(root, 'broad.jwk');
      await generateExecutionAuthorityKeyFile(filePath);
      await chmod(filePath, 0o640);

      await expect(loadExecutionAuthorityKeyPairFromFile(filePath))
        .rejects.toThrow(/group- or world-accessible/);
    },
  );

  it.runIf(process.platform !== 'win32')(
    'rejects a symlink instead of following it',
    async () => {
      const target = join(root, 'target.jwk');
      const link = join(root, 'link.jwk');
      await generateExecutionAuthorityKeyFile(target);
      await symlink(target, link);

      await expect(loadExecutionAuthorityKeyPairFromFile(link))
        .rejects.toBeInstanceOf(ExecutionAuthorityKeyFileError);
    },
  );

  it('generates a disposable non-exportable pair for tests', async () => {
    const pair = await generateEphemeralExecutionAuthorityKeyPair();

    expect(pair.privateKey.type).toBe('private');
    expect(pair.privateKey.extractable).toBe(false);
    expect(pair.publicKey.type).toBe('public');
  });
});

describe('direct Execution Host credentials', () => {
  it('takes secrets out of the environment and keeps them non-enumerable', async () => {
    const environment = {
      PRODUCT_HOST_TOKEN: 'local-token-'.padEnd(32, 'x'),
      PRODUCT_MODEL_KEY: 'model-key-value',
    };

    const credentials = DirectExecutionHostCredentials.takeFromEnvironment(
      environment,
      {
        localToken: 'PRODUCT_HOST_TOKEN',
        modelApiKey: 'PRODUCT_MODEL_KEY',
      },
    );

    expect(environment).toEqual({});
    expect(credentials.localToken()).toHaveLength(32);
    await expect(credentials.resolveModelApiKey()).resolves.toBe(
      'model-key-value',
    );
    expect(Object.keys(credentials)).toEqual([]);
    expect(JSON.stringify(credentials)).toBe('{}');
  });

  it('removes present secrets even when validation fails', () => {
    const environment = {
      PRODUCT_HOST_TOKEN: 'short',
      PRODUCT_MODEL_KEY: 'model-key-value',
    };

    expect(() => DirectExecutionHostCredentials.takeFromEnvironment(
      environment,
      {
        localToken: 'PRODUCT_HOST_TOKEN',
        modelApiKey: 'PRODUCT_MODEL_KEY',
      },
    )).toThrow('credentials are invalid');
    expect(environment).toEqual({});
  });
});
