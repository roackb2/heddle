/** @vitest-environment jsdom */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalComposer } from '../../../cli/chat/components/ApprovalComposer.js';
import {
  cycleApprovalChoice,
  resolveApprovalDecision,
  resolveAvailableApprovalChoices,
} from '../../../cli/chat/hooks/useApprovalFlow.js';
import type { PendingApproval } from '../../../core/chat/types.js';

function createPendingApproval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    call: { id: 'call-1', tool: 'run_shell_inspect', input: { command: 'pwd' } },
    tool: { name: 'run_shell_inspect', description: 'Inspect shell', parameters: { type: 'object', properties: {} } },
    resolve: () => undefined,
    ...overrides,
  };
}

describe('approval flow helpers', () => {
  it('does not include allow_project in available choices when remember is unavailable', () => {
    const pendingApproval = createPendingApproval();

    expect(resolveAvailableApprovalChoices(pendingApproval)).toEqual(['approve', 'deny']);
  });

  it('includes allow_project in available choices when remember is supported', () => {
    const pendingApproval = createPendingApproval({
      rememberForProject: () => undefined,
      rememberLabel: 'allow exact command',
    });

    expect(resolveAvailableApprovalChoices(pendingApproval)).toEqual(['approve', 'allow_project', 'deny']);
  });

  it('skips unavailable remember while cycling approval choices', () => {
    const pendingApproval = createPendingApproval();

    expect(cycleApprovalChoice('approve', 1, pendingApproval)).toBe('deny');
    expect(cycleApprovalChoice('deny', 1, pendingApproval)).toBe('approve');
    expect(cycleApprovalChoice('allow_project', 1, pendingApproval)).toBe('deny');
  });

  it('remembers and returns the remembered reason only for supported approvals', () => {
    const remember = vi.fn();
    const supported = createPendingApproval({
      rememberForProject: remember,
      rememberLabel: 'allow exact command',
    });
    const unsupported = createPendingApproval();

    expect(resolveApprovalDecision('allow_project', supported)).toEqual({
      approved: true,
      reason: 'Approved and remembered for this project in chat UI',
    });
    expect(remember).toHaveBeenCalledTimes(1);

    expect(resolveApprovalDecision('allow_project', unsupported)).toEqual({
      approved: true,
      reason: 'Approved in chat UI',
    });
  });
});

describe('ApprovalComposer', () => {
  it('does not render a remember option or remembered hint when remember is unavailable', () => {
    const pendingApproval = createPendingApproval();
    const view = render(<ApprovalComposer pendingApproval={pendingApproval} approvalChoice="approve" />);

    expect(view.container.textContent).toContain('Approve once');
    expect(view.container.textContent).toContain('Deny');
    expect(view.container.textContent).not.toContain('Remember for project');
    expect(view.container.textContent).not.toContain('Approved and remembered');
    expect(view.container.textContent).not.toContain('allow exact command');
  });

  it('renders a short exact-command remember label without duplicating the full command', () => {
    const fullCommand = 'git status --short --branch && git show --stat --oneline --no-patch HEAD';
    const pendingApproval = createPendingApproval({
      call: { id: 'call-2', tool: 'run_shell_mutate', input: { command: fullCommand } },
      tool: { name: 'run_shell_mutate', description: 'Mutate shell', parameters: { type: 'object', properties: {} } },
      rememberForProject: () => undefined,
      rememberLabel: 'allow exact command',
    });
    const view = render(<ApprovalComposer pendingApproval={pendingApproval} approvalChoice="allow_project" />);

    expect(view.container.textContent).toContain('allow exact command');
    expect(view.container.textContent).toContain(fullCommand);
    expect(view.container.textContent).not.toContain(`allow exact command ${fullCommand}`);
  });

  it('renders legacy exact-command remember labels without the raw command in the label', () => {
    const fullCommand = 'git status --short --branch && git show --stat --oneline --no-patch HEAD';
    const pendingApproval = createPendingApproval({
      call: { id: 'call-2', tool: 'run_shell_mutate', input: { command: fullCommand } },
      tool: { name: 'run_shell_mutate', description: 'Mutate shell', parameters: { type: 'object', properties: {} } },
      rememberForProject: () => undefined,
      rememberLabel: `allow exact command ${fullCommand} for this project`,
    });
    const view = render(<ApprovalComposer pendingApproval={pendingApproval} approvalChoice="allow_project" />);

    expect(view.container.textContent).toContain('allow exact command');
    expect(view.container.textContent).toContain(fullCommand);
    expect(view.container.textContent).not.toContain(`allow exact command ${fullCommand}`);
  });

  it('renders a short remember label when remember is supported for path-based approvals', () => {
    const pendingApproval = createPendingApproval({
      call: { id: 'call-2', tool: 'read_file', input: { path: '../notes/summary.md' } },
      tool: { name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: {} } },
      rememberForProject: () => undefined,
      rememberLabel: 'allow read_file ../notes/summary.md for this project',
    });
    const view = render(<ApprovalComposer pendingApproval={pendingApproval} approvalChoice="allow_project" />);

    expect(view.container.textContent).toContain('allow read_file for this project');
    expect(view.container.textContent).toContain('../notes/summary.md');
    expect(view.container.textContent).not.toContain('allow read_file ../notes/summary.md for this project');
  });

  it('renders the search query in the approval preview for search_files', () => {
    const pendingApproval = createPendingApproval({
      call: { id: 'call-2', tool: 'search_files', input: { query: 'approvalSubject', path: '../notes' } },
      tool: { name: 'search_files', description: 'Search files', parameters: { type: 'object', properties: {} } },
    });
    const view = render(<ApprovalComposer pendingApproval={pendingApproval} approvalChoice="approve" />);

    expect(view.container.textContent).toContain('Allow search_files');
    expect(view.container.textContent).toContain('approvalSubject');
    expect(view.container.textContent).toContain('search_files for "approvalSubject" in ../notes');
  });
});
