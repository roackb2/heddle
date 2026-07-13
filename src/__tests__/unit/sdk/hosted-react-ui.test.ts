import { describe, expect, it } from 'vitest';
import { appendHostedAgentActivity } from '../../../../examples/sdk/05-hosted-agent/04-react-ui/src/activity-feed.js';
import {
  clearHostedAgentRunCheckpoint,
  readHostedAgentRunCheckpoint,
  writeHostedAgentRunCheckpoint,
} from '../../../../examples/sdk/05-hosted-agent/04-react-ui/src/run-checkpoint.js';
import { HostedAgentRunProtocol } from '../../../../examples/sdk/05-hosted-agent/02-http-sse-api/contracts.js';

describe('hosted React UI example boundaries', () => {
  it('round-trips the cursor with the rendered projection', () => {
    const storage = new MemoryStorage();
    const checkpoint = {
      runId: 'run-1',
      afterSequence: 4,
      assistantText: 'Visible response',
      activities: [{
        id: 'run-1:3',
        label: 'read_file completed',
        detail: '12 ms',
        tone: 'success' as const,
      }],
    };

    expect(writeHostedAgentRunCheckpoint(storage, 'session-1', checkpoint)).toBe(true);
    expect(readHostedAgentRunCheckpoint(storage, 'session-1')).toEqual({
      checkpoint,
      storageAvailable: true,
    });
    expect(clearHostedAgentRunCheckpoint(storage, 'session-1')).toBe(true);
    expect(readHostedAgentRunCheckpoint(storage, 'session-1')).toEqual({
      storageAvailable: true,
    });
  });

  it('discards malformed browser state instead of trusting it', () => {
    const storage = new MemoryStorage();
    storage.setItem('heddle:hosted-react-example:run:session-1', '{"afterSequence":-1}');

    expect(readHostedAgentRunCheckpoint(storage, 'session-1')).toEqual({
      storageAvailable: true,
    });
    expect(storage.length).toBe(0);
  });

  it('degrades safely when browser storage is unavailable', () => {
    expect(readHostedAgentRunCheckpoint(undefined, 'session-1')).toEqual({
      storageAvailable: false,
    });
    expect(writeHostedAgentRunCheckpoint(undefined, 'session-1', {
      runId: 'run-1',
      afterSequence: 0,
      assistantText: '',
      activities: [],
    })).toBe(false);
    expect(clearHostedAgentRunCheckpoint(undefined, 'session-1')).toBe(false);
  });

  it('projects only safe activity fields and builds a bounded UI feed', () => {
    const event = HostedAgentRunProtocol.parseEvent({
      kind: 'activity',
      runId: 'run-1',
      sequence: 1,
      timestamp: '2026-07-12T00:00:00.000Z',
      activity: {
        type: 'tool.calling',
        tool: 'search_files',
        step: 2,
        input: { secret: 'must-not-cross-wire-boundary' },
      },
    });
    if (event.kind !== 'activity') {
      throw new Error('Expected a public activity event.');
    }

    expect(event.activity).toEqual({
      type: 'tool.calling',
      tool: 'search_files',
      step: 2,
    });
    expect(appendHostedAgentActivity([], event)).toEqual([{
      id: 'run-1:1',
      label: 'Running search_files',
      detail: 'Step 2',
      tone: 'running',
    }]);
  });

  it('preserves the safe quota category through the hosted result contract', () => {
    const event = HostedAgentRunProtocol.parseEvent({
      kind: 'result',
      runId: 'run-1',
      sequence: 2,
      timestamp: '2026-07-12T00:00:01.000Z',
      result: {
        outcome: 'error',
        summary: 'Model provider quota or billing limit reached',
        failure: { source: 'model', code: 'quota', providerMessage: 'must-not-cross-wire-boundary' },
      },
    });

    expect(event).toMatchObject({
      kind: 'result',
      result: {
        outcome: 'error',
        failure: { source: 'model', code: 'quota' },
      },
    });
    expect(JSON.stringify(event)).not.toContain('providerMessage');
  });
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
