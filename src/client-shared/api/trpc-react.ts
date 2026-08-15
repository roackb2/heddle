import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@heddleagent/runtime/cli';

export const trpcReact = createTRPCReact<AppRouter>();
