import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAwarenessService } from '../../../core/awareness/service.js';
import { createCodingAwarenessProvider } from '../../../core/awareness/domains/coding/provider.js';
import { createProjectDashboardTool } from '../../../core/tools/toolkits/coding-awareness/project-dashboard.js';

describe('coding project dashboard awareness', () => {
  it('reports a clean git workspace with environment and workspace tree sections', async () => {
    const root = createGitWorkspace();
    const realRoot = realpathSync(root);
    const snapshot = await collectProjectDashboard(root);

    expect(snapshot.profile).toBe('project_dashboard');
    expect(snapshot.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'working_environment',
        data: expect.objectContaining({
          workspaceRoot: root,
          gitRepositoryRoot: realRoot,
          isGitRepository: true,
          isDirty: false,
          gitBranch: expect.any(String),
          gitShortCommit: expect.stringMatching(/^[0-9a-f]{7,}$/),
        }),
      }),
      expect.objectContaining({
        type: 'workspace_tree',
        data: expect.objectContaining({
          root: root,
          maxDepth: 2,
          maxEntries: 60,
          entries: expect.arrayContaining([
            expect.objectContaining({ path: 'README.md', kind: 'file' }),
          ]),
        }),
      }),
      expect.objectContaining({
        type: 'project_signals',
        data: expect.objectContaining({
          detectedProjects: [],
        }),
      }),
      expect.objectContaining({
        type: 'inspection_surfaces',
        data: [],
      }),
    ]));
    expect(snapshot.limits).toEqual(expect.arrayContaining([]));
  });

  it('reports dirty paths while excluding runtime noise from both environment and tree', async () => {
    const root = createGitWorkspace();

    writeFileSync(join(root, 'delete-me.txt'), 'delete me\n');
    execFileSync('git', ['add', 'delete-me.txt'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'add delete me'], { cwd: root, stdio: 'ignore' });

    writeFileSync(join(root, 'rename-from.txt'), 'rename me\n');
    execFileSync('git', ['add', 'rename-from.txt'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'add rename source'], { cwd: root, stdio: 'ignore' });

    mkdirSync(join(root, '.heddle'), { recursive: true });
    writeFileSync(join(root, '.heddle', 'ignored-state.json'), '{"state":true}\n');
    execFileSync('git', ['add', '.heddle/ignored-state.json'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'track heddle state for ignore test'], { cwd: root, stdio: 'ignore' });

    mkdirSync(join(root, 'src', 'deep'), { recursive: true });
    writeFileSync(join(root, 'src', 'main.ts'), 'export const main = true;\n');
    writeFileSync(join(root, 'src', 'deep', 'nested.ts'), 'export const nested = true;\n');
    writeFileSync(join(root, 'README.md'), 'hello\nworld\nmodified\n');
    writeFileSync(join(root, 'staged.txt'), 'staged\n');
    execFileSync('git', ['add', 'staged.txt'], { cwd: root });
    writeFileSync(join(root, 'new-file.txt'), 'new file\n');
    unlinkSync(join(root, 'delete-me.txt'));
    renameSync(join(root, 'rename-from.txt'), join(root, 'rename-to.txt'));
    execFileSync('git', ['add', '-A'], { cwd: root });
    writeFileSync(join(root, 'README.md'), 'hello\nworld\nmodified\nunstaged\n');
    writeFileSync(join(root, 'truly-untracked.txt'), 'still untracked\n');
    writeFileSync(join(root, '.heddle', 'ignored-state.json'), '{"state":false}\n');
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'ignored-runtime.js'), 'console.log("ignore");\n');
    execFileSync('git', ['add', 'node_modules/ignored-runtime.js'], { cwd: root });

    rmSync(join(root, '.git', 'index.lock'), { force: true });

    const snapshot = await collectProjectDashboard(root, { maxDepth: 2, maxEntries: 20 });
    const environment = snapshot.sections.find((section) => section.type === 'working_environment');
    const tree = snapshot.sections.find((section) => section.type === 'workspace_tree');

    expect(environment?.data.isDirty).toBe(true);
    expect(environment?.data.paths.untracked).toEqual(['truly-untracked.txt']);
    expect(JSON.stringify(environment)).not.toContain('.heddle');
    expect(JSON.stringify(environment)).not.toContain('node_modules');
    expect(JSON.stringify(tree)).not.toContain('.heddle');
    expect(JSON.stringify(tree)).not.toContain('node_modules');
    expect(snapshot.limits).toContainEqual(expect.objectContaining({
      kind: 'omitted',
      subject: 'git working tree paths',
    }));
  });

  it('preserves isDirty when omitted paths are the only changes', async () => {
    const root = createGitWorkspace();

    mkdirSync(join(root, '.heddle'), { recursive: true });
    writeFileSync(join(root, '.heddle', 'runtime-state.json'), '{"dirty":true}\n');

    const snapshot = await collectProjectDashboard(root);
    const environment = snapshot.sections.find((section) => section.type === 'working_environment');

    expect(environment?.data.isDirty).toBe(true);
    expect(environment?.data.paths).toEqual({
      staged: [],
      modified: [],
      deleted: [],
      untracked: [],
      renamed: [],
    });
    expect(snapshot.limits).toContainEqual(expect.objectContaining({
      kind: 'omitted',
      subject: 'git working tree paths',
    }));
  });

  it('reports renamed-only changes', async () => {
    const root = createGitWorkspace();

    writeFileSync(join(root, 'rename-me.txt'), 'rename me\n');
    execFileSync('git', ['add', 'rename-me.txt'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'add rename target'], { cwd: root, stdio: 'ignore' });

    renameSync(join(root, 'rename-me.txt'), join(root, 'renamed.txt'));
    execFileSync('git', ['add', '-A'], { cwd: root });

    const snapshot = await collectProjectDashboard(root);
    const environment = snapshot.sections.find((section) => section.type === 'working_environment');

    expect(environment?.data.isDirty).toBe(true);
    expect(environment?.data.paths.renamed).toEqual([
      { from: 'rename-me.txt', to: 'renamed.txt' },
    ]);
    expect(environment?.data.paths.staged).toEqual([]);
    expect(environment?.data.paths.modified).toEqual([]);
    expect(environment?.data.paths.deleted).toEqual([]);
    expect(environment?.data.paths.untracked).toEqual([]);
  });

  it('handles detached HEAD by leaving branch undefined while preserving git state', async () => {
    const root = createGitWorkspace();
    const detachedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

    execFileSync('git', ['checkout', '--detach', detachedCommit], { cwd: root, stdio: 'ignore' });

    const snapshot = await collectProjectDashboard(root);
    const environment = snapshot.sections.find((section) => section.type === 'working_environment');

    expect(environment?.data.isGitRepository).toBe(true);
    expect(environment?.data.gitBranch).toBeUndefined();
    expect(environment?.data.gitShortCommit).toMatch(/^[0-9a-f]{7,}$/);
    expect(environment?.data.isDirty).toBe(false);
  });

  it('degrades gracefully outside a git workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-awareness-non-git-'));
    const snapshot = await collectProjectDashboard(root);
    const environment = snapshot.sections.find((section) => section.type === 'working_environment');

    expect(environment?.data).toMatchObject({
      workspaceRoot: root,
      isGitRepository: false,
      isDirty: false,
    });
    expect(snapshot.limits).toContainEqual({
      kind: 'not_applicable',
      subject: 'git',
      detail: 'Workspace is not inside a git work tree.',
    });
  });

  it('truncates oversized tree entry budgets and path groups', async () => {
    const root = createGitWorkspace();

    for (let index = 0; index < 24; index += 1) {
      writeFileSync(join(root, `untracked-${index}.txt`), `file ${index}\n`);
    }
    mkdirSync(join(root, 'src'), { recursive: true });
    for (let index = 0; index < 24; index += 1) {
      writeFileSync(join(root, 'src', `file-${index}.ts`), `export const file${index} = true;\n`);
    }

    const snapshot = await collectProjectDashboard(root, { maxEntries: 10 });
    const environment = snapshot.sections.find((section) => section.type === 'working_environment');
    const tree = snapshot.sections.find((section) => section.type === 'workspace_tree');

    expect(environment?.data.paths.untracked).toHaveLength(20);
    expect(tree?.data.maxEntries).toBe(10);
    expect(snapshot.limits).toContainEqual(expect.objectContaining({
      kind: 'truncated',
      subject: 'untracked paths',
    }));
    expect(snapshot.limits).toContainEqual({
      kind: 'truncated',
      subject: 'workspace tree entries',
      detail: 'Showing at most 10 entries across the tree; additional entries were omitted.',
    });
  });

  it('exposes one default dashboard tool with structured JSON output', async () => {
    const root = createGitWorkspace();
    const realRoot = realpathSync(root);
    writeFileSync(join(root, 'README.md'), 'hello\nworld\nmodified\n');
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'awareness-test',
      scripts: {
        build: 'tsc -p tsconfig.json',
        lint: 'eslint .',
        dev: 'vite',
      },
    }, null, 2));
    writeFileSync(join(root, 'yarn.lock'), '# lockfile\n');
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'src', 'main.ts'), 'export const main = true;\n');

    const tool = createProjectDashboardTool({ workspaceRoot: root });
    const result = await tool.execute({});

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      schemaVersion: 1,
      domain: 'coding',
      profile: 'project_dashboard',
      workspaceRoot: root,
      sections: {
        working_environment: expect.objectContaining({
          gitRepositoryRoot: realRoot,
        }),
        workspace_tree: expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({ path: 'README.md', kind: 'file' }),
          ]),
        }),
        project_signals: expect.objectContaining({
          detectedProjects: [
            expect.objectContaining({
              kind: 'javascript',
              manifests: [
                expect.objectContaining({ kind: 'package_json', path: 'package.json' }),
              ],
              lockfiles: [
                expect.objectContaining({ kind: 'yarn_lock', path: 'yarn.lock' }),
              ],
              verificationSurfaces: [
                expect.objectContaining({
                  kind: 'script_names',
                  label: 'package.json verification scripts',
                  scriptNames: ['build', 'lint'],
                }),
              ],
            }),
          ],
        }),
        inspection_surfaces: expect.arrayContaining([
          expect.objectContaining({ kind: 'manifest', paths: ['package.json'] }),
          expect.objectContaining({ kind: 'directory', role: 'source', paths: ['src'] }),
          expect.objectContaining({ kind: 'directory', role: 'docs', paths: ['docs'] }),
          expect.objectContaining({ kind: 'directory', role: 'scripts', paths: ['scripts'] }),
          expect.objectContaining({ kind: 'verification_surface', labels: ['package.json verification scripts'] }),
        ]),
      },
      sources: expect.any(Array),
      limits: expect.any(Array),
    });
  });

  it('collects javascript project signals and inspection surfaces from package metadata and observed directories', async () => {
    const root = createGitWorkspace();
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'awareness-test',
      scripts: {
        build: 'tsc -p tsconfig.json',
        lint: 'eslint .',
        dev: 'vite',
        test: 'vitest run',
      },
    }, null, 2));
    writeFileSync(join(root, 'yarn.lock'), '# lockfile\n');
    writeFileSync(join(root, 'tsconfig.json'), '{}\n');
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'tests'), { recursive: true });
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'examples'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });

    const snapshot = await collectProjectDashboard(root);
    const signals = snapshot.sections.find((section) => section.type === 'project_signals');
    const surfaces = snapshot.sections.find((section) => section.type === 'inspection_surfaces');

    expect(signals?.data).toEqual(expect.objectContaining({
      detectedProjects: [
        expect.objectContaining({
          kind: 'javascript',
          manifests: [
            expect.objectContaining({ kind: 'package_json', path: 'package.json' }),
          ],
          lockfiles: [
            expect.objectContaining({ kind: 'yarn_lock', path: 'yarn.lock' }),
          ],
          verificationSurfaces: [
            expect.objectContaining({
              kind: 'script_names',
              label: 'package.json verification scripts',
              scriptNames: ['build', 'lint', 'test'],
            }),
          ],
        }),
      ],
      observedDirectories: expect.objectContaining({
        source: ['src'],
        tests: ['tests'],
        docs: ['docs'],
        examples: ['examples'],
        scripts: ['scripts'],
      }),
      configFiles: ['tsconfig.json'],
    }));
    expect(surfaces?.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'manifest', paths: ['package.json'] }),
      expect.objectContaining({ kind: 'directory', role: 'source', paths: ['src'] }),
      expect.objectContaining({ kind: 'directory', role: 'tests', paths: ['tests'] }),
      expect.objectContaining({ kind: 'config_file', paths: ['tsconfig.json'] }),
      expect.objectContaining({ kind: 'verification_surface', labels: ['package.json verification scripts'] }),
    ]));
  });

  it('collects python and go signals through bounded detectors instead of javascript-specific fields', async () => {
    const root = createGitWorkspace();
    writeFileSync(join(root, 'pyproject.toml'), [
      '[project]',
      'name = "py-go-workspace"',
      '',
      '[tool.pytest.ini_options]',
      'addopts = "-q"',
      '',
      '[tool.ruff]',
      'line-length = 100',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'go.mod'), 'module example.com/awareness\n\ngo 1.24.0\n');
    writeFileSync(join(root, 'go.sum'), 'example.com/mod v1.0.0 h1:abc\n');
    mkdirSync(join(root, 'cmd'), { recursive: true });
    mkdirSync(join(root, 'internal'), { recursive: true });
    mkdirSync(join(root, 'tests'), { recursive: true });

    const snapshot = await collectProjectDashboard(root);
    const signals = snapshot.sections.find((section) => section.type === 'project_signals');
    const surfaces = snapshot.sections.find((section) => section.type === 'inspection_surfaces');

    expect(signals?.data).toEqual(expect.objectContaining({
      detectedProjects: expect.arrayContaining([
        expect.objectContaining({
          kind: 'go',
          manifests: [expect.objectContaining({ kind: 'go_mod', path: 'go.mod' })],
          lockfiles: [expect.objectContaining({ kind: 'go_sum', path: 'go.sum' })],
          verificationSurfaces: [
            expect.objectContaining({
              kind: 'command',
              label: 'go module verification commands',
              commands: ['go test ./...', 'go vet ./...'],
            }),
          ],
        }),
        expect.objectContaining({
          kind: 'python',
          manifests: [expect.objectContaining({ kind: 'pyproject_toml', path: 'pyproject.toml' })],
          verificationSurfaces: expect.arrayContaining([
            expect.objectContaining({
              kind: 'command',
              label: 'pytest command surface',
              commands: ['python -m pytest'],
            }),
            expect.objectContaining({
              kind: 'command',
              label: 'ruff command surface',
              commands: ['ruff check .'],
            }),
          ]),
        }),
      ]),
      observedDirectories: expect.objectContaining({
        source: ['cmd', 'internal'],
        tests: ['tests'],
      }),
    }));
    expect(surfaces?.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'manifest', paths: ['go.mod', 'pyproject.toml'] }),
      expect.objectContaining({ kind: 'directory', role: 'source', paths: ['cmd', 'internal'] }),
      expect.objectContaining({
        kind: 'verification_surface',
        labels: ['go module verification commands', 'pytest command surface', 'ruff command surface'],
      }),
    ]));
  });
});

async function collectProjectDashboard(
  workspaceRoot: string,
  options: { maxDepth?: number; maxEntries?: number } = {},
) {
  const service = createAwarenessService({
    providers: [createCodingAwarenessProvider({
      now: () => new Date('2026-05-11T12:00:00.000Z'),
      nextId: () => 'awareness-project-dashboard-test',
    })],
  });

  return service.collect({
    domain: 'coding',
    profile: 'project_dashboard',
    workspaceRoot,
    maxDepth: options.maxDepth,
    maxEntries: options.maxEntries,
  });
}

function createGitWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'heddle-awareness-git-'));
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root });
  writeFileSync(join(root, 'README.md'), 'hello\nworld\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: root, stdio: 'ignore' });
  return root;
}
