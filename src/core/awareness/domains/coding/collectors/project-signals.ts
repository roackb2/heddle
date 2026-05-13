import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import type { AwarenessLimit, AwarenessSource } from '../../../types.js';
import type {
  CodingInspectionSurface,
  CodingProjectSignals,
  CodingWorkingEnvironment,
} from '../types.js';
import { goProjectDetector } from '../detectors/go.js';
import { javascriptProjectDetector } from '../detectors/javascript.js';
import { pythonProjectDetector } from '../detectors/python.js';
import type {
  CodingProjectDetectorInput,
  CodingProjectSignalContribution,
} from '../detectors/types.js';
import { OMITTED_PATH_SEGMENTS } from './git.js';

const DIRECTORY_ROLES: Record<keyof CodingProjectSignals['observedDirectories'], string[]> = {
  source: ['src', 'lib', 'app', 'cmd', 'internal', 'pkg'],
  tests: ['test', 'tests', '__tests__'],
  docs: ['docs'],
  examples: ['examples'],
  scripts: ['scripts'],
  config: ['config', '.github'],
};

const SUPPORTED_PROJECT_DETECTORS = [
  javascriptProjectDetector,
  pythonProjectDetector,
  goProjectDetector,
];

export async function collectCodingProjectSignals(input: {
  workspaceRoot: string;
  environment: CodingWorkingEnvironment;
}): Promise<{
  projectSignals: CodingProjectSignals;
  inspectionSurfaces: CodingInspectionSurface[];
  sources: AwarenessSource[];
  limits: AwarenessLimit[];
}> {
  const sources: AwarenessSource[] = [];
  const limits: AwarenessLimit[] = [];

  const observedDirectories: CodingProjectSignals['observedDirectories'] = {
    source: [],
    tests: [],
    docs: [],
    examples: [],
    scripts: [],
    config: [],
  };

  let dirents: Dirent<string>[];
  try {
    dirents = await readdir(input.workspaceRoot, { withFileTypes: true });
  } catch (error) {
    limits.push({
      kind: 'unavailable',
      subject: 'project signals',
      detail: `Could not read workspace root entries: ${error instanceof Error ? error.message : String(error)}`,
    });
    return {
      projectSignals: {
        detectedProjects: [],
        observedDirectories,
        configFiles: [],
      },
      inspectionSurfaces: buildInspectionSurfaces({
        projectSignals: {
          detectedProjects: [],
          observedDirectories,
          configFiles: [],
        },
        environment: input.environment,
      }),
      sources,
      limits,
    };
  }

  const visibleDirents = dirents.filter((dirent) => !OMITTED_PATH_SEGMENTS.has(dirent.name));
  const rootEntries = visibleDirents.map((dirent) => dirent.name).sort();

  for (const dirent of visibleDirents) {
    if (!dirent.isDirectory()) {
      continue;
    }
    for (const [role, names] of Object.entries(DIRECTORY_ROLES) as Array<
      [keyof CodingProjectSignals['observedDirectories'], string[]]
    >) {
      if (names.includes(dirent.name)) {
        observedDirectories[role].push(dirent.name);
      }
    }
  }

  const detectorInput: CodingProjectDetectorInput = {
    workspaceRoot: input.workspaceRoot,
    rootEntries,
    readText: (relativePath) => readWorkspaceText(input.workspaceRoot, relativePath),
  };

  const contributions = (
    await Promise.all(SUPPORTED_PROJECT_DETECTORS.map((detector) => detector.detect(detectorInput)))
  ).filter((value): value is CodingProjectSignalContribution => value !== null);

  const projectSignals = mergeProjectSignals(contributions, observedDirectories);
  for (const contribution of contributions) {
    sources.push(...contribution.sources);
    limits.push(...contribution.limits);
  }

  return {
    projectSignals,
    inspectionSurfaces: buildInspectionSurfaces({
      projectSignals,
      environment: input.environment,
    }),
    sources: dedupeSources(sources),
    limits,
  };
}

async function readWorkspaceText(workspaceRoot: string, relativePath: string): Promise<string | undefined> {
  try {
    return await readFile(`${workspaceRoot}/${relativePath}`, 'utf8');
  } catch {
    return undefined;
  }
}

function mergeProjectSignals(
  contributions: CodingProjectSignalContribution[],
  observedDirectories: CodingProjectSignals['observedDirectories'],
): CodingProjectSignals {
  const detectedProjects = new Map<string, CodingProjectSignals['detectedProjects'][number]>();
  const configFiles = new Set<string>();

  for (const contribution of contributions) {
    detectedProjects.set(contribution.project.kind, contribution.project);
    for (const configFile of contribution.configFiles) {
      configFiles.add(configFile);
    }
  }

  const normalizedObservedDirectories = normalizeObservedDirectories(observedDirectories);

  return {
    detectedProjects: [...detectedProjects.values()].sort((left, right) => left.kind.localeCompare(right.kind)),
    observedDirectories: normalizedObservedDirectories,
    configFiles: [...configFiles].sort(),
  };
}

function buildInspectionSurfaces(args: {
  projectSignals: CodingProjectSignals;
  environment: CodingWorkingEnvironment;
}): CodingInspectionSurface[] {
  const surfaces: CodingInspectionSurface[] = [];

  const manifestPaths = args.projectSignals.detectedProjects
    .flatMap((project) => project.manifests.map((manifest) => manifest.path));
  if (manifestPaths.length > 0) {
    surfaces.push({
      kind: 'manifest',
      paths: manifestPaths.sort(),
    });
  }

  for (const [role, paths] of Object.entries(args.projectSignals.observedDirectories) as Array<
    [keyof CodingProjectSignals['observedDirectories'], string[]]
  >) {
    if (paths.length === 0) {
      continue;
    }
    surfaces.push({
      kind: 'directory',
      role,
      paths,
    });
  }

  if (args.projectSignals.configFiles.length > 0) {
    surfaces.push({
      kind: 'config_file',
      paths: args.projectSignals.configFiles,
    });
  }

  const verificationLabels = args.projectSignals.detectedProjects
    .flatMap((project) => project.verificationSurfaces.map((surface) => surface.label));
  if (verificationLabels.length > 0) {
    surfaces.push({
      kind: 'verification_surface',
      labels: verificationLabels.sort(),
    });
  }

  const dirtyCounts = {
    staged: args.environment.paths.staged.length,
    modified: args.environment.paths.modified.length,
    deleted: args.environment.paths.deleted.length,
    untracked: args.environment.paths.untracked.length,
    renamed: args.environment.paths.renamed.length,
  };
  if (Object.values(dirtyCounts).some((count) => count > 0)) {
    surfaces.push({
      kind: 'dirty_paths',
      counts: dirtyCounts,
    });
  }

  return surfaces;
}

function dedupeSources(sources: AwarenessSource[]): AwarenessSource[] {
  const seen = new Set<string>();
  const deduped: AwarenessSource[] = [];

  for (const source of sources) {
    const key = `${source.kind}|${source.command ?? ''}|${source.path ?? ''}|${source.note ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(source);
  }

  return deduped;
}

function normalizeObservedDirectories(
  observedDirectories: CodingProjectSignals['observedDirectories'],
): CodingProjectSignals['observedDirectories'] {
  return {
    source: [...observedDirectories.source].sort(),
    tests: [...observedDirectories.tests].sort(),
    docs: [...observedDirectories.docs].sort(),
    examples: [...observedDirectories.examples].sort(),
    scripts: [...observedDirectories.scripts].sort(),
    config: [...observedDirectories.config].sort(),
  };
}
