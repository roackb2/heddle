import { z } from 'zod';
import { HostedHeartbeatServiceTokenSchema } from '../service-token.js';

const EnvironmentNameSchema = z.string().min(1).max(128).regex(
  /^[A-Za-z_][A-Za-z0-9_]*$/,
  'must be an environment variable name',
);

/** Removes one optional coordinator secret from the supplied environment. */
export function takeHostedHeartbeatServiceToken(
  environment: NodeJS.ProcessEnv,
  rawName: string,
): string | undefined {
  const name = EnvironmentNameSchema.parse(rawName);
  const token = environment[name];
  delete environment[name];
  return token?.trim()
    ? HostedHeartbeatServiceTokenSchema.parse(token)
    : undefined;
}
