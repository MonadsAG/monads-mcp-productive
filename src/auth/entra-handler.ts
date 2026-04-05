/**
 * OAuth handler for Microsoft Entra ID (Azure AD) authentication.
 * Implements the authorization code flow with OIDC to authenticate users
 * against a specific Entra tenant before granting MCP access.
 *
 * All tenant/client configuration comes from environment secrets -- nothing is hardcoded.
 */

import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { Hono } from 'hono';
import type { WorkerEnv } from '../config/worker-config.js';
import { LOGO_SVG } from './logo.js';
import {
  addApprovedClient,
  bindStateToSession,
  createOAuthState,
  generateCSRFProtection,
  isClientApproved,
  OAuthError,
  renderApprovalDialog,
  validateCSRFToken,
  validateOAuthState,
} from './workers-oauth-utils.js';

/** User claims extracted from Entra ID tokens and passed as McpAgent props */
export type EntraProps = {
  email: string;
  name: string;
  oid: string;
  [key: string]: unknown;
};

type EntraEnv = WorkerEnv & { OAUTH_PROVIDER: OAuthHelpers };

const ENTRA_SCOPE = 'openid profile email User.Read';

const app = new Hono<{ Bindings: EntraEnv }>();

function getEntraAuthorizeUrl(params: {
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

async function exchangeCodeForTokens(params: {
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
 * SECURITY TRADE-OFF: The id_token was received directly from Entra's token
 * endpoint (login.microsoftonline.com) over TLS in the same request that
 * exchanged the authorization code. In this specific flow, the token has not
 * been stored, forwarded, or received from any untrusted source.
 *
 * Full JWKS-based verification (fetching keys from
 * https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys) would add
 * defense-in-depth and should be considered if this code is ever refactored to
 * accept tokens from other sources (e.g. cached, passed by client, or received
 * via redirect).
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new OAuthError('server_error', 'Invalid JWT format', 500);

  const payload = parts[1];
  const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(decoded) as Record<string, unknown>;
}

function redirectToEntra(
  request: Request,
  stateToken: string,
  workerEnv: EntraEnv,
  extraHeaders?: Headers,
): Response {
  const redirectUri = new URL('/callback', request.url).href;
  const location = getEntraAuthorizeUrl({
    tenantId: workerEnv.ENTRA_TENANT_ID,
    clientId: workerEnv.ENTRA_CLIENT_ID,
    redirectUri,
    state: stateToken,
    scope: ENTRA_SCOPE,
  });

  const headers = new Headers(extraHeaders);
  headers.set('Location', location);

  return new Response(null, { status: 302, headers });
}

// --- Routes ---

app.get('/favicon.ico', (c) => {
  return c.body(null, 302, { Location: '/favicon.svg' });
});

app.get('/favicon.svg', (c) => {
  return c.body(LOGO_SVG, 200, {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'public, max-age=86400',
  });
});

app.get('/authorize', async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const { clientId } = oauthReqInfo;
  if (!clientId) {
    return c.text('Invalid request', 400);
  }

  if (await isClientApproved(c.req.raw, clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
    const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);
    const h = new Headers();
    h.append('Set-Cookie', sessionBindingCookie);
    return redirectToEntra(c.req.raw, stateToken, c.env, h);
  }

  const { token: csrfToken, setCookie } = generateCSRFProtection();

  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
    csrfToken,
    server: {
      name: 'Productive Remote MCP',
      description:
        'Connect your AI assistant to Productive.io. Sign in with your Microsoft account to authorize.',
    },
    setCookie,
    state: { oauthReqInfo },
  });
});

app.post('/authorize', async (c) => {
  try {
    const formData = await c.req.raw.formData();
    validateCSRFToken(formData, c.req.raw);

    const encodedState = formData.get('state');
    if (!encodedState || typeof encodedState !== 'string') {
      return c.text('Missing state in form data', 400);
    }

    let state: { oauthReqInfo?: AuthRequest };
    try {
      state = JSON.parse(atob(encodedState));
    } catch {
      return c.text('Invalid state data', 400);
    }

    if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
      return c.text('Invalid request', 400);
    }

    const approvedClientCookie = await addApprovedClient(
      c.req.raw,
      state.oauthReqInfo.clientId,
      c.env.COOKIE_ENCRYPTION_KEY,
    );

    const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

    const h = new Headers();
    h.append('Set-Cookie', approvedClientCookie);
    h.append('Set-Cookie', sessionBindingCookie);

    return redirectToEntra(c.req.raw, stateToken, c.env, h);
  } catch (error: unknown) {
    console.error('POST /authorize error:', error);
    if (error instanceof OAuthError) return error.toResponse();
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.text(`Internal server error: ${msg}`, 500);
  }
});

app.get('/callback', async (c) => {
  const errorParam = c.req.query('error');
  if (errorParam) {
    console.error('Entra callback error:', errorParam, c.req.query('error_description'));
    return c.text('Authentication failed. Please try again.', 400);
  }

  let oauthReqInfo: AuthRequest;
  let clearSessionCookie: string;

  try {
    const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
    oauthReqInfo = result.oauthReqInfo;
    clearSessionCookie = result.clearCookie;
  } catch (error: unknown) {
    if (error instanceof OAuthError) return error.toResponse();
    return c.text('Internal server error', 500);
  }

  if (!oauthReqInfo.clientId) {
    return c.text('Invalid OAuth request data', 400);
  }

  const code = c.req.query('code');
  if (!code) {
    return c.text('Missing authorization code', 400);
  }

  const { idToken } = await exchangeCodeForTokens({
    tenantId: c.env.ENTRA_TENANT_ID,
    clientId: c.env.ENTRA_CLIENT_ID,
    clientSecret: c.env.ENTRA_CLIENT_SECRET,
    code,
    redirectUri: new URL('/callback', c.req.url).href,
  });

  const claims = decodeJwtPayload(idToken);
  const email = (claims.email ?? claims.preferred_username ?? '') as string;
  const name = (claims.name ?? '') as string;
  const oid = (claims.oid ?? '') as string;

  if (!email) {
    return c.text('No email claim in Entra ID token. Check API permissions.', 400);
  }

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: oid || email,
    metadata: { label: name || email },
    scope: oauthReqInfo.scope,
    props: { email, name, oid } as EntraProps,
  });

  const headers = new Headers({ Location: redirectTo });
  if (clearSessionCookie) {
    headers.set('Set-Cookie', clearSessionCookie);
  }

  return new Response(null, { status: 302, headers });
});

export const EntraAuthHandler = app;
