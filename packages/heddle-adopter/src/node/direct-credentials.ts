import { z } from 'zod';
import type {
  HostedConversationModelCredentialProvider,
} from '../conversation/index.js';

const LocalTokenSchema = z.string().trim().min(32).max(4_096);
const ModelApiKeySchema = z.string().trim().min(8).max(4_096);
const EnvironmentNameSchema = z.string().min(1).max(128).regex(
  /^[A-Za-z_][A-Za-z0-9_]*$/,
  'must be an environment variable name',
);

export type DirectExecutionHostCredentialEnvironmentNames = {
  localToken: string;
  modelApiKey: string;
};

/**
 * Non-enumerable direct-host and model credentials for a local/reviewed
 * deployment. Production secret retrieval may construct the same class.
 */
export class DirectExecutionHostCredentials
implements HostedConversationModelCredentialProvider {
  readonly #localToken: string;
  readonly #modelApiKey: string;

  constructor(input: { localToken: string; modelApiKey: string }) {
    try {
      this.#localToken = LocalTokenSchema.parse(input.localToken);
      this.#modelApiKey = ModelApiKeySchema.parse(input.modelApiKey);
    } catch {
      throw new Error('Direct Execution Host credentials are invalid.');
    }
  }

  /** Takes configured values out of the process environment before parsing. */
  static takeFromEnvironment(
    environment: NodeJS.ProcessEnv,
    rawNames: DirectExecutionHostCredentialEnvironmentNames,
  ): DirectExecutionHostCredentials {
    const names = z.object({
      localToken: EnvironmentNameSchema,
      modelApiKey: EnvironmentNameSchema,
    }).strict().refine((value) => value.localToken !== value.modelApiKey, {
      message: 'credential environment names must be distinct',
    }).parse(rawNames);
    const input = {
      localToken: environment[names.localToken],
      modelApiKey: environment[names.modelApiKey],
    };
    delete environment[names.localToken];
    delete environment[names.modelApiKey];
    return new DirectExecutionHostCredentials({
      localToken: input.localToken ?? '',
      modelApiKey: input.modelApiKey ?? '',
    });
  }

  localToken(): string {
    return this.#localToken;
  }

  async resolveModelApiKey(): Promise<string> {
    return this.#modelApiKey;
  }
}
