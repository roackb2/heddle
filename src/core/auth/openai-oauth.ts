import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import type { StoredProviderCredential } from './provider-credentials.js';

export const OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const OPENAI_AUTH_ISSUER = 'https://auth.openai.com';
export const OPENAI_OAUTH_CALLBACK_PATH = '/auth/callback';
export const DEFAULT_OPENAI_OAUTH_PORT = 1455;

export type PkceCodes = {
  verifier: string;
  challenge: string;
};

export type OpenAiOAuthTokenResponse = {
  id_token?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

export type OpenAiOAuthCredential = Extract<StoredProviderCredential, { type: 'oauth' }>;

export type OpenAiOAuthLoginOptions = {
  port?: number;
  openBrowser?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  openUrl?: (url: string) => Promise<void> | void;
  onAuthorizeUrl?: (url: string) => void;
};

export type OpenAiOAuthRefreshOptions = {
  refreshToken: string;
  fetchImpl?: typeof fetch;
};

export type OpenAiIdTokenClaims = {
  chatgpt_account_id?: string;
  organizations?: Array<{ id?: string }>;
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string;
  };
};

export function generatePkceCodes(): PkceCodes {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function generateOAuthState(): string {
  return base64UrlEncode(randomBytes(32));
}

export function buildOpenAiAuthorizeUrl(args: {
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

export async function runOpenAiBrowserOAuthLogin(
  options: OpenAiOAuthLoginOptions = {},
): Promise<OpenAiOAuthCredential> {
  const port = options.port ?? DEFAULT_OPENAI_OAUTH_PORT;
  const pkce = generatePkceCodes();
  const state = generateOAuthState();
  const callback = await startOpenAiOAuthCallbackServer({
    port,
    state,
    pkce,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
  const authUrl = buildOpenAiAuthorizeUrl({
    redirectUri: callback.redirectUri,
    pkce,
    state,
  });

  try {
    options.onAuthorizeUrl?.(authUrl);
    if (options.openBrowser !== false) {
      await (options.openUrl ?? openUrlInBrowser)(authUrl);
    }
    const tokens = await callback.tokens;
    return createOpenAiOAuthCredential(tokens);
  } finally {
    await callback.close();
  }
}

export async function refreshOpenAiOAuthCredential(
  credential: OpenAiOAuthCredential,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<OpenAiOAuthCredential> {
  const tokens = await refreshOpenAiOAuthToken({
    refreshToken: credential.refreshToken,
    fetchImpl: options.fetchImpl,
  });
  return {
    ...createOpenAiOAuthCredential(tokens),
    createdAt: credential.createdAt,
    accountId: extractOpenAiAccountId(tokens) ?? credential.accountId,
  };
}

export async function exchangeOpenAiOAuthCode(args: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
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
  });

  if (!response.ok) {
    throw new Error(`OpenAI OAuth token exchange failed: ${response.status}`);
  }

  return normalizeTokenResponse(await response.json());
}

export async function refreshOpenAiOAuthToken(
  options: OpenAiOAuthRefreshOptions,
): Promise<OpenAiOAuthTokenResponse> {
  const fetcher = options.fetchImpl ?? fetch;
  const response = await fetcher(`${OPENAI_AUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: options.refreshToken,
      client_id: OPENAI_CODEX_CLIENT_ID,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`OpenAI OAuth token refresh failed: ${response.status}`);
  }

  return normalizeTokenResponse(await response.json());
}

export function createOpenAiOAuthCredential(
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
    accountId: extractOpenAiAccountId(tokens),
    createdAt: timestamp,
    updatedAt: timestamp,
    label: 'ChatGPT/Codex OAuth',
  };
}

export function parseJwtClaims(token: string): OpenAiIdTokenClaims | undefined {
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

export function extractOpenAiAccountId(tokens: Pick<OpenAiOAuthTokenResponse, 'id_token' | 'access_token'>): string | undefined {
  const idClaims = tokens.id_token ? parseJwtClaims(tokens.id_token) : undefined;
  const idAccount = idClaims ? extractOpenAiAccountIdFromClaims(idClaims) : undefined;
  if (idAccount) {
    return idAccount;
  }

  const accessClaims = parseJwtClaims(tokens.access_token);
  return accessClaims ? extractOpenAiAccountIdFromClaims(accessClaims) : undefined;
}

export function extractOpenAiAccountIdFromClaims(claims: OpenAiIdTokenClaims): string | undefined {
  return (
    claims.chatgpt_account_id
    ?? claims['https://api.openai.com/auth']?.chatgpt_account_id
    ?? claims.organizations?.find((organization) => organization.id)?.id
  );
}

type CallbackServer = {
  redirectUri: string;
  tokens: Promise<OpenAiOAuthTokenResponse>;
  close: () => Promise<void>;
};

async function startOpenAiOAuthCallbackServer(args: {
  port: number;
  state: string;
  pkce: PkceCodes;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<CallbackServer> {
  let server: Server | undefined;
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

  server = createServer((req, res) => {
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
      res.end(renderCallbackHtml('Authorization failed', message));
      return;
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code) {
      settled = true;
      rejectTokens(new Error('OpenAI OAuth callback did not include a code'));
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(renderCallbackHtml('Authorization failed', 'Missing authorization code.'));
      return;
    }
    if (state !== args.state) {
      settled = true;
      rejectTokens(new Error('OpenAI OAuth callback state did not match'));
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(renderCallbackHtml('Authorization failed', 'Invalid OAuth state.'));
      return;
    }

    settled = true;
    const redirectUri = `http://localhost:${getServerPort(server!) ?? args.port}${OPENAI_OAUTH_CALLBACK_PATH}`;
    void exchangeOpenAiOAuthCode({
      code,
      redirectUri,
      codeVerifier: args.pkce.verifier,
      fetchImpl: args.fetchImpl,
    }).then(resolveTokens, rejectTokens);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderCallbackHtml('Authorization successful', 'You can close this window and return to Heddle.'));
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(args.port, '127.0.0.1', () => {
      server!.off('error', reject);
      resolve();
    });
  });

  const actualPort = getServerPort(server) ?? args.port;
  const redirectUri = `http://localhost:${actualPort}${OPENAI_OAUTH_CALLBACK_PATH}`;

  return {
    redirectUri,
    tokens: tokens.finally(() => clearTimeout(timeout)),
    close: async () => {
      clearTimeout(timeout);
      await new Promise<void>((resolve) => {
        if (!server?.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    },
  };
}

function normalizeTokenResponse(input: unknown): OpenAiOAuthTokenResponse {
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

function base64UrlEncode(value: Buffer): string {
  return value.toString('base64url');
}

function getServerPort(server: Server): number | undefined {
  const address = server.address();
  return typeof address === 'object' && address ? (address as AddressInfo).port : undefined;
}

async function openUrlInBrowser(url: string): Promise<void> {
  const command =
    process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
    : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function renderCallbackHtml(title: string, message: string): string {
  return `<!doctype html>
<html>
  <head><title>Heddle OpenAI OAuth</title></head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
