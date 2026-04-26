import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createChatSession, saveChatSessions } from '../core/chat/storage.js';
import { readChatTurnReview } from '../server/features/control-plane/services/chat-sessions.js';

describe('control-plane turn review', () => {
  it('projects edit_file tool diffs as structured changed files', () => {
    const { sessionStoragePath, sessionId, turnId } = createSessionWithTrace([
      {
        type: 'tool.result',
        tool: 'edit_file',
        step: 1,
        timestamp: '2026-04-26T00:00:00.000Z',
        result: {
          ok: true,
          output: {
            path: 'README.md',
            action: 'replaced',
            diff: {
              path: 'README.md',
              action: 'replaced',
              diff: [
                '--- a/README.md',
                '+++ b/README.md',
                '@@ -1 +1 @@',
                '-old',
                '+new',
              ].join('\n'),
              truncated: false,
            },
          },
        },
      },
    ]);

    expect(readChatTurnReview(sessionStoragePath, sessionId, turnId)?.files).toEqual([
      {
        path: 'README.md',
        status: 'modified',
        source: 'edit_file',
        patch: [
          '--- a/README.md',
          '+++ b/README.md',
          '@@ -1 +1 @@',
          '-old',
          '+new',
        ].join('\n'),
        truncated: false,
      },
    ]);
  });

  it('projects full git diff command output by changed file', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/src/b.ts b/src/b.ts',
      'new file mode 100644',
      'index 0000000..3333333',
      '--- /dev/null',
      '+++ b/src/b.ts',
      '@@ -0,0 +1 @@',
      '+created',
    ].join('\n');
    const { sessionStoragePath, sessionId, turnId } = createSessionWithTrace([
      {
        type: 'tool.result',
        tool: 'run_shell_inspect',
        step: 1,
        timestamp: '2026-04-26T00:00:00.000Z',
        result: {
          ok: true,
          output: {
            command: 'git diff',
            exitCode: 0,
            stdout: patch,
            stderr: '',
          },
        },
      },
    ]);

    const review = readChatTurnReview(sessionStoragePath, sessionId, turnId);
    expect(review?.diffExcerpt).toBe(patch);
    expect(review?.files.map((file) => ({
      path: file.path,
      status: file.status,
      source: file.source,
    }))).toEqual([
      { path: 'src/a.ts', status: 'modified', source: 'git_diff' },
      { path: 'src/b.ts', status: 'added', source: 'git_diff' },
    ]);
    expect(review?.files[0]?.patch).toContain('diff --git a/src/a.ts b/src/a.ts');
    expect(review?.files[1]?.patch).toContain('new file mode 100644');
  });

  it('uses structured git diff parsing for rename metadata', () => {
    const patch = [
      'diff --git a/src/old-name.ts b/src/new-name.ts',
      'similarity index 88%',
      'rename from src/old-name.ts',
      'rename to src/new-name.ts',
      'index 1111111..2222222 100644',
      '--- a/src/old-name.ts',
      '+++ b/src/new-name.ts',
      '@@ -1 +1 @@',
      '-oldName()',
      '+newName()',
    ].join('\n');
    const { sessionStoragePath, sessionId, turnId } = createSessionWithTrace([
      {
        type: 'tool.result',
        tool: 'run_shell_inspect',
        step: 1,
        timestamp: '2026-04-26T00:00:00.000Z',
        result: {
          ok: true,
          output: {
            command: 'git diff',
            exitCode: 0,
            stdout: patch,
            stderr: '',
          },
        },
      },
    ]);

    expect(readChatTurnReview(sessionStoragePath, sessionId, turnId)?.files[0]).toMatchObject({
      path: 'src/new-name.ts',
      status: 'renamed',
      source: 'git_diff',
      patch,
    });
  });

  it('keeps git diff stat as command evidence without pretending it is a file patch', () => {
    const { sessionStoragePath, sessionId, turnId } = createSessionWithTrace([
      {
        type: 'tool.result',
        tool: 'run_shell_inspect',
        step: 1,
        timestamp: '2026-04-26T00:00:00.000Z',
        result: {
          ok: true,
          output: {
            command: 'git diff --stat',
            exitCode: 0,
            stdout: ' README.md | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)',
            stderr: '',
          },
        },
      },
    ]);

    const review = readChatTurnReview(sessionStoragePath, sessionId, turnId);
    expect(review?.diffExcerpt).toBe('README.md | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)');
    expect(review?.files).toEqual([]);
    expect(review?.reviewCommands).toHaveLength(1);
  });
});

function createSessionWithTrace(trace: unknown[]) {
  const root = mkdtempSync(join(tmpdir(), 'heddle-turn-review-'));
  const stateRoot = join(root, '.heddle');
  const sessionStoragePath = join(stateRoot, 'chat-sessions.catalog.json');
  const traceFile = join(root, 'trace.json');
  const sessionId = 'session-review';
  const turnId = 'turn-review';

  writeFileSync(traceFile, JSON.stringify(trace), 'utf8');

  const session = createChatSession({
    id: sessionId,
    name: 'Review test',
    apiKeyPresent: true,
    model: 'gpt-test',
  });
  saveChatSessions(sessionStoragePath, [{
    ...session,
    turns: [{
      id: turnId,
      prompt: 'change a file',
      outcome: 'done',
      summary: 'Changed a file.',
      steps: 1,
      traceFile,
      events: [],
    }],
  }]);

  return { sessionStoragePath, sessionId, turnId };
}
