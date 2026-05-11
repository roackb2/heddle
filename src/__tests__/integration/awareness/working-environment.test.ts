import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAwarenessService } from '../../../core/awareness/service.js';
import { createCodingAwarenessProvider } from '../../../core/awareness/domains/coding/provider.js';
import { createWorkingEnvironmentTool } from '../../../core/tools/toolkits/coding-awareness/working-environment.js';

describe('coding working environment awareness', () => {
  it('reports a clean git workspace with repo root, branch, and short commit', async () => {
    const root = createGitWorkspace();
    const realRoot = realpathSync(root);
    const snapshot = await collectWorkingEnvironment(root);
    const section = snapshot.sections[0];

    expect(section).toBeDefined();
    expect(section?.type).toBe('working_environment');
    expect(section?.data).toMatchObject({
      workspaceRoot: root,
      gitRepositoryRoot: realRoot,
      isGitRepository: true,
      isDirty: false,
      gitBranch: expect.any(String),
      gitShortCommit: expect.stringMatching(/^[0-9a-f]{7,}$/),
      paths: {
        staged: [],
        modified: [],
        deleted: [],
        untracked: [],
        renamed: [],
      },
    });
    expect(snapshot.limits).toEqual([]);
  });

  it('reports dirty, staged, untracked, deleted, and renamed paths while excluding .heddle state', async () => {
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

    const snapshot = await collectWorkingEnvironment(root);
    const environment = snapshot.sections[0]?.data;

    expect(environment).toBeDefined();
    expect(environment?.isDirty).toBe(true);
    expect(environment?.paths.staged).toEqual(expect.arrayContaining(['README.md', 'new-file.txt', 'staged.txt']));
    expect(environment?.paths.modified).toEqual(['README.md']);
    expect(environment?.paths.deleted).toEqual(['delete-me.txt']);
    expect(environment?.paths.untracked).toEqual(['truly-untracked.txt']);
    expect(environment?.paths.renamed).toEqual([{ from: 'rename-from.txt', to: 'rename-to.txt' }]);
    expect(environment?.paths.staged).not.toContain('.heddle/ignored-state.json');
    expect(environment?.paths.staged).not.toContain('node_modules/ignored-runtime.js');
    expect(JSON.stringify(environment)).not.toContain('.heddle');
    expect(JSON.stringify(environment)).not.toContain('node_modules');
    expect(snapshot.limits).toContainEqual(expect.objectContaining({
      kind: 'omitted',
      subject: 'git working tree paths',
    }));
  });

  it('degrades gracefully outside a git workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'heddle-awareness-non-git-'));
    const snapshot = await collectWorkingEnvironment(root);
    const environment = snapshot.sections[0]?.data;

    expect(environment).toMatchObject({
      workspaceRoot: root,
      isGitRepository: false,
      isDirty: false,
      paths: {
        staged: [],
        modified: [],
        deleted: [],
        untracked: [],
        renamed: [],
      },
    });
    expect(snapshot.limits).toContainEqual({
      kind: 'not_applicable',
      subject: 'git',
      detail: 'Workspace is not inside a git work tree.',
    });
  });

  it('truncates oversized path groups and reports the limit', async () => {
    const root = createGitWorkspace();

    for (let index = 0; index < 24; index += 1) {
      writeFileSync(join(root, `untracked-${index}.txt`), `file ${index}\n`);
    }

    const snapshot = await collectWorkingEnvironment(root);
    const environment = snapshot.sections[0]?.data;

    expect(environment?.paths.untracked).toHaveLength(20);
    expect(snapshot.limits).toContainEqual({
      kind: 'truncated',
      subject: 'untracked paths',
      detail: 'Showing 20 of 24 entries; 4 more omitted from the summary.',
    });
  });

  it('exposes the default tool and formats the summary from the awareness service', async () => {
    const root = createGitWorkspace();
    const realRoot = realpathSync(root);
    writeFileSync(join(root, 'README.md'), 'hello\nworld\nmodified\n');

    const tool = createWorkingEnvironmentTool({ workspaceRoot: root });
    const result = await tool.execute({});

    expect(result).toEqual({
      ok: true,
      output: expect.stringContaining(`Working environment for ${root}`),
    });
    expect(result.output).toContain('Git repository: yes');
    expect(result.output).toContain(`Git repo root: ${realRoot}`);
    expect(result.output).toContain('Modified paths: README.md');
    expect(result.output).toContain('Collected:');
    expect(result.output).toContain('Sources:');
  });
});

async function collectWorkingEnvironment(workspaceRoot: string) {
  const service = createAwarenessService({
    providers: [createCodingAwarenessProvider({
      now: () => new Date('2026-05-11T12:00:00.000Z'),
      nextId: () => 'awareness-working-environment-test',
    })],
  });

  return service.collect({
    domain: 'coding',
    profile: 'working_environment',
    workspaceRoot,
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
