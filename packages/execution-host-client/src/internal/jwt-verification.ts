import {
  createRemoteJWKSet,
  errors,
  type JWTVerifyGetKey,
} from 'jose';

const REMOTE_JWKS_OPTIONS = Object.freeze({
  cacheMaxAge: 10 * 60_000,
  cooldownDuration: 30_000,
  timeoutDuration: 3_000,
});

const UNAVAILABLE_JOSE_CATEGORIES = new Map<string, JwtVerificationUnavailableCategory>([
  ['ERR_JOSE_GENERIC', 'jwks_response'],
  ['ERR_JWK_INVALID', 'jwks_response'],
  ['ERR_JWKS_INVALID', 'jwks_response'],
  ['ERR_JWKS_MULTIPLE_MATCHING_KEYS', 'jwks_response'],
  ['ERR_JWKS_TIMEOUT', 'jwks_timeout'],
]);

export type JwtVerificationUnavailableCategory =
  | 'network'
  | 'jwks_response'
  | 'jwks_timeout';

export function createJwtKeyResolver(jwksUrl: URL): JWTVerifyGetKey {
  return createRemoteJWKSet(jwksUrl, REMOTE_JWKS_OPTIONS);
}

export function resolveJwtVerificationUnavailableCategory(
  error: unknown,
): JwtVerificationUnavailableCategory | undefined {
  if (error instanceof TypeError) {
    return 'network';
  }
  return error instanceof errors.JOSEError
    ? UNAVAILABLE_JOSE_CATEGORIES.get(error.code)
    : undefined;
}
