import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { resolveChatRuntimeConfig } from './utils/runtime.js';
import type { ChatCliOptions } from './utils/runtime.js';
import { createTuiFrameRecorder } from './debug/tui-frame-recorder.js';

export type { ChatCliOptions } from './utils/runtime.js';

export function startChatCli(options: ChatCliOptions = {}) {
  const runtime = resolveChatRuntimeConfig(options);
  const recorder = createTuiFrameRecorder(runtime.stateRoot);
  const stdout = Object.create(process.stdout) as NodeJS.WriteStream;
  stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    recorder.record(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return process.stdout.write(chunk as never, ...(args as []));
  }) as NodeJS.WriteStream['write'];

  render(<App runtime={{
    ...runtime,
    saveTuiSnapshot: (metadata) => recorder.saveSnapshot({
      terminalColumns: process.stdout.columns,
      terminalRows: process.stdout.rows,
      ...metadata,
    }),
  }} />, { stdout });
}
