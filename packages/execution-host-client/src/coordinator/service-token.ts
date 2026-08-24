import { z } from 'zod';

export const HostedHeartbeatServiceTokenSchema = z
  .string()
  .trim()
  .min(32)
  .max(4_096);
