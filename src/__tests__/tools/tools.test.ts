import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createListFilesTool, listFilesTool } from '../../core/tools/list-files.js';
import { createReadFileTool, readFileTool } from '../../core/tools/read-file.js';
import { createEditFileTool, editFileTool, previewEditFileInput } from '../../core/tools/edit-file.js';
import { createDeleteFileTool, deleteFileTool } from '../../core/tools/delete-file.js';
import { createMoveFileTool, moveFileTool } from '../../core/tools/move-file.js';
import { updatePlanTool } from '../../core/tools/update-plan.js';
import {
  classifyShellCommandPolicy,
  createRunShellInspectTool,
  createRunShellMutateTool,
  DEFAULT_MUTATE_RULES,
} from '../../core/tools/run-shell.js';
import { createSearchFilesTool, searchFilesTool } from '../../core/tools/search-files.js';
import { createWebSearchTool, webSearchTool } from '../../core/tools/web-search.js';
import { createViewImageTool, viewImageTool } from '../../core/tools/view-image.js';
import {
  createListMemoryNotesTool,
  createReadMemoryNoteTool,
  createSearchMemoryNotesTool,
  createEditMemoryNoteTool,
} from '../../core/tools/memory-notes.js';
import { createMemoryCheckpointTool } from '../../core/tools/memory-checkpoint.js';
import { createRecordKnowledgeTool } from '../../core/tools/record-knowledge.js';
import { createDefaultAgentTools } from '../../core/runtime/default-tools.js';
import { setStoredProviderCredential } from '../../core/auth/provider-credentials.js';

describe('tool input validation', () => {
  it('rejects unexpected fields for list_files', async () => {
    const result = await listFilesTool.execute({ path: '.', maxLines: 20 });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid input for list_files. Allowed fields: path. Example: { "path": "." }',
    });
  });

  it('rejects unexpected fields for read_file', async () => {
    const result = await readFileTool.execute({ path: 'README.md', query: 'tool' });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid input for read_file. Required field: path. Optional fields: maxLines, offset.',
    });
  });

  it('rejects ambiguous edit_file input', async () => {
    const result = await editFileTool.execute({ path: 'README.md', newText: 'x' });

    expect(result).toEqual({
      ok: false,
      error:
        'Invalid input for edit_file. Use either { "path", "oldText", "newText", "replaceAll?" } or { "path", "content", "createIfMissing?" }.',
    });
  });

  it('rejects invalid delete_file input', async () => {
    const result = await deleteFileTool.execute({ recursive: true });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid input for delete_file. Required field: path. Optional field: recursive.',
    });
  });

  it('rejects invalid move_file input', async () => {
    const result = await moveFileTool.execute({ from: 'a' });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid input for move_file. Required fields: from, to. Optional field: createParentDirs.',
    });
  });

  it('tool descriptions distinguish directories from files', () => {
    expect(listFilesTool.description).toContain('Use this to inspect folders, not to read file contents');
    expect(listFilesTool.description).toContain('explore an obvious nearby folder');
    expect(listFilesTool.description).toContain('may also point to nearby parent or sibling folders');
    expect(listFilesTool.description).toContain('newline-separated list of entry names');
    expect(readFileTool.description).toContain('not when you want to inspect a directory');
    expect(readFileTool.description).toContain('may also point to nearby parent or sibling folders');
    expect(readFileTool.description).toContain('Returns the file text directly');
    expect(readFileTool.description).toContain('0-based line offset');
    expect(editFileTool.description).toContain('Edit a file directly without going through shell redirection or heredocs');
    expect(editFileTool.description).toContain('Prefer this over shell commands');
    expect(editFileTool.description).toContain('exact replacement');
    expect(editFileTool.description).toContain('overwrite an existing file or create a new one explicitly');
    expect(deleteFileTool.description).toContain('Delete a file or remove a directory');
    expect(deleteFileTool.description).toContain('set recursive to true');
    expect(moveFileTool.description).toContain('Move or rename a file or directory');
    expect(moveFileTool.description).toContain('createParentDirs');
    expect(listFilesTool.description).toContain('{ "path": "." }');
    expect(listFilesTool.description).toContain('{ "path": ".." }');
    expect(readFileTool.description).toContain('{ "path": "path/to/file.txt" }');
    expect(readFileTool.description).toContain('{ "path": "../shared-notes/summary.md" }');
    expect(searchFilesTool.description).toContain('locate a specific symbol or text string');
    expect(searchFilesTool.description).toContain('Prefer searching for concrete terms');
    expect(searchFilesTool.description).toContain('may also point to nearby parent or sibling folders');
    expect(searchFilesTool.description).toContain('grep-style path:line:content format');
    expect(searchFilesTool.description).toContain('{ "query": "createUser" }');
    expect(searchFilesTool.description).toContain('{ "query": "incident", "path": "../shared-notes" }');
    expect(webSearchTool.description).toContain('Search the public web');
    expect(webSearchTool.description).toContain("active model provider's hosted web search");
    expect(webSearchTool.description).toContain('{ "query": "OpenAI Responses API web search tool" }');
    expect(viewImageTool.description).toContain('Inspect a local image file');
    expect(viewImageTool.description).toContain('{ "path": "/absolute/path/to/screenshot.png" }');
    const listMemoryTool = createListMemoryNotesTool();
    const readMemoryTool = createReadMemoryNoteTool();
    const searchMemoryTool = createSearchMemoryNotesTool();
    const editMemoryTool = createEditMemoryNoteTool();
    const recordKnowledgeTool = createRecordKnowledgeTool();
    expect(listMemoryTool.description).toContain('List markdown notes inside Heddle-managed persistent memory');
    expect(listMemoryTool.description).toContain('follow the catalog discovery path');
    expect(readMemoryTool.description).toContain('Read a Heddle-managed persistent memory note');
    expect(readMemoryTool.description).toContain('Prefer reading README.md catalogs first');
    expect(searchMemoryTool.description).toContain('Search Heddle-managed markdown memory');
    expect(searchMemoryTool.description).toContain('Use this before broad repo search');
    expect(editMemoryTool.description).toContain('Create or edit a persistent markdown note');
    expect(editMemoryTool.description).toContain('does not require approval');
    expect(editMemoryTool.requiresApproval).toBeUndefined();
    expect(recordKnowledgeTool.description).toContain('Submit a durable memory candidate');
    expect(recordKnowledgeTool.description).toContain('Prefer memory_checkpoint before final answers');
    expect(recordKnowledgeTool.description).toContain('canonical verification commands');
    expect(recordKnowledgeTool.description).toContain('repeated session patterns');
    expect(recordKnowledgeTool.description).toContain('does not directly edit memory notes');
    expect(recordKnowledgeTool.requiresApproval).toBeUndefined();
    expect(updatePlanTool.description).toContain('Record or revise a short working plan');
    expect(updatePlanTool.description).toContain('At most one item may be in_progress');
  });

  it('validates structured update_plan input', async () => {
    const result = await updatePlanTool.execute({
      explanation: 'Starting implementation.',
      plan: [
        { step: 'Inspect current flow', status: 'completed' },
        { step: 'Implement bounded change', status: 'in_progress' },
        { step: 'Verify with tests', status: 'pending' },
      ],
    });

    expect(result).toEqual({
      ok: true,
      output: {
        explanation: 'Starting implementation.',
        plan: [
          { step: 'Inspect current flow', status: 'completed' },
          { step: 'Implement bounded change', status: 'in_progress' },
          { step: 'Verify with tests', status: 'pending' },
        ],
      },
    });
  });

  it('rejects update_plan input with multiple in-progress items', async () => {
    const result = await updatePlanTool.execute({
      plan: [
        { step: 'A', status: 'in_progress' },
        { step: 'B', status: 'in_progress' },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error:
        'Invalid input for update_plan. Required field: plan. Optional field: explanation. Each plan item must have step and status (pending, in_progress, completed), with at most one in_progress item.',
    });
  });
});

describe('workspace-bound default tools', () => {
  it('resolves relative file tools from the configured workspace root instead of process cwd', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'heddle-tools-workspace-'));
    const processRoot = await mkdtemp(join(tmpdir(), 'heddle-tools-process-'));
    await writeFile(join(workspaceRoot, 'README.md'), 'workspace readme\n');
    await writeFile(join(processRoot, 'README.md'), 'process readme\n');

    const previousCwd = process.cwd();
    try {
      process.chdir(processRoot);

      const listResult = await createListFilesTool({ workspaceRoot }).execute({ path: '.' });
      expect(listResult).toEqual({ ok: true, output: 'README.md' });

      const readResult = await createReadFileTool({ workspaceRoot }).execute({ path: 'README.md' });
      expect(readResult).toEqual({ ok: true, output: 'workspace readme\n' });

      const editResult = await createEditFileTool({ workspaceRoot }).execute({
        path: 'README.md',
        oldText: 'workspace',
        newText: 'selected workspace',
      });
      expect(editResult.ok).toBe(true);
      await expect(readFile(join(workspaceRoot, 'README.md'), 'utf8')).resolves.toBe('selected workspace readme\n');
      await expect(readFile(join(processRoot, 'README.md'), 'utf8')).resolves.toBe('process readme\n');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('runs shell commands in the configured workspace root instead of process cwd', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'heddle-shell-workspace-'));
    const processRoot = await mkdtemp(join(tmpdir(), 'heddle-shell-process-'));

    const previousCwd = process.cwd();
    try {
      process.chdir(processRoot);

      const result = await createRunShellInspectTool({ cwd: workspaceRoot }).execute({ command: 'pwd' });
      const resolvedWorkspaceRoot = await realpath(workspaceRoot);

      expect(result.ok).toBe(true);
      expect(result.output).toMatchObject({
        command: 'pwd',
        exitCode: 0,
        stdout: resolvedWorkspaceRoot,
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('binds generated default tools to the selected workspace root', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'heddle-default-tools-workspace-'));
    const processRoot = await mkdtemp(join(tmpdir(), 'heddle-default-tools-process-'));
    await writeFile(join(workspaceRoot, 'package.json'), '{"name":"selected"}\n');
    await writeFile(join(processRoot, 'package.json'), '{"name":"process"}\n');

    const previousCwd = process.cwd();
    try {
      process.chdir(processRoot);
      const tools = createDefaultAgentTools({
        model: 'gpt-5.1-codex-mini',
        workspaceRoot,
        memoryMode: 'none',
      });
      const readTool = tools.find((tool) => tool.name === 'read_file');
      const shellTool = tools.find((tool) => tool.name === 'run_shell_inspect');

      expect(readTool).toBeDefined();
      expect(shellTool).toBeDefined();
      await expect(readTool?.execute({ path: 'package.json' })).resolves.toEqual({
        ok: true,
        output: '{"name":"selected"}\n',
      });

      const shellResult = await shellTool?.execute({ command: 'pwd' });
      const resolvedWorkspaceRoot = await realpath(workspaceRoot);
      expect(shellResult?.ok).toBe(true);
      expect(shellResult?.output).toMatchObject({ stdout: resolvedWorkspaceRoot });
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe('tool path mismatch guidance', () => {
  it('tells the caller to use read_file when list_files receives a file path', async () => {
    const result = await listFilesTool.execute({ path: 'README.md' });

    expect(result).toEqual({
      ok: false,
      error: `Failed to list ${join(process.cwd(), 'README.md')}: path is a file, not a directory. Use read_file for file contents.`,
    });
  });

  it('tells the caller to use list_files when read_file receives a directory path', async () => {
    const result = await readFileTool.execute({ path: 'src' });

    expect(result).toEqual({
      ok: false,
      error: `Failed to read ${join(process.cwd(), 'src')}: path is a directory, not a file. Use list_files to inspect directories.`,
    });
  });
});

describe('readFileTool', () => {
  it('supports paging into later lines with offset and maxLines', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-read-offset-'));
    const filePath = join(root, 'sample.txt');
    await writeFile(filePath, ['zero', 'one', 'two', 'three', 'four'].join('\n'));
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      const result = await readFileTool.execute({
        path: 'sample.txt',
        offset: 2,
        maxLines: 2,
      });

      expect(result).toEqual({
        ok: true,
        output: 'two\nthree',
      });
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe('searchFilesTool', () => {
  it('ignores generated directories like dist and node_modules by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-search-'));
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'dist'));
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'src', 'main.ts'), 'const needle = true;\n');
    await writeFile(join(root, 'dist', 'generated.ts'), 'const needle = true;\n');
    await writeFile(join(root, 'node_modules', 'pkg.ts'), 'const needle = true;\n');

    const result = await searchFilesTool.execute({ query: 'needle', path: root });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('src/main.ts');
    expect(result.output).not.toContain('dist/generated.ts');
    expect(result.output).not.toContain('node_modules/pkg.ts');
  });

  it('supports project-specific excluded directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-search-config-'));
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'vendor'));
    await writeFile(join(root, 'src', 'main.ts'), 'const needle = true;\n');
    await writeFile(join(root, 'vendor', 'hidden.ts'), 'const needle = true;\n');

    const tool = createSearchFilesTool({ excludedDirs: ['vendor'] });
    const result = await tool.execute({ query: 'needle', path: root });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('src/main.ts');
    expect(result.output).not.toContain('vendor/hidden.ts');
  });

  it('searches inside an explicitly targeted excluded directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-search-state-'));
    await mkdir(join(root, '.heddle'));
    await mkdir(join(root, '.heddle', 'traces'));
    await writeFile(join(root, '.heddle', 'traces', 'trace-1.json'), '{"needle":true}\n');

    const result = await searchFilesTool.execute({ query: 'needle', path: join(root, '.heddle') });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('.heddle/traces/trace-1.json');
  });
});

describe('webSearchTool', () => {
  it('rejects invalid input', async () => {
    const result = await webSearchTool.execute({ query: 'docs', mode: 'fast' });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid input for web_search. Required field: query. Optional field: contextSize ("low", "medium", or "high").',
    });
  });

  it('fails clearly when no OpenAI key is available', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('PERSONAL_OPENAI_API_KEY', '');

    try {
      const result = await webSearchTool.execute({ query: 'OpenAI Responses API web search tool' });

      expect(result).toEqual({
        ok: false,
        error: 'web_search requires OPENAI_API_KEY (or PERSONAL_OPENAI_API_KEY) when the active model provider is OpenAI.',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('fails clearly when OAuth is active but no stored OpenAI credential can be loaded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-web-search-oauth-missing-'));
    const credentialStorePath = join(root, 'auth.json');
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');

    const result = await createWebSearchTool({
      model: 'gpt-5.4',
      providerCredentialSource: {
        type: 'oauth',
        provider: 'openai',
        accountId: 'account-123',
        expiresAt: Date.now() + 60_000,
      },
      credentialStorePath,
    }).execute({ query: 'OpenAI Responses API web search tool' });

    expect(result).toEqual({
      ok: false,
      error: 'web_search could not load the stored OpenAI account sign-in credential for this workspace. Sign in again with `heddle auth login openai`, or set OPENAI_API_KEY to use Platform API-key mode.',
    });
  });

  it('uses the OAuth-backed OpenAI transport for web search when a stored credential is available', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-web-search-oauth-success-'));
    const credentialStorePath = join(root, 'auth.json');
    writeFileSync(credentialStorePath, '{}\n');
    setStoredProviderCredential({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 120_000,
      accountId: 'account-123',
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
    }, credentialStorePath);

    const requests: Array<{ url: string; headers: Headers; body: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: String(init?.body ?? ''),
      });
      return new Response([
        'event: response.output_item.done',
        'data: {"type":"response.output_item.done","item":{"id":"ws_1","type":"web_search_call","status":"completed","action":{"type":"search","sources":[{"type":"url","url":"https://platform.openai.com/docs"}]}}}',
        '',
        'event: response.output_text.done',
        'data: {"type":"response.output_text.done","text":"Hosted search summary"}',
        '',
      ].join('\n'), {
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetchImpl);

    const result = await createWebSearchTool({
      model: 'gpt-5.4',
      providerCredentialSource: {
        type: 'oauth',
        provider: 'openai',
        accountId: 'account-123',
        expiresAt: Date.now() + 60_000,
      },
      credentialStorePath,
    }).execute({ query: 'OpenAI Responses API web search tool', contextSize: 'high' });

    expect(result).toEqual({
      ok: true,
      output: {
        provider: 'openai',
        model: 'gpt-5.4',
        summary: 'Hosted search summary',
        citations: [{ title: 'https://platform.openai.com/docs', url: 'https://platform.openai.com/docs' }],
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer access-token');
    expect(requests[0]?.headers.get('ChatGPT-Account-Id')).toBe('account-123');
    const body = JSON.parse(requests[0]?.body ?? '{}') as {
      model?: string;
      store?: boolean;
      stream?: boolean;
      instructions?: string;
      include?: string[];
      input?: Array<{ type?: string; role?: string; content?: string }>;
      tools?: Array<{ type?: string; search_context_size?: string }>;
    };
    expect(body.model).toBe('gpt-5.4');
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.instructions).toContain('Search the web and answer concisely');
    expect(body.include).toEqual(['web_search_call.action.sources']);
    expect(body.input).toEqual([{ type: 'message', role: 'user', content: 'OpenAI Responses API web search tool' }]);
    expect(body.tools).toEqual([{ type: 'web_search', search_context_size: 'high' }]);
  });
});

describe('viewImageTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('rejects invalid input', async () => {
    const result = await viewImageTool.execute({ prompt: 'describe it' });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid input for view_image. Required field: path. Optional field: prompt.',
    });
  });

  it('rejects unsupported file types before any provider call', async () => {
    const result = await viewImageTool.execute({ path: 'notes.txt' });

    expect(result).toEqual({
      ok: false,
      error: 'view_image supports .png, .jpg, .jpeg, .gif, and .webp files.',
    });
  });

  it('fails clearly when no OpenAI key is available for the default provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-view-image-'));
    const imagePath = join(root, 'screen.png');
    await writeFile(imagePath, 'fake');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('PERSONAL_OPENAI_API_KEY', '');

    try {
      const result = await viewImageTool.execute({ path: imagePath });

      expect(result).toEqual({
        ok: false,
        error: 'view_image requires OPENAI_API_KEY (or PERSONAL_OPENAI_API_KEY) when the active model provider is OpenAI.',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('fails clearly when OAuth is active but no stored OpenAI credential can be loaded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-view-image-oauth-missing-'));
    const imagePath = join(root, 'screen.png');
    const credentialStorePath = join(root, 'auth.json');
    await writeFile(imagePath, 'fake');
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');

    const result = await createViewImageTool({
      model: 'gpt-5.4',
      providerCredentialSource: {
        type: 'oauth',
        provider: 'openai',
        accountId: 'account-123',
        expiresAt: Date.now() + 60_000,
      },
      credentialStorePath,
    }).execute({ path: imagePath });

    expect(result).toEqual({
      ok: false,
      error: 'view_image could not load the stored OpenAI account sign-in credential for this workspace. Sign in again with `heddle auth login openai`, or set OPENAI_API_KEY to use Platform API-key mode.',
    });
  });

  it('fails clearly for OAuth when the selected model is not account-sign-in compatible', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-view-image-oauth-model-'));
    const imagePath = join(root, 'screen.png');
    const credentialStorePath = join(root, 'auth.json');
    await writeFile(imagePath, 'fake');
    writeFileSync(credentialStorePath, '{}\n');
    setStoredProviderCredential({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 120_000,
      accountId: 'account-123',
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
    }, credentialStorePath);

    const result = await createViewImageTool({
      model: 'o3',
      providerCredentialSource: {
        type: 'oauth',
        provider: 'openai',
        accountId: 'account-123',
        expiresAt: Date.now() + 60_000,
      },
      credentialStorePath,
    }).execute({ path: imagePath });

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('OpenAI account sign-in is not enabled for model o3.'),
    });
    expect(result.error).toContain('set OPENAI_API_KEY');
    expect(result.error).toContain('image inspection');
  });

  it('uses the OAuth-backed OpenAI transport for image inspection when a stored credential is available', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-view-image-oauth-success-'));
    const imagePath = join(root, 'screen.png');
    const credentialStorePath = join(root, 'auth.json');
    await writeFile(imagePath, 'fake-image-data');
    writeFileSync(credentialStorePath, '{}\n');
    setStoredProviderCredential({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 120_000,
      accountId: 'account-123',
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
    }, credentialStorePath);

    const requests: Array<{ url: string; headers: Headers; body: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: String(init?.body ?? ''),
      });
      const body = [
        'event: response.created',
        'data: {"type":"response.created","response":{"id":"resp_1","object":"response","created_at":1777301834,"status":"in_progress","model":"gpt-5.4","output":[]}}',
        '',
        'event: response.output_text.delta',
        'data: {"type":"response.output_text.delta","delta":"UI screenshot ","content_index":0,"item_id":"msg_1","output_index":0,"sequence_number":1}',
        '',
        'event: response.output_text.done',
        'data: {"type":"response.output_text.done","text":"UI screenshot summary","content_index":0,"item_id":"msg_1","output_index":0,"sequence_number":2}',
        '',
        'event: response.completed',
        'data: {"type":"response.completed","response":{"id":"resp_1","object":"response","created_at":1777301834,"status":"completed","completed_at":1777301835,"model":"gpt-5.4","output_text":"UI screenshot summary","output":[],"usage":{"input_tokens":10,"input_tokens_details":{"cached_tokens":0},"output_tokens":5,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":15}}}',
        '',
      ].join('\n');
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetchImpl);

    const result = await createViewImageTool({
      model: 'gpt-5.4',
      providerCredentialSource: {
        type: 'oauth',
        provider: 'openai',
        accountId: 'account-123',
        expiresAt: Date.now() + 60_000,
      },
      credentialStorePath,
    }).execute({ path: imagePath, prompt: 'Summarize the screenshot.' });

    expect(result).toEqual({
      ok: true,
      output: {
        provider: 'openai',
        model: 'gpt-5.4',
        path: imagePath,
        summary: 'UI screenshot summary',
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer access-token');
    expect(requests[0]?.headers.get('ChatGPT-Account-Id')).toBe('account-123');
    const body = JSON.parse(requests[0]?.body ?? '{}') as {
      input?: Array<{ content?: Array<{ type?: string; text?: string; image_url?: string }> }>;
    };
    expect(body.input?.[0]?.content?.[0]).toEqual({ type: 'input_text', text: 'Summarize the screenshot.' });
    expect(body.input?.[0]?.content?.[1]?.type).toBe('input_image');
    expect(body.input?.[0]?.content?.[1]?.image_url).toContain('data:image/png;base64,');
  });

  it('returns richer OAuth failure diagnostics including attempted models', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-view-image-oauth-failure-details-'));
    const imagePath = join(root, 'screen.png');
    const credentialStorePath = join(root, 'auth.json');
    await writeFile(imagePath, 'fake-image-data');
    writeFileSync(credentialStorePath, '{}\n');
    setStoredProviderCredential({
      type: 'oauth',
      provider: 'openai',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 120_000,
      accountId: 'account-123',
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
    }, credentialStorePath);

    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response('', { status: 400 });
    }));

    const result = await createViewImageTool({
      model: 'gpt-5.4',
      providerCredentialSource: {
        type: 'oauth',
        provider: 'openai',
        accountId: 'account-123',
        expiresAt: Date.now() + 60_000,
      },
      credentialStorePath,
    }).execute({ path: imagePath, prompt: 'Summarize the screenshot.' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Image view failed: OpenAI image inspection failed for model');
    expect(result.error).toContain('OpenAI account sign-in mode');
    expect(result.error).toContain('status 400');
    expect(result.error).toContain('Attempted models:');
    expect(result.error).toContain('gpt-5.4');
    expect(result.error).toContain('gpt-5.4-mini');
  });
});

describe('memory note tools', () => {
  it('lists markdown notes recursively inside the memory root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-memory-list-'));
    await mkdir(join(root, 'architecture'), { recursive: true });
    await writeFile(join(root, 'project-summary.md'), '# Summary\n');
    await writeFile(join(root, 'architecture', 'auth.md'), '# Auth\n');
    await writeFile(join(root, 'architecture', 'notes.txt'), 'ignore\n');
    const tool = createListMemoryNotesTool({ memoryRoot: root });

    const result = await tool.execute({});

    expect(result).toEqual({
      ok: true,
      output: ['architecture/auth.md', 'project-summary.md'].join('\n'),
    });
  });

  it('reads memory notes with paging support', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-memory-read-'));
    await writeFile(join(root, 'project-summary.md'), ['zero', 'one', 'two'].join('\n'));
    const tool = createReadMemoryNoteTool({ memoryRoot: root });

    const result = await tool.execute({ path: 'project-summary.md', offset: 1, maxLines: 1 });

    expect(result).toEqual({
      ok: true,
      output: 'one',
    });
  });

  it('searches memory notes with grep-style output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-memory-search-'));
    await writeFile(join(root, 'known-issues.md'), ['first line', 'test command is yarn test', 'another'].join('\n'));
    const tool = createSearchMemoryNotesTool({ memoryRoot: root });

    const result = await tool.execute({ query: 'test command' });

    expect(result).toEqual({
      ok: true,
      output: 'known-issues.md:2:test command is yarn test',
    });
  });

  it('edits memory notes inside the memory root without approval gating', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-memory-write-'));
    await writeFile(join(root, 'project-summary.md'), '# Summary\nKnown fact');
    const tool = createEditMemoryNoteTool({ memoryRoot: root });

    const replaced = await tool.execute({
      path: 'project-summary.md',
      oldText: 'Known fact',
      newText: 'Updated fact',
    });

    expect(replaced).toEqual({
      ok: true,
      output: {
        path: 'project-summary.md',
        action: 'replaced',
        matchCount: 1,
        bytesWritten: Buffer.byteLength('# Summary\nUpdated fact', 'utf8'),
        diff: {
          path: 'project-summary.md',
          action: 'replaced',
          diff: ['--- a/project-summary.md', '+++ b/project-summary.md', '@@ -1,2 +1,2 @@', ' # Summary', '-Known fact', '+Updated fact'].join('\n'),
          truncated: false,
        },
      },
    });
  });

  it('refuses to access paths outside the memory root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-memory-scope-'));
    const readTool = createReadMemoryNoteTool({ memoryRoot: root });
    const editTool = createEditMemoryNoteTool({ memoryRoot: root });

    const readResult = await readTool.execute({ path: '../outside.md' });
    const editResult = await editTool.execute({
      path: '../outside.md',
      content: 'bad',
      createIfMissing: true,
    });

    expect(readResult.ok).toBe(false);
    expect(readResult.error).toContain('Memory note paths must stay inside');
    expect(editResult.ok).toBe(false);
    expect(editResult.error).toContain('memory note paths must stay inside');
  });

  it('records knowledge candidates under memory maintenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-record-knowledge-'));
    const tool = createRecordKnowledgeTool({
      memoryRoot: root,
      now: () => new Date('2026-04-24T00:00:00.000Z'),
      nextId: () => 'candidate-test',
    });

    const result = await tool.execute({
      summary: 'The canonical verification command is yarn build.',
      evidence: ['Verified during implementation.'],
      categoryHint: 'operations',
      importance: 'high',
      confidence: 'tool-verified',
      sourceRefs: ['package.json', 'command:yarn build'],
    });

    expect(result).toEqual({
      ok: true,
      output: {
        id: 'candidate-test',
        path: '_maintenance/candidates.jsonl',
        status: 'pending',
        message: 'Knowledge candidate recorded for memory maintenance.',
      },
    });
    const raw = await readFile(join(root, '_maintenance', 'candidates.jsonl'), 'utf8');
    expect(JSON.parse(raw.trim())).toEqual({
      id: 'candidate-test',
      recordedAt: '2026-04-24T00:00:00.000Z',
      status: 'pending',
      summary: 'The canonical verification command is yarn build.',
      evidence: ['Verified during implementation.'],
      categoryHint: 'operations',
      importance: 'high',
      confidence: 'tool-verified',
      sourceRefs: ['package.json', 'command:yarn build'],
    });
  });

  it('uses memory checkpoint to either skip or record a durable candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-memory-checkpoint-'));
    const tool = createMemoryCheckpointTool({
      memoryRoot: root,
      now: () => new Date('2026-04-24T00:00:00.000Z'),
      nextId: () => 'candidate-checkpoint',
    });

    await expect(tool.execute({
      decision: 'skip',
      rationale: 'The turn only answered a one-off question.',
      candidate: null,
    })).resolves.toMatchObject({
      ok: true,
      output: {
        decision: 'skip',
        rationale: 'The turn only answered a one-off question.',
      },
    });

    await expect(tool.execute({
      decision: 'record',
      rationale: 'The user stated a durable preference.',
      candidate: {
        summary: 'Use the short ticket format for future tickets.',
        categoryHint: 'workflows',
        importance: 'high',
        confidence: 'user-stated',
        sourceRefs: ['conversation'],
      },
    })).resolves.toMatchObject({
      ok: true,
      output: {
        decision: 'record',
        id: 'candidate-checkpoint',
        path: '_maintenance/candidates.jsonl',
      },
    });

    await expect(readFile(join(root, '_maintenance', 'candidates.jsonl'), 'utf8')).resolves.toContain('Use the short ticket format');
  });

  it('rejects invalid record_knowledge input and unsafe source refs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-record-invalid-'));
    const tool = createRecordKnowledgeTool({ memoryRoot: root });

    await expect(tool.execute({ summary: 'ok', unexpected: true })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('Invalid input for record_knowledge'),
    });
    await expect(tool.execute({ summary: 'ok', sourceRefs: ['../outside.md'] })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('unsafe sourceRef'),
    });
    await expect(tool.execute({ summary: 'ok', sourceRefs: ['/tmp/outside.md'] })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('unsafe sourceRef'),
    });
    await expect(tool.execute({ summary: 'ok', sourceRefs: ['https://example.com/file.md'] })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('unsafe sourceRef'),
    });
    await expect(tool.execute({ summary: 'ok', sourceRefs: ['trace-123', 'session-456', 'command:git status'] })).resolves.toMatchObject({
      ok: true,
    });
  });

  it('refuses secret-like record_knowledge content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-record-secret-'));
    const tool = createRecordKnowledgeTool({ memoryRoot: root });

    const result = await tool.execute({
      summary: 'The API key is sk-test-secret',
      confidence: 'user-stated',
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('secret-like content'),
    });
  });
});

describe('file mutation tools', () => {
  it('deletes a file through delete_file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-delete-file-'));
    const filePath = join(root, 'obsolete.txt');
    await writeFile(filePath, 'remove me');
    const tool = createDeleteFileTool({ workspaceRoot: root });

    const result = await tool.execute({ path: 'obsolete.txt' });

    expect(result).toEqual({
      ok: true,
      output: {
        path: filePath,
        deleted: true,
        kind: 'file',
        recursive: false,
      },
    });
    await expect(readFile(filePath, 'utf8')).rejects.toThrow();
  });

  it('refuses to delete a directory without recursive true', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-delete-dir-'));
    await mkdir(join(root, 'old-dir'));
    const tool = createDeleteFileTool({ workspaceRoot: root });

    const result = await tool.execute({ path: 'old-dir' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Refusing to delete directory');
  });

  it('moves a file through move_file and can create parent directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-move-file-'));
    const fromPath = join(root, 'draft.txt');
    const toPath = join(root, 'docs', 'draft.txt');
    await writeFile(fromPath, 'move me');
    const tool = createMoveFileTool({ workspaceRoot: root });

    const result = await tool.execute({ from: 'draft.txt', to: 'docs/draft.txt', createParentDirs: true });

    expect(result).toEqual({
      ok: true,
      output: {
        from: fromPath,
        to: toPath,
        moved: true,
        kind: 'file',
        createdParentDirs: true,
      },
    });
    await expect(readFile(toPath, 'utf8')).resolves.toBe('move me');
    await expect(readFile(fromPath, 'utf8')).rejects.toThrow();
  });

  it('creates a new file when explicitly allowed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-edit-create-'));
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      const result = await editFileTool.execute({
        path: 'notes/output.txt',
        content: 'hello\n',
        createIfMissing: true,
      });

      expect(result).toEqual({
        ok: true,
        output: {
          path: 'notes/output.txt',
          action: 'created',
          bytesWritten: Buffer.byteLength('hello\n', 'utf8'),
          diff: {
            path: 'notes/output.txt',
            action: 'created',
            diff: ['--- /dev/null', '+++ b/notes/output.txt', '@@ -1,0 +1 @@', '+hello'].join('\n'),
            truncated: false,
          },
        },
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('replaces an exact single match in an existing file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-edit-replace-'));
    const filePath = join(root, 'sample.ts');
    await writeFile(filePath, 'const mode = "old";\n');
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      const result = await editFileTool.execute({
        path: 'sample.ts',
        oldText: '"old"',
        newText: '"new"',
      });

      expect(result).toEqual({
        ok: true,
        output: {
          path: 'sample.ts',
          action: 'replaced',
          matchCount: 1,
          bytesWritten: Buffer.byteLength('const mode = "new";\n', 'utf8'),
          diff: {
            path: 'sample.ts',
            action: 'replaced',
            diff: ['--- a/sample.ts', '+++ b/sample.ts', '@@ -1 +1 @@', '-const mode = "old";', '+const mode = "new";'].join('\n'),
            truncated: false,
          },
        },
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('rejects ambiguous replacements unless replaceAll is set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-edit-multi-'));
    const filePath = join(root, 'sample.ts');
    await writeFile(filePath, 'value\nvalue\n');
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      const result = await editFileTool.execute({
        path: 'sample.ts',
        oldText: 'value',
        newText: 'next',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('edit_file found 2 matches for oldText');
      expect(result.error).toContain('sample.ts');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('allows writing outside the current workspace root when the runtime permits it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-edit-scope-'));
    const outsidePath = join(root, '..', `outside-${Date.now()}.txt`);
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      const result = await editFileTool.execute({
        path: outsidePath,
        content: 'ok\n',
        createIfMissing: true,
      });

      expect(result.ok).toBe(true);
      expect(result.output).toMatchObject({
        path: outsidePath,
        action: 'created',
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('builds an approval preview for edit_file before the write happens', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-edit-preview-'));
    const filePath = join(root, 'sample.ts');
    await writeFile(filePath, 'const mode = "old";\n');
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      const preview = await previewEditFileInput({
        path: 'sample.ts',
        oldText: '"old"',
        newText: '"new"',
      });

      expect(preview).toEqual({
        path: 'sample.ts',
        action: 'replaced',
        diff: ['--- a/sample.ts', '+++ b/sample.ts', '@@ -1 +1 @@', '-const mode = "old";', '+const mode = "new";'].join('\n'),
        truncated: false,
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('does not throw while previewing an edit_file write to a directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-edit-preview-dir-'));
    await mkdir(join(root, 'src'));

    await expect(previewEditFileInput({
      path: 'src',
      content: 'not a directory\n',
    }, root)).resolves.toBeUndefined();
  });

  it('returns a normal edit_file error when writing to a directory path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'heddle-edit-dir-'));
    await mkdir(join(root, 'src'));
    const tool = createEditFileTool({ workspaceRoot: root });

    const result = await tool.execute({
      path: 'src',
      content: 'not a directory\n',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Failed to read');
    expect(result.error).toContain('EISDIR');
  });
});

describe('runShell tools', () => {
  it('documents inspect-oriented shell usage and safe prefixes', () => {
    const tool = createRunShellInspectTool();

    expect(tool.name).toBe('run_shell_inspect');
    expect(tool.description).toContain('Use this for CLI-native inspection, search, diff, and git state checks');
    expect(tool.description).toContain('policy metadata');
    expect(tool.description).toContain('low-risk inspect rules');
  });

  it('documents mutate-oriented shell usage and bounded workspace actions', () => {
    const tool = createRunShellMutateTool();

    expect(tool.name).toBe('run_shell_mutate');
    expect(tool.requiresApproval).toBe(true);
    expect(tool.description).toContain('Use this when inspection is not enough');
    expect(tool.description).toContain('inline scripts or broader shell expressiveness');
    expect(tool.description).toContain('host-side execution rules');
  });

  it('allows read-only pipes in inspect mode', async () => {
    const tool = createRunShellInspectTool();
    const result = await tool.execute({ command: 'cat README.md | head -n 1' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'cat README.md | head -n 1',
      exitCode: 0,
      policy: {
        binary: 'cat',
        scope: 'inspect',
        risk: 'low',
      },
    });
  });

  it('allows numbered file inspection in inspect mode', async () => {
    const tool = createRunShellInspectTool();
    const result = await tool.execute({ command: 'nl -ba README.md' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'nl -ba README.md',
      exitCode: 0,
      policy: {
        binary: 'nl',
        scope: 'inspect',
        risk: 'low',
        capability: 'file_inspection',
      },
    });
  });

  it('still rejects blocked shell operators in inspect mode', async () => {
    const tool = createRunShellInspectTool();
    const result = await tool.execute({ command: 'ls > out.txt' });

    expect(result).toEqual({
      ok: false,
      error: 'Command not allowed. Inspect mode permits read-only pipes, but redirects, command chaining, backgrounding, and subshells are blocked. If the command is still needed, retry with run_shell_mutate.',
    });
  });

  it('returns structured stdout and exit code for successful inspect commands', async () => {
    const tool = createRunShellInspectTool();
    const result = await tool.execute({ command: 'pwd' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'pwd',
      exitCode: 0,
      stderr: '',
      policy: {
        binary: 'pwd',
        scope: 'inspect',
        risk: 'low',
        capability: 'environment_inspection',
      },
    });
    expect(typeof (result.output as { stdout: unknown }).stdout).toBe('string');
  });

  it('returns structured failure details for allowed inspect commands that exit non-zero', async () => {
    const tool = createRunShellInspectTool();
    const result = await tool.execute({ command: 'grep definitely-not-present README.md' });

    expect(result).toMatchObject({
      ok: false,
      error: 'Shell command failed with exit code 1',
      output: {
        command: 'grep definitely-not-present README.md',
        exitCode: 1,
      },
    });
  });

  it('rejects invalid inspect input using the new tool name', async () => {
    const tool = createRunShellInspectTool();
    const result = await tool.execute({ path: '.' });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid input for run_shell_inspect. Required field: command.',
    });
  });

  it('ignores unrelated extra input fields for inspect commands when command is present', async () => {
    const tool = createRunShellInspectTool();
    const result = await tool.execute({ command: 'pwd', maxLines: 400 });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'pwd',
      exitCode: 0,
    });
  });

  it('allows bounded mutate commands with structured output', async () => {
    const tool = createRunShellMutateTool();
    const result = await tool.execute({ command: 'tsc --version' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'tsc --version',
      exitCode: 0,
      stderr: '',
    });
  });

  it('ignores unrelated extra input fields for mutate commands when command is present', async () => {
    const tool = createRunShellMutateTool();
    const result = await tool.execute({ command: 'tsc --version', rationale: 'verify compiler exists' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'tsc --version',
      exitCode: 0,
    });
  });

  it('does not treat > inside quoted node -e source as a shell redirect', async () => {
    const tool = createRunShellMutateTool();
    const result = await tool.execute({ command: 'node -e "const fn = () => 1; console.log(fn())"' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'node -e "const fn = () => 1; console.log(fn())"',
      exitCode: 0,
    });
  });

  it('allows pipes in mutate mode because mutate is approval-gated', async () => {
    const tool = createRunShellMutateTool();
    const result = await tool.execute({ command: 'echo ok | cat' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'echo ok | cat',
      exitCode: 0,
      policy: {
        binary: 'echo',
        scope: 'workspace',
        risk: 'unknown',
        capability: 'unknown_workspace',
        reason: 'unclassified workspace command requiring explicit approval',
      },
    });
  });

  it('allows approved dependency install commands through mutate policy', async () => {
    const tool = createRunShellMutateTool();
    const result = await tool.execute({ command: 'yarn add --help' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'yarn add --help',
      exitCode: 0,
      policy: {
        binary: 'yarn',
        scope: 'workspace',
        risk: 'medium',
        capability: 'dependency',
        reason: 'workspace dependency install command',
      },
    });
  });

  it('allows project-local script execution through mutate policy metadata', async () => {
    const tool = createRunShellMutateTool();
    const result = await tool.execute({ command: 'yarn run --help' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'yarn run --help',
      exitCode: 0,
      policy: {
        binary: 'yarn',
        scope: 'workspace',
        risk: 'medium',
        capability: 'project_script',
        reason: 'workspace project script command',
      },
    });
  });

  it('treats unclassified mutate commands as approval-gated unknown workspace commands instead of hard rejecting them', async () => {
    const tool = createRunShellMutateTool();
    const result = await tool.execute({ command: 'pwd' });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      command: 'pwd',
      exitCode: 0,
      policy: {
        binary: 'pwd',
        scope: 'workspace',
        risk: 'unknown',
        capability: 'unknown_workspace',
        reason: 'unclassified workspace command requiring explicit approval',
      },
    });
  });

  it('treats unclassified mutate commands as approval-gated unknown commands instead of hard rejecting them', () => {
    const result = classifyShellCommandPolicy('ffmpeg -i input.mp4 output.gif', {
      toolName: 'run_shell_mutate',
      rules: DEFAULT_MUTATE_RULES,
      allowUnknown: true,
    });

    expect(result).toEqual({
      binary: 'ffmpeg',
      scope: 'workspace',
      risk: 'unknown',
      capability: 'unknown_workspace',
      reason: 'unclassified workspace command requiring explicit approval',
    });
  });

  it('allows bounded workspace file operations on mutate with policy metadata', async () => {
    const tool = createRunShellMutateTool();
    const root = await mkdtemp(join(tmpdir(), 'heddle-shell-'));
    const fromPath = join(root, 'from.txt');
    const toPath = join(root, 'to.txt');
    await writeFile(fromPath, 'hello\n');
    const previousCwd = process.cwd();
    process.chdir(root);

    try {
      const result = await tool.execute({ command: 'mv from.txt to.txt' });

      expect(result.ok).toBe(true);
      expect(result.output).toMatchObject({
        command: 'mv from.txt to.txt',
        exitCode: 0,
        policy: {
          binary: 'mv',
          scope: 'workspace',
          risk: 'medium',
          capability: 'file_operation',
        },
      });
    } finally {
      process.chdir(previousCwd);
    }

    expect(toPath).not.toBe(fromPath);
  });
});

