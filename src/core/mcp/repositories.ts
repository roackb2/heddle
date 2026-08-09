import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { McpSchemas } from './schemas.js';
import { McpServerConfigService } from './server-config-service.js';
import type {
  McpActivationStore,
  McpActivationStorePort,
  McpCatalogStore,
  McpCatalogStorePort,
  McpConfigDocument,
  McpConfigLoadResult,
  McpConfigStorePort,
} from './types.js';

const CONFIG_FILE_NAME = 'mcp.json';
const DEFAULT_CONFIG_CONTENT = JSON.stringify({ mcpServers: {} }, null, 2);

export class FileMcpConfigRepository implements McpConfigStorePort {
  private readonly workspaceRoot: string;
  private readonly stateRoot: string;

  constructor(options: { workspaceRoot: string; stateRoot: string }) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.stateRoot = resolve(options.stateRoot);
  }

  static resolvePath(stateRoot: string): string {
    return join(stateRoot, CONFIG_FILE_NAME);
  }

  read(): McpConfigLoadResult {
    const configPath = FileMcpConfigRepository.resolvePath(this.stateRoot);
    if (!existsSync(configPath)) {
      return {
        configPath,
        servers: [],
        issues: [],
      };
    }

    try {
      const parsed = McpSchemas.parseRawConfig(JSON.parse(readFileSync(configPath, 'utf8')) as unknown);
      return {
        configPath,
        ...McpServerConfigService.normalizeConfig(parsed, {
          configPath,
          workspaceRoot: this.workspaceRoot,
        }),
      };
    } catch (error) {
      return {
        configPath,
        servers: [],
        issues: [{
          code: 'config_invalid',
          path: configPath,
          message: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  ensureDocument(): McpConfigDocument {
    const configPath = FileMcpConfigRepository.resolvePath(this.stateRoot);
    if (!existsSync(configPath)) {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, `${DEFAULT_CONFIG_CONTENT}\n`, 'utf8');
    }

    return this.readDocument();
  }

  readDocument(): McpConfigDocument {
    const configPath = FileMcpConfigRepository.resolvePath(this.stateRoot);
    if (!existsSync(configPath)) {
      return {
        configPath,
        content: `${DEFAULT_CONFIG_CONTENT}\n`,
        exists: false,
        issues: [],
      };
    }

    const content = readFileSync(configPath, 'utf8');
    return {
      configPath,
      content,
      exists: true,
      issues: this.read().issues,
    };
  }

  writeDocument(content: string): McpConfigDocument {
    const configPath = FileMcpConfigRepository.resolvePath(this.stateRoot);
    const formatted = formatConfigContent(content);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, formatted, 'utf8');
    return this.readDocument();
  }
}

export class FileMcpActivationRepository implements McpActivationStorePort {
  private readonly filePath: string;

  constructor(options: { stateRoot: string }) {
    this.filePath = FileMcpActivationRepository.resolvePath(options.stateRoot);
  }

  static resolvePath(stateRoot: string): string {
    return join(stateRoot, 'mcp', 'activation.json');
  }

  read(): McpActivationStore {
    if (!existsSync(this.filePath)) {
      return McpSchemas.emptyActivationStore();
    }

    try {
      return McpSchemas.parseActivationStore(JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown);
    } catch {
      return McpSchemas.emptyActivationStore();
    }
  }

  write(store: McpActivationStore): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(McpSchemas.parseActivationStore(store), null, 2)}\n`, 'utf8');
  }
}

export class FileMcpCatalogRepository implements McpCatalogStorePort {
  private readonly filePath: string;

  constructor(options: { stateRoot: string }) {
    this.filePath = FileMcpCatalogRepository.resolvePath(options.stateRoot);
  }

  static resolvePath(stateRoot: string): string {
    return join(stateRoot, 'mcp', 'catalog.json');
  }

  read(): McpCatalogStore {
    if (!existsSync(this.filePath)) {
      return McpSchemas.emptyCatalogStore();
    }

    try {
      return McpSchemas.parseCatalogStore(JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown);
    } catch {
      return McpSchemas.emptyCatalogStore();
    }
  }

  write(store: McpCatalogStore): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(McpSchemas.parseCatalogStore(store), null, 2)}\n`, 'utf8');
  }
}

function formatConfigContent(content: string): string {
  const raw = content.trim().length > 0 ? JSON.parse(content) as unknown : { mcpServers: {} };
  return `${JSON.stringify(McpSchemas.parseRawConfig(raw), null, 2)}\n`;
}
