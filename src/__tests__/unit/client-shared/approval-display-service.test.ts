import { describe, expect, it } from 'vitest';
import { ClientSharedApprovalDisplayService } from '../../../client-shared/services/approvals/index.js';

describe('ClientSharedApprovalDisplayService', () => {
  it('formats common approval input details with host-provided labels', () => {
    expect(ClientSharedApprovalDisplayService.resolveInputDetail(
      { command: 'yarn test' },
      { command: 'Command', path: 'Path' },
    )).toEqual({
      label: 'Command',
      value: 'yarn test',
    });

    expect(ClientSharedApprovalDisplayService.resolveInputDetail(
      { path: 'src/index.ts' },
      { command: 'Command', path: 'Path' },
    )).toEqual({
      label: 'Path',
      value: 'src/index.ts',
    });
  });

  it('serializes and truncates raw approval payloads', () => {
    expect(ClientSharedApprovalDisplayService.formatPayload({ ok: true }, 100)).toBe('{\n  "ok": true\n}');
    expect(ClientSharedApprovalDisplayService.formatPayload('abcdef', 3)).toBe('abc...');
  });
});
