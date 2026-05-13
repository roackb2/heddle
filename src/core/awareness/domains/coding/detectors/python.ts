import type { CodingProjectSignalDetector } from './types.js';

const PYTHON_MANIFESTS = [
  { fileName: 'pyproject.toml', kind: 'pyproject_toml' },
  { fileName: 'requirements.txt', kind: 'requirements_txt' },
  { fileName: 'requirements-dev.txt', kind: 'requirements_dev_txt' },
  { fileName: 'Pipfile', kind: 'pipfile' },
] as const;

const PYTHON_LOCKFILES = [
  { fileName: 'poetry.lock', kind: 'poetry_lock' },
  { fileName: 'uv.lock', kind: 'uv_lock' },
  { fileName: 'Pipfile.lock', kind: 'pipfile_lock' },
] as const;

export const pythonProjectDetector: CodingProjectSignalDetector = {
  id: 'python',
  async detect(input) {
    const rootEntries = new Set(input.rootEntries);
    const manifests = PYTHON_MANIFESTS
      .filter((manifest) => rootEntries.has(manifest.fileName))
      .map((manifest) => ({
        kind: manifest.kind,
        path: manifest.fileName,
      }));
    const lockfiles = PYTHON_LOCKFILES
      .filter((lockfile) => rootEntries.has(lockfile.fileName))
      .map((lockfile) => ({
        kind: lockfile.kind,
        path: lockfile.fileName,
      }));

    const hasPytestIni = rootEntries.has('pytest.ini');
    const hasRuffToml = rootEntries.has('ruff.toml');
    const pyprojectText = rootEntries.has('pyproject.toml')
      ? await input.readText('pyproject.toml')
      : undefined;

    const verificationSurfaces = [];
    if (hasPytestIni || pyprojectText?.includes('[tool.pytest')) {
      verificationSurfaces.push({
        kind: 'command' as const,
        label: 'pytest command surface',
        sourcePath: hasPytestIni ? 'pytest.ini' : 'pyproject.toml',
        commands: ['python -m pytest'],
      });
    }
    if (hasRuffToml || pyprojectText?.includes('[tool.ruff')) {
      verificationSurfaces.push({
        kind: 'command' as const,
        label: 'ruff command surface',
        sourcePath: hasRuffToml ? 'ruff.toml' : 'pyproject.toml',
        commands: ['ruff check .'],
      });
    }

    if (manifests.length === 0 && lockfiles.length === 0 && verificationSurfaces.length === 0) {
      return null;
    }

    const configFiles = input.rootEntries.filter((entry) => PYTHON_CONFIG_FILES.has(entry)).sort();

    return {
      project: {
        kind: 'python',
        manifests,
        lockfiles,
        verificationSurfaces,
      },
      configFiles,
      sources: manifests
        .filter((manifest) => manifest.path === 'pyproject.toml')
        .map((manifest) => ({
          kind: 'package_metadata' as const,
          path: `${input.workspaceRoot}/${manifest.path}`,
        })),
      limits: [],
    };
  },
};

const PYTHON_CONFIG_FILES = new Set([
  'pytest.ini',
  'ruff.toml',
  'mypy.ini',
  'tox.ini',
  '.python-version',
]);
