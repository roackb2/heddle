import type { CodingAwarenessSnapshot, CodingProjectDashboardOutput } from './types.js';

export function formatCodingProjectDashboardSnapshot(snapshot: CodingAwarenessSnapshot): CodingProjectDashboardOutput {
  const sections: CodingProjectDashboardOutput['sections'] = {};

  for (const section of snapshot.sections) {
    if (section.type === 'working_environment') {
      sections.working_environment = section.data;
    }
    if (section.type === 'workspace_tree') {
      sections.workspace_tree = section.data;
    }
    if (section.type === 'project_signals') {
      sections.project_signals = section.data;
    }
    if (section.type === 'inspection_surfaces') {
      sections.inspection_surfaces = section.data;
    }
  }

  return {
    schemaVersion: 1,
    domain: 'coding',
    profile: 'project_dashboard',
    collectedAt: snapshot.collectedAt,
    workspaceRoot: snapshot.workspaceRoot,
    sections,
    sources: snapshot.sources,
    limits: snapshot.limits,
  };
}
