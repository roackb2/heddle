/** @vitest-environment jsdom */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChangedFilesPanel } from '@/cli-v2/components/ChangedFilesPanel.js';

describe('cli-v2 ChangedFilesPanel', () => {
  it('renders workspace-relative paths with their control-plane statuses', () => {
    const view = render(
      <ChangedFilesPanel files={[
        { path: 'src/changed.ts', status: 'modified' },
        { path: 'docs/new-guide.md', status: 'untracked' },
        { path: 'src/new-name.ts', oldPath: 'src/old-name.ts', status: 'renamed' },
      ]} />,
    );

    expect(view.container.textContent).toContain('Changed files · 3');
    expect(view.container.textContent).toContain('modified ./src/changed.ts');
    expect(view.container.textContent).toContain('untracked ./docs/new-guide.md');
    expect(view.container.textContent).toContain('renamed ./src/new-name.ts ← ./src/old-name.ts');
  });

  it('caps the terminal list and reports omitted files', () => {
    const files = Array.from({ length: 10 }, (_, index) => ({
      path: `src/file-${index + 1}.ts`,
      status: 'modified' as const,
    }));
    const view = render(<ChangedFilesPanel files={files} />);

    expect(view.container.textContent).toContain('./src/file-8.ts');
    expect(view.container.textContent).not.toContain('./src/file-9.ts');
    expect(view.container.textContent).toContain('… and 2 more');
  });

  it('does not render when the workspace is clean', () => {
    const view = render(<ChangedFilesPanel files={[]} />);

    expect(view.container.textContent).toBe('');
  });
});
