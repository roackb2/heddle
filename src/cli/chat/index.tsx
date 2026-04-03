import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { resolveChatRuntimeConfig } from './utils/runtime.js';
import type { ChatCliOptions } from './utils/runtime.js';

export type { ChatCliOptions } from './utils/runtime.js';

export function startChatCli(options: ChatCliOptions = {}) {
  const runtime = resolveChatRuntimeConfig(options);
  render(<App runtime={runtime} />);
}
