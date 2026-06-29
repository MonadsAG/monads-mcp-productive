/**
 * Shared Microsoft Entra ID (Azure AD) OIDC authorization-code primitives.
 *
 * Used by both the MCP grant flow (entra-handler.ts) and the per-user settings
 * login flow (settings-handler.ts), so each can compose its own callback path
 * around the same tenant-bound building blocks. All tenant/client values come
 * from environment secrets -- nothing is hardcoded.
 */

import { OAuthError } from './workers-oauth-utils.js';

export const ENTRA_SCOPE = 'openid profile email User.Read';

export function getEntraAuthorizeUrl(params: {
  tenantId: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
}): string {
  const url = new URL(`https://login.microsoftonline.com/${params.tenantId}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scope);
  url.searchParams.set('state', params.state);
  url.searchParams.set('response_mode', 'query');
  return url.toString();
}

export async function exchangeCodeForTokens(params: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<{ idToken: string; accessToken: string }> {
  const tokenUrl = `https://login.microsoftonline.com/${params.tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
    scope: ENTRA_SCOPE,
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error('Entra token exchange failed:', errorText);
    throw new OAuthError('server_error', 'Failed to exchange authorization code', 500);
  }

  const data = (await resp.json()) as {
    id_token?: string;
    access_token?: string;
  };

  if (!data.id_token || !data.access_token) {
    throw new OAuthError('server_error', 'Missing tokens in Entra response', 500);
  }

  return { idToken: data.id_token, accessToken: data.access_token };
}

/**
 * Decode JWT payload without cryptographic signature verification.
 *
 * SECURITY TRADE-OFF: the id_token was received directly from Entra's token
 * endpoint (login.microsoftonline.com) over TLS in the same request that
 * exchanged the authorization code. In this flow the token has not been stored,
 * forwarded, or received from any untrusted source.
 *
 * Full JWKS-based verification (fetching keys from
 * https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys) would add
 * defense-in-depth and should be considered if this code is ever refactored to
 * accept tokens from other sources. Note the settings session it establishes is
 * a separate HMAC-signed cookie -- we never re-trust a stored/re-presented JWT.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new OAuthError('server_error', 'Invalid JWT format', 500);

  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  // Decode base64 -> raw bytes -> UTF-8, so non-ASCII claims (e.g. accented
  // names/emails) aren't mangled by atob's Latin1 interpretation.
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}
