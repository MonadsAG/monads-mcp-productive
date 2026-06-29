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
import {
  decodeJwtPayload,
  ENTRA_SCOPE,
  exchangeCodeForTokens,
  getEntraAuthorizeUrl,
} from './entra-oidc.js';
import { SettingsAuthHandler } from './settings-handler.js';

/** User claims extracted from Entra ID tokens and passed as McpAgent props */
export type EntraProps = {
  email: string;
  name: string;
  oid: string;
  [key: string]: unknown;
};

type EntraEnv = WorkerEnv & { OAUTH_PROVIDER: OAuthHelpers };

const app = new Hono<{ Bindings: EntraEnv }>();

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

// Per-user "Bring Your Own Token" settings page (Entra-gated, separate session).
app.route('/settings', SettingsAuthHandler);

export const EntraAuthHandler = app;
