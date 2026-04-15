import { initTRPC } from '@trpc/server';
import type { HeddleServerContext } from './types.js';

const t = initTRPC.context<HeddleServerContext>().create();

export const router = t.router;
export const procedure = t.procedure;
