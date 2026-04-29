import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../core/llm/types.js';
import type { LlmAdapter } from '../../core/llm/types.js';
import { estimateBuiltInContextWindow } from '../../core/llm/openai-models.js';
import { credentialModeFromSource, resolveSystemSelectedModel } from '../../core/llm/model-policy.js';
import { setStoredProviderCredential } from '../../core/auth/provider-credentials.js';
import { resolveProviderCredentialSourceForModel } from '../../core/runtime/api-keys.js';
import { compactChatHistory, compactChatHistoryWithArchive, isCompactedHistorySummary } from '../../cli/chat/state/compaction.js';
import { buildConversationMessages } from '../../cli/chat/utils/format.js';

describe('chat history compaction', () => {
  it('uses the documented context window for the default OpenAI compaction model', () => {
    expect(estimateBuiltInContextWindow('gpt-5.1-codex-mini')).toBe(400_000);
  });

  it('uses a conservative context window for GPT-5.4 chat sessions', () => {
    expect(estimateBuiltInContextWindow('gpt-5.4')).toBe(400_000);
    expect(estimateBuiltInContextWindow('gpt-5.4-pro')).toBe(400_000);
  });

  it('uses the active account-sign-in model for OpenAI OAuth compaction', () => {
    const storePath = join(mkdtempSync(join(tmpdir(), 'heddle-chat-compaction-oauth-model-')), 'auth.json');
    setStoredProviderCredential({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 60_000,
      createdAt: '2026-04-29T00:00:00.000Z',
      updatedAt: '2026-04-29T00:00:00.000Z',
    }, storePath);

    expect(resolveSystemSelectedModel({
      purpose: 'chat-compaction',
      provider: 'openai',
      activeModel: 'gpt-5.4',
      credentialMode: credentialModeFromSource(resolveProviderCredentialSourceForModel('gpt-5.4', { credentialStorePath: storePath })),
    })).toBe('gpt-5.4');
    expect(resolveSystemSelectedModel({
      purpose: 'chat-compaction',
      provider: 'openai',
      activeModel: 'o3',
      credentialMode: credentialModeFromSource(resolveProviderCredentialSourceForModel('o3', { credentialStorePath: storePath })),
    })).toBe('gpt-5.4');
    expect(resolveSystemSelectedModel({
      purpose: 'chat-compaction',
      provider: 'openai',
      activeModel: 'gpt-5.4',
      credentialMode: credentialModeFromSource(resolveProviderCredentialSourceForModel('gpt-5.4', {
        apiKey: 'sk-test',
        apiKeyProvider: 'explicit',
        credentialStorePath: storePath,
      })),
    })).toBe('gpt-5.1-codex-mini');
  });

  it('compacts older transcript messages into a summary and keeps recent messages', () => {
    const history: ChatMessage[] = Array.from({ length: 50 }).flatMap((_, index) => [
      { role: 'user' as const, content: `User prompt ${index}: ${'u'.repeat(4000)}` },
      { role: 'assistant' as const, content: `Assistant reply ${index}: ${'a'.repeat(4000)}` },
    ]);

    const compacted = compactChatHistory({
      history,
      model: 'gpt-4.1',
    });

    expect(isCompactedHistorySummary(compacted.history[0]!)).toBe(true);
    expect(compacted.history.length).toBeLessThan(history.length);
    expect(compacted.history.at(-1)).toEqual(history.at(-1));
    expect(compacted.history.at(-2)).toEqual(history.at(-2));
    expect(compacted.context.estimatedHistoryTokens).toBeLessThan(80_000);
    expect(compacted.context.compactedMessages).toBeGreaterThan(0);

    const visibleMessages = buildConversationMessages(compacted.history);
    expect(visibleMessages[0]?.text).toContain('Earlier conversation history was summarized and archived');
  });

  it('can force a single manual compaction pass even before the auto threshold is exceeded', () => {
    const history: ChatMessage[] = Array.from({ length: 6 }).flatMap((_, index) => [
      { role: 'user' as const, content: `User prompt ${index}: ${'u'.repeat(60)}` },
      { role: 'assistant' as const, content: `Assistant reply ${index}: ${'a'.repeat(60)}` },
    ]);

    const autoCompacted = compactChatHistory({
      history,
      model: 'gpt-5.1',
    });
    const manuallyCompacted = compactChatHistory({
      history,
      model: 'gpt-5.1',
      force: true,
    });

    expect(autoCompacted.history).toEqual(history);
    expect(isCompactedHistorySummary(manuallyCompacted.history[0]!)).toBe(true);
    expect(manuallyCompacted.history.length).toBeLessThan(history.length);
    expect(manuallyCompacted.context.compactedMessages).toBeGreaterThan(0);
  });

  it('keeps recent history by token budget rather than a fixed message count', () => {
    const history: ChatMessage[] = [
      ...Array.from({ length: 10 }).flatMap((_, index) => [
        { role: 'user' as const, content: `Older user ${index}: ${'u'.repeat(2_000)}` },
        { role: 'assistant' as const, content: `Older assistant ${index}: ${'a'.repeat(2_000)}` },
      ]),
      { role: 'user' as const, content: `recent small request` },
      { role: 'assistant' as const, content: `recent giant tool analysis: ${'a'.repeat(80_000)}` },
      { role: 'tool' as const, toolCallId: 'huge-tool-1', content: `{"ok":true,"output":"${'t'.repeat(80_000)}"}` },
      { role: 'assistant' as const, content: `recent giant follow-up: ${'b'.repeat(80_000)}` },
      { role: 'user' as const, content: 'what was our task?' },
    ];

    const compacted = compactChatHistory({
      history,
      model: 'gpt-4.1',
      force: true,
    });

    expect(isCompactedHistorySummary(compacted.history[0]!)).toBe(true);
    expect(compacted.history.length).toBeLessThan(16);
    expect(compacted.history.at(-1)).toEqual(history.at(-1));
    expect(compacted.context.estimatedHistoryTokens).toBeLessThan(90_000);
  });

  it('can re-compact an already compacted short session when forced manually', () => {
    const history: ChatMessage[] = [
      {
        role: 'system',
        content: 'Heddle compacted earlier conversation history.\n\nMore recent archived turns:\nAssistant: Earlier summary.',
      },
      { role: 'system', content: 'Host reminder: use the evidence you already gathered.' },
      { role: 'tool', toolCallId: 'tool-1', content: '{"ok":true,"output":"git diff --stat HEAD"}' },
      { role: 'user', content: 'can you try again' },
      { role: 'user', content: 'try again' },
    ];

    const compacted = compactChatHistory({
      history,
      model: 'gpt-5.1',
      force: true,
    });

    expect(compacted.history.length).toBeLessThan(history.length);
    expect(isCompactedHistorySummary(compacted.history[0]!)).toBe(true);
    expect(compacted.context.compactedMessages).toBeGreaterThan(0);
  });

  it('archives compacted messages and writes a rolling summary', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-chat-compaction-archive-'));
    const history: ChatMessage[] = Array.from({ length: 24 }).flatMap((_, index) => [
      { role: 'user' as const, content: `User prompt ${index}: ${'u'.repeat(1_000)}` },
      { role: 'assistant' as const, content: `Assistant reply ${index}: ${'a'.repeat(1_000)}` },
    ]);
    const llm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-5.1-codex-mini',
        capabilities: {
          toolCalls: false,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: false,
        },
      },
      async chat() {
        return {
          content: [
            '# Compacted Conversation Rolling Summary',
            '## Work Completed',
            '- Added archive-backed compaction.',
            '## High-Fidelity Details Worth Retrieving',
            '- Read the raw archive if exact tool output matters.',
          ].join('\n'),
        };
      },
    };

    const compacted = await compactChatHistoryWithArchive({
      history,
      model: 'gpt-5.1',
      sessionId: 'session-archive',
      stateRoot,
      force: true,
      summarizer: { llm },
    });

    expect(compacted.archives).toHaveLength(1);
    expect(compacted.history[0]?.role).toBe('system');
    expect(compacted.history[0]?.content).toContain('.heddle/chat-sessions/session-archive/archives');
    expect(compacted.context.compactionStatus).toBe('idle');
    expect(compacted.context.archiveCount).toBe(1);
    expect(compacted.context.currentSummaryPath).toBe(compacted.archives[0]?.summaryPath);

    const archivePath = join(stateRoot, 'chat-sessions', 'session-archive', 'archives');
    expect(existsSync(join(archivePath, 'manifest.json'))).toBe(true);
    expect(readFileSync(join(archivePath, 'manifest.json'), 'utf8')).toContain('"sessionId": "session-archive"');
    expect(readFileSync(join(archivePath, 'manifest.json'), 'utf8')).toContain(compacted.archives[0]!.id);
    expect(readFileSync(join(archivePath, `${compacted.archives[0]!.id}.summary.md`), 'utf8')).toContain(
      '# Compacted Conversation Rolling Summary',
    );
  });

  it('carries forward the rolling summary across repeated compactions', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-chat-compaction-repeat-'));
    const firstHistory: ChatMessage[] = Array.from({ length: 18 }).flatMap((_, index) => [
      { role: 'user' as const, content: `First user ${index}: ${'u'.repeat(1_000)}` },
      { role: 'assistant' as const, content: `First assistant ${index}: ${'a'.repeat(1_000)}` },
    ]);
    const secondHistory: ChatMessage[] = Array.from({ length: 18 }).flatMap((_, index) => [
      { role: 'user' as const, content: `Second user ${index}: ${'u'.repeat(1_000)}` },
      { role: 'assistant' as const, content: `Second assistant ${index}: ${'a'.repeat(1_000)}` },
    ]);
    const llmCalls: string[] = [];
    const llm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-5.1-codex-mini',
        capabilities: {
          toolCalls: false,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: false,
        },
      },
      async chat(messages) {
        llmCalls.push(messages[1]?.content ?? '');
        return {
          content: [
            '# Compacted Conversation Rolling Summary',
            `## Work Completed`,
            `- Summary call ${llmCalls.length}.`,
          ].join('\n'),
        };
      },
    };

    await compactChatHistoryWithArchive({
      history: firstHistory,
      model: 'gpt-5.1',
      sessionId: 'session-repeat',
      stateRoot,
      force: true,
      summarizer: { llm },
    });
    const compactedAgain = await compactChatHistoryWithArchive({
      history: secondHistory,
      model: 'gpt-5.1',
      sessionId: 'session-repeat',
      stateRoot,
      force: true,
      summarizer: { llm },
    });

    expect(compactedAgain.archives).toHaveLength(2);
    expect(llmCalls).toHaveLength(2);
    expect(llmCalls[1]).toContain('Summary call 1.');
    expect(compactedAgain.history[0]?.content).toContain('Archive index:');
  });

  it('condenses large raw archive content before sending it to the summarizer', async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'heddle-chat-compaction-large-summary-'));
    const history: ChatMessage[] = Array.from({ length: 40 }).flatMap((_, index) => [
      { role: 'user' as const, content: `User ${index}: ${'u'.repeat(20_000)}` },
      { role: 'assistant' as const, content: `Assistant ${index}: ${'a'.repeat(20_000)}` },
      { role: 'tool' as const, toolCallId: `call-${index}`, content: `Tool ${index}: ${'t'.repeat(20_000)}` },
    ]);
    let summarizerInput = '';
    const llm: LlmAdapter = {
      info: {
        provider: 'openai',
        model: 'gpt-5.1-codex-mini',
        capabilities: {
          toolCalls: false,
          systemMessages: true,
          reasoningSummaries: false,
          parallelToolCalls: false,
        },
      },
      async chat(messages) {
        summarizerInput = messages[1]?.content ?? '';
        return {
          content: [
            '# Compacted Conversation Rolling Summary',
            '## Work Completed',
            '- Large archive summarized.',
          ].join('\n'),
        };
      },
    };

    const compacted = await compactChatHistoryWithArchive({
      history,
      model: 'gpt-5.1',
      sessionId: 'session-large-summary',
      stateRoot,
      force: true,
      summarizer: { llm },
    });

    expect(compacted.archives).toHaveLength(1);
    expect(summarizerInput.length).toBeLessThan(300_000);
    expect(summarizerInput).toContain('Summarizer transcript note');
    expect(summarizerInput).toContain('full content is in the raw archive');
  });
});
