import { describe, expect, it } from 'vitest';
import { appendArtifactDomainSystemContext, buildArtifactDomainSystemContext } from '../../../core/artifacts/domain-prompt.js';

describe('artifact domain prompt', () => {
  it('builds artifact usage guidance for durable generated outputs', () => {
    const context = buildArtifactDomainSystemContext();

    expect(context).toContain('## Artifact Domain');
    expect(context).toContain('Artifacts are durable generated outputs');
    expect(context).toContain('Use artifact_dashboard before editing or continuing an existing generated output');
    expect(context).toContain('Use save_artifact when creating a durable text-like output');
    expect(context).toContain('Use read_artifact before revising an existing artifact');
    expect(context).toContain('Do not save ordinary short answers');
    expect(context).toContain('Durable preferences and recurring workflow knowledge belong to Heddle-managed memory');
  });

  it('prepends artifact guidance to existing system context', () => {
    const context = appendArtifactDomainSystemContext('Source: AGENTS.md\nRead docs first.');

    expect(context).toContain('Source: AGENTS.md');
    expect(context.indexOf('## Artifact Domain')).toBeLessThan(context.indexOf('Source: AGENTS.md'));
  });
});
