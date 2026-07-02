import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createConversationEngine,
  runConversationCli,
} from '@/core/chat/engine/index.js';

class CaptureOutput extends Writable {
  private readonly chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  text(): string {
    return this.chunks.join('');
  }
}

describe('runConversationCli', () => {
  it('dispatches caller-owned local commands inside the default loop', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-conversation-cli-command-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const input = new PassThrough();
    const output = new CaptureOutput();

    const run = runConversationCli({
      input,
      localCommands: [{
        command: '/artifacts',
        description: 'print test artifact state',
        run({ output: commandOutput, session }) {
          commandOutput.write(`custom artifacts for ${session.id}\n`);
        },
      }],
      model: 'gpt-test',
      output,
      stateRoot,
      workspaceRoot,
    });
    setImmediate(() => {
      input.write('/artifacts\n');
      input.write('/exit\n');
      input.end();
    });
    await run;

    expect(output.text()).toContain('Commands: /session, /help, /exit, /artifacts');
    expect(output.text()).toContain('custom artifacts for session-');
  });

  it('can resume an existing session without owning the caller loop', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-conversation-cli-resume-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      model: 'gpt-test',
      stateRoot,
      workspaceRoot,
    });
    const session = engine.sessions.create({ name: 'Existing SDK chat' });
    const input = new PassThrough();
    const output = new CaptureOutput();

    const run = runConversationCli({
      input,
      model: 'gpt-test',
      output,
      sessionId: session.id,
      stateRoot,
      workspaceRoot,
    });
    setImmediate(() => {
      input.write('/session\n');
      input.write('/exit\n');
      input.end();
    });
    await run;

    expect(output.text()).toContain(`Session: ${session.id}`);
  });
});
