import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPENAI_MODEL } from '@/core/config.js';
import {
  createConversationEngine,
  resolveQuickstartConversationCliDefaults,
  runQuickstartConversationCli,
} from '@/core/chat/engine/index.js';
import { FileChatArchiveRepository } from '@/core/chat/engine/sessions/archives/index.js';
import { FileChatSessionRepository } from '@/core/chat/engine/sessions/repository/index.js';

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

describe('runQuickstartConversationCli', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches caller-owned local commands inside the default loop', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-quickstart-cli-command-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const input = new PassThrough();
    const output = new CaptureOutput();

    const run = runQuickstartConversationCli({
      input,
      localCommands: [{
        command: '/artifacts',
        description: 'print test artifact state',
        run({ output: commandOutput, session }) {
          commandOutput.write(`custom artifacts for ${session.id}\n`);
        },
      }],
      credentialPreflight: false,
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

  it('runs an explicit scripted prompt list without a readline loop and stops at /exit', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-quickstart-cli-scripted-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const output = new CaptureOutput();

    await runQuickstartConversationCli({
      prompts: ['/mark first', '/exit', '/mark second'],
      localCommands: [{
        command: '/mark',
        description: 'echo a marker',
        run({ command, output: commandOutput }) {
          commandOutput.write(`MARK ${command}\n`);
        },
      }],
      credentialPreflight: false,
      model: 'gpt-test',
      output,
      stateRoot,
      workspaceRoot,
    });

    const text = output.text();
    expect(text).toContain('heddle> /mark first');
    expect(text).toContain('MARK /mark first');
    expect(text).not.toContain('MARK /mark second');
  });

  it('resolves generic SDK defaults for minimal interactive hosts', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-quickstart-cli-defaults-'));
    const defaults = resolveQuickstartConversationCliDefaults({
      env: {},
      reasoningEffort: 'medium',
      workspaceRoot,
    });

    expect(defaults).toEqual({
      memoryMaintenanceMode: 'none',
      model: DEFAULT_OPENAI_MODEL,
      reasoningEffort: 'medium',
      stateRoot: join(workspaceRoot, '.heddle'),
      workspaceRoot,
    });
  });

  it('prefers explicit model overrides before environment fallbacks', () => {
    expect(resolveQuickstartConversationCliDefaults({
      env: {
        ANTHROPIC_MODEL: 'claude-from-env',
        HEDDLE_EXAMPLE_MODEL: 'gpt-example-env',
        HEDDLE_MODEL: 'gpt-heddle-env',
        OPENAI_MODEL: 'gpt-openai-env',
      },
      model: 'gpt-explicit',
    }).model).toBe('gpt-explicit');

    expect(resolveQuickstartConversationCliDefaults({
      env: {
        ANTHROPIC_MODEL: 'claude-from-env',
        HEDDLE_EXAMPLE_MODEL: 'gpt-example-env',
        HEDDLE_MODEL: 'gpt-heddle-env',
        OPENAI_MODEL: 'gpt-openai-env',
      },
    }).model).toBe('gpt-heddle-env');
  });

  it('rejects unsupported reasoning effort overrides early', () => {
    expect(() => resolveQuickstartConversationCliDefaults({
      env: {},
      reasoningEffort: 'extreme',
    })).toThrow('Unsupported reasoning effort: extreme. Use one of low, medium, high, ultrahigh.');
  });

  it('can resume an existing session without owning the caller loop', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-quickstart-cli-resume-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const engine = createConversationEngine({
      model: 'gpt-test',
      stateRoot,
      workspaceRoot,
    });
    const session = await engine.sessions.create({ name: 'Existing SDK chat' });
    const input = new PassThrough();
    const output = new CaptureOutput();

    const run = runQuickstartConversationCli({
      input,
      credentialPreflight: false,
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

  it('passes a complete conversation persistence capability into the quickstart engine', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-quickstart-cli-persistence-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const hostedStateRoot = join(workspaceRoot, 'hosted');
    const sessions = new FileChatSessionRepository({
      sessionStoragePath: join(hostedStateRoot, 'sessions.catalog.json'),
    });
    const archives = new FileChatArchiveRepository({ stateRoot: hostedStateRoot });

    await runQuickstartConversationCli({
      prompts: ['/exit'],
      credentialPreflight: false,
      model: 'gpt-test',
      output: new CaptureOutput(),
      persistence: {
        conversations: { sessions, archives },
      },
      stateRoot,
      workspaceRoot,
    });

    await expect(sessions.list({ limit: 10 })).resolves.toEqual(expect.objectContaining({
      items: [expect.objectContaining({ name: 'Heddle SDK interactive chat' })],
    }));
  });

  it('prints a generic credential status before entering the loop', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-quickstart-cli-credential-status-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const input = new PassThrough();
    const output = new CaptureOutput();

    const run = runQuickstartConversationCli({
      input,
      model: 'ollama/test-model',
      output,
      stateRoot,
      workspaceRoot,
    });
    setImmediate(() => {
      input.write('/exit\n');
      input.end();
    });
    await run;

    expect(output.text()).toContain('Model: ollama/test-model (ollama)');
    expect(output.text()).toContain('Credential: ollama local endpoint');
  });

  it('fails early with the standard missing credential message and caller hint', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('PERSONAL_OPENAI_API_KEY', '');

    const workspaceRoot = mkdtempSync(join(tmpdir(), 'heddle-quickstart-cli-missing-credential-'));
    const stateRoot = join(workspaceRoot, '.heddle');
    const credentialStorePath = join(stateRoot, 'auth.json');

    await expect(runQuickstartConversationCli({
      credentialPreflight: {
        missingCredentialHint: 'Run the host-specific auth setup before starting this chat.',
      },
      credentialStorePath,
      input: new PassThrough(),
      model: 'gpt-5.4',
      output: new CaptureOutput(),
      stateRoot,
      workspaceRoot,
    })).rejects.toThrow(
      'Missing OpenAI credential. Run `heddle auth login openai` to use OpenAI account sign-in, or set OPENAI_API_KEY for Platform API-key mode. Run the host-specific auth setup before starting this chat.',
    );
  });
});
