import type { CodingProjectSignalDetector } from './types.js';

export const goProjectDetector: CodingProjectSignalDetector = {
  id: 'go',
  async detect(input) {
    const rootEntries = new Set(input.rootEntries);
    const hasGoMod = rootEntries.has('go.mod');
    const hasGoSum = rootEntries.has('go.sum');

    if (!hasGoMod && !hasGoSum) {
      return null;
    }

    const manifests = hasGoMod
      ? [{
          kind: 'go_mod',
          path: 'go.mod',
        }]
      : [];
    const lockfiles = hasGoSum
      ? [{
          kind: 'go_sum',
          path: 'go.sum',
        }]
      : [];

    const verificationSurfaces = hasGoMod
      ? [{
          kind: 'command' as const,
          label: 'go module verification commands',
          sourcePath: 'go.mod',
          commands: ['go test ./...', 'go vet ./...'],
        }]
      : [];

    return {
      project: {
        kind: 'go',
        manifests,
        lockfiles,
        verificationSurfaces,
      },
      configFiles: [],
      sources: hasGoMod
        ? [{
            kind: 'package_metadata' as const,
            path: `${input.workspaceRoot}/go.mod`,
          }]
        : [],
      limits: [],
    };
  },
};
