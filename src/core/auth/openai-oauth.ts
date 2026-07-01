import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type {
  OpenAiIdTokenClaims,
  OpenAiOAuthCallbackServer,
  OpenAiOAuthCredential,
  OpenAiOAuthLoginOptions,
  OpenAiOAuthRefreshOptions,
  OpenAiOAuthTokenResponse,
  PkceCodes,
} from './types.js';

export const OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const OPENAI_AUTH_ISSUER = 'https://auth.openai.com';
export const OPENAI_CODEX_RESPONSES_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
export const OPENAI_OAUTH_CALLBACK_PATH = '/auth/callback';
export const DEFAULT_OPENAI_OAUTH_PORT = 1455;

/**
 * OpenAI account sign-in service. It owns OAuth URL construction, callback
 * handling, token exchange/refresh, credential creation, and browser launch.
 */
export class OpenAiOAuthService {
  static generatePkceCodes(): PkceCodes {
    const verifier = OpenAiOAuthService.base64UrlEncode(randomBytes(32));
    const challenge = OpenAiOAuthService.base64UrlEncode(createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
  }

  static generateState(): string {
    return OpenAiOAuthService.base64UrlEncode(randomBytes(32));
  }

  static buildAuthorizeUrl(args: {
    redirectUri: string;
    pkce: PkceCodes;
    state: string;
    originator?: string;
  }): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OPENAI_CODEX_CLIENT_ID,
      redirect_uri: args.redirectUri,
      scope: 'openid profile email offline_access',
      code_challenge: args.pkce.challenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      state: args.state,
      originator: args.originator ?? 'heddle',
    });

    return `${OPENAI_AUTH_ISSUER}/oauth/authorize?${params.toString()}`;
  }

  static async runBrowserLogin(options: OpenAiOAuthLoginOptions = {}): Promise<OpenAiOAuthCredential> {
    const port = options.port ?? DEFAULT_OPENAI_OAUTH_PORT;
    const pkce = OpenAiOAuthService.generatePkceCodes();
    const state = OpenAiOAuthService.generateState();
    const callback = await OpenAiOAuthService.startCallbackServer({
      port,
      state,
      pkce,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    const authUrl = OpenAiOAuthService.buildAuthorizeUrl({
      redirectUri: callback.redirectUri,
      pkce,
      state,
    });

    try {
      options.onAuthorizeUrl?.(authUrl);
      if (options.openBrowser !== false) {
        await (options.openUrl ?? OpenAiOAuthService.openUrlInBrowser)(authUrl);
      }
      const tokens = await callback.tokens;
      return OpenAiOAuthService.createCredential(tokens);
    } finally {
      await callback.close();
    }
  }

  static async refreshCredential(
    credential: OpenAiOAuthCredential,
    options: { fetchImpl?: typeof fetch } = {},
  ): Promise<OpenAiOAuthCredential> {
    const tokens = await OpenAiOAuthService.refreshToken({
      refreshToken: credential.refreshToken,
      fetchImpl: options.fetchImpl,
    });
    return {
      ...OpenAiOAuthService.createCredential(tokens),
      createdAt: credential.createdAt,
      accountId: OpenAiOAuthService.extractAccountId(tokens) ?? credential.accountId,
    };
  }

  static async exchangeCode(args: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  }): Promise<OpenAiOAuthTokenResponse> {
    const fetcher = args.fetchImpl ?? fetch;
    const response = await fetcher(`${OPENAI_AUTH_ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: args.code,
        redirect_uri: args.redirectUri,
        client_id: OPENAI_CODEX_CLIENT_ID,
        code_verifier: args.codeVerifier,
      }).toString(),
      signal: args.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI OAuth token exchange failed: ${response.status}`);
    }

    return OpenAiOAuthService.normalizeTokenResponse(await response.json());
  }

  static async refreshToken(options: OpenAiOAuthRefreshOptions): Promise<OpenAiOAuthTokenResponse> {
    const fetcher = options.fetchImpl ?? fetch;
    const response = await fetcher(`${OPENAI_AUTH_ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: options.refreshToken,
        client_id: OPENAI_CODEX_CLIENT_ID,
      }).toString(),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI OAuth token refresh failed: ${response.status}`);
    }

    return OpenAiOAuthService.normalizeTokenResponse(await response.json());
  }

  static createCredential(
    tokens: OpenAiOAuthTokenResponse,
    now = Date.now(),
  ): OpenAiOAuthCredential {
    const timestamp = new Date(now).toISOString();
    return {
      type: 'oauth',
      provider: 'openai',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: now + (tokens.expires_in ?? 3600) * 1000,
      accountId: OpenAiOAuthService.extractAccountId(tokens),
      createdAt: timestamp,
      updatedAt: timestamp,
      label: 'ChatGPT/Codex OAuth',
    };
  }

  static parseJwtClaims(token: string): OpenAiIdTokenClaims | undefined {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return undefined;
    }

    try {
      return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as OpenAiIdTokenClaims;
    } catch {
      return undefined;
    }
  }

  static extractAccountId(tokens: Pick<OpenAiOAuthTokenResponse, 'id_token' | 'access_token'>): string | undefined {
    const idClaims = tokens.id_token ? OpenAiOAuthService.parseJwtClaims(tokens.id_token) : undefined;
    const idAccount = idClaims ? OpenAiOAuthService.extractAccountIdFromClaims(idClaims) : undefined;
    if (idAccount) {
      return idAccount;
    }

    const accessClaims = OpenAiOAuthService.parseJwtClaims(tokens.access_token);
    return accessClaims ? OpenAiOAuthService.extractAccountIdFromClaims(accessClaims) : undefined;
  }

  static extractAccountIdFromClaims(claims: OpenAiIdTokenClaims): string | undefined {
    return (
      claims.chatgpt_account_id
      ?? claims['https://api.openai.com/auth']?.chatgpt_account_id
      ?? claims.organizations?.find((organization) => organization.id)?.id
    );
  }

  static buildOpenUrlCommand(url: string, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
    if (platform === 'darwin') {
      return { command: 'open', args: [url] };
    }

    if (platform === 'win32') {
      const script = `Start-Process -FilePath '${OpenAiOAuthService.escapePowerShellSingleQuotedString(url)}'`;
      return {
        command: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      };
    }

    return { command: 'xdg-open', args: [url] };
  }

  private static async startCallbackServer(args: {
    port: number;
    state: string;
    pkce: PkceCodes;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  }): Promise<OpenAiOAuthCallbackServer> {
    let settled = false;
    let resolveTokens: (tokens: OpenAiOAuthTokenResponse) => void;
    let rejectTokens: (error: Error) => void;
    const tokens = new Promise<OpenAiOAuthTokenResponse>((resolve, reject) => {
      resolveTokens = resolve;
      rejectTokens = reject;
    });
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectTokens(new Error('OpenAI OAuth callback timed out'));
      }
    }, args.timeoutMs ?? 5 * 60 * 1000);
    const sockets = new Set<Socket>();

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${args.port}`);
      if (url.pathname !== OPENAI_OAUTH_CALLBACK_PATH) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        settled = true;
        const message = url.searchParams.get('error_description') ?? error;
        rejectTokens(new Error(message));
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(OpenAiOAuthService.renderCallbackHtml('Authorization failed', message));
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code) {
        settled = true;
        rejectTokens(new Error('OpenAI OAuth callback did not include a code'));
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(OpenAiOAuthService.renderCallbackHtml('Authorization failed', 'Missing authorization code.'));
        return;
      }
      if (state !== args.state) {
        settled = true;
        rejectTokens(new Error('OpenAI OAuth callback state did not match'));
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(OpenAiOAuthService.renderCallbackHtml('Authorization failed', 'Invalid OAuth state.'));
        return;
      }

      settled = true;
      const redirectUri = `http://localhost:${OpenAiOAuthService.getServerPort(server) ?? args.port}${OPENAI_OAUTH_CALLBACK_PATH}`;
      const controller = new AbortController();
      const exchangeTimeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 5 * 60 * 1000);
      void OpenAiOAuthService.exchangeCode({
        code,
        redirectUri,
        codeVerifier: args.pkce.verifier,
        fetchImpl: args.fetchImpl,
        signal: controller.signal,
      }).then((tokens) => {
        clearTimeout(exchangeTimeout);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          OpenAiOAuthService.renderCallbackHtml('Authorization successful', 'You can close this window and return to Heddle.'),
          () => resolveTokens(tokens),
        );
      }, (exchangeError) => {
        clearTimeout(exchangeTimeout);
        const error = exchangeError instanceof Error ? exchangeError : new Error(String(exchangeError));
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(
          OpenAiOAuthService.renderCallbackHtml('Authorization failed', 'Return to Heddle and retry the login command.'),
          () => rejectTokens(error),
        );
      });
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(args.port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    const actualPort = OpenAiOAuthService.getServerPort(server) ?? args.port;
    const redirectUri = `http://localhost:${actualPort}${OPENAI_OAUTH_CALLBACK_PATH}`;

    return {
      redirectUri,
      tokens: tokens.finally(() => clearTimeout(timeout)),
      close: async () => {
        clearTimeout(timeout);
        await new Promise<void>((resolve) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close(() => resolve());
          server.closeIdleConnections?.();
          for (const socket of sockets) {
            socket.destroy();
          }
        });
      },
    };
  }

  private static normalizeTokenResponse(input: unknown): OpenAiOAuthTokenResponse {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('OpenAI OAuth token response was not an object');
    }

    const candidate = input as Record<string, unknown>;
    if (typeof candidate.access_token !== 'string' || typeof candidate.refresh_token !== 'string') {
      throw new Error('OpenAI OAuth token response did not include access and refresh tokens');
    }

    return {
      id_token: typeof candidate.id_token === 'string' ? candidate.id_token : undefined,
      access_token: candidate.access_token,
      refresh_token: candidate.refresh_token,
      expires_in:
        typeof candidate.expires_in === 'number' && Number.isFinite(candidate.expires_in) ?
          candidate.expires_in
        : undefined,
    };
  }

  private static base64UrlEncode(value: Buffer): string {
    return value.toString('base64url');
  }

  private static getServerPort(server: Server): number | undefined {
    const address = server.address();
    return typeof address === 'object' && address ? (address as AddressInfo).port : undefined;
  }

  private static async openUrlInBrowser(url: string): Promise<void> {
    const { command, args } = OpenAiOAuthService.buildOpenUrlCommand(url, process.platform);
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }

  private static escapePowerShellSingleQuotedString(value: string): string {
    return value.replaceAll("'", "''");
  }

  private static renderCallbackHtml(title: string, message: string): string {
    return `<!doctype html>
<html>
  <head><title>Heddle OpenAI OAuth</title></head>
  <body>
    <h1>${OpenAiOAuthService.escapeHtml(title)}</h1>
    <p>${OpenAiOAuthService.escapeHtml(message)}</p>
  </body>
</html>`;
  }

  private static escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}
