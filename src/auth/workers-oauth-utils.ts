/**
 * OAuth utility functions with CSRF and state validation security.
 * Adapted from Cloudflare's remote-mcp-github-oauth demo.
 * https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth
 */

import type { AuthRequest, ClientInfo } from '@cloudflare/workers-oauth-provider';

const CSRF_COOKIE = '__Host-CSRF_TOKEN';
const STATE_COOKIE = '__Host-CONSENTED_STATE';
const APPROVED_COOKIE = '__Host-APPROVED_CLIENTS';

export class OAuthError extends Error {
  constructor(
    public code: string,
    public description: string,
    public statusCode = 400,
  ) {
    super(description);
    this.name = 'OAuthError';
  }

  toResponse(): Response {
    return new Response(JSON.stringify({ error: this.code, error_description: this.description }), {
      status: this.statusCode,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export interface OAuthStateResult {
  stateToken: string;
}

export interface ValidateStateResult {
  oauthReqInfo: AuthRequest;
  clearCookie: string;
}

export interface BindStateResult {
  setCookie: string;
}

export interface CSRFProtectionResult {
  token: string;
  setCookie: string;
}

export interface ValidateCSRFResult {
  clearCookie: string;
}

export function sanitizeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function sanitizeUrl(url: string): string {
  const normalized = url.trim();
  if (normalized.length === 0) return '';

  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if ((code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) {
      return '';
    }
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalized);
  } catch {
    return '';
  }

  const allowedSchemes = ['https', 'http'];
  const scheme = parsedUrl.protocol.slice(0, -1).toLowerCase();
  if (!allowedSchemes.includes(scheme)) return '';

  return normalized;
}

export function generateCSRFProtection(): CSRFProtectionResult {
  const csrfCookieName = CSRF_COOKIE;
  const token = crypto.randomUUID();
  const setCookie = `${csrfCookieName}=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`;
  return { token, setCookie };
}

export function validateCSRFToken(formData: FormData, request: Request): ValidateCSRFResult {
  const csrfCookieName = CSRF_COOKIE;
  const tokenFromForm = formData.get('csrf_token');

  if (!tokenFromForm || typeof tokenFromForm !== 'string') {
    throw new OAuthError('invalid_request', 'Missing CSRF token in form data', 400);
  }

  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  const csrfCookie = cookies.find((c) => c.startsWith(`${csrfCookieName}=`));
  const tokenFromCookie = csrfCookie ? csrfCookie.substring(csrfCookieName.length + 1) : null;

  if (!tokenFromCookie) {
    throw new OAuthError('invalid_request', 'Missing CSRF token cookie', 400);
  }

  if (tokenFromForm !== tokenFromCookie) {
    throw new OAuthError('invalid_request', 'CSRF token mismatch', 400);
  }

  const clearCookie = `${csrfCookieName}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`;
  return { clearCookie };
}

export async function createOAuthState(
  oauthReqInfo: AuthRequest,
  kv: KVNamespace,
  stateTTL = 600,
): Promise<OAuthStateResult> {
  const stateToken = crypto.randomUUID();
  await kv.put(`oauth:state:${stateToken}`, JSON.stringify(oauthReqInfo), {
    expirationTtl: stateTTL,
  });
  return { stateToken };
}

export async function bindStateToSession(stateToken: string): Promise<BindStateResult> {
  const consentedStateCookieName = STATE_COOKIE;
  const encoder = new TextEncoder();
  const data = encoder.encode(stateToken);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  const setCookie = `${consentedStateCookieName}=${hashHex}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`;
  return { setCookie };
}

export async function validateOAuthState(
  request: Request,
  kv: KVNamespace,
): Promise<ValidateStateResult> {
  const consentedStateCookieName = STATE_COOKIE;
  const url = new URL(request.url);
  const stateFromQuery = url.searchParams.get('state');

  if (!stateFromQuery) {
    throw new OAuthError('invalid_request', 'Missing state parameter', 400);
  }

  const storedDataJson = await kv.get(`oauth:state:${stateFromQuery}`);
  if (!storedDataJson) {
    throw new OAuthError('invalid_request', 'Invalid or expired state', 400);
  }

  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  const consentedStateCookie = cookies.find((c) => c.startsWith(`${consentedStateCookieName}=`));
  const consentedStateHash = consentedStateCookie
    ? consentedStateCookie.substring(consentedStateCookieName.length + 1)
    : null;

  if (!consentedStateHash) {
    throw new OAuthError(
      'invalid_request',
      'Missing session binding cookie - authorization flow must be restarted',
      400,
    );
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(stateFromQuery);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const stateHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  if (stateHash !== consentedStateHash) {
    throw new OAuthError(
      'invalid_request',
      'State token does not match session - possible CSRF attack detected',
      400,
    );
  }

  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(storedDataJson) as AuthRequest;
  } catch {
    throw new OAuthError('server_error', 'Invalid state data', 500);
  }

  await kv.delete(`oauth:state:${stateFromQuery}`);

  const clearCookie = `${consentedStateCookieName}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`;
  return { oauthReqInfo, clearCookie };
}

export async function isClientApproved(
  request: Request,
  clientId: string,
  cookieSecret: string,
): Promise<boolean> {
  const approvedClients = await getApprovedClientsFromCookie(request, cookieSecret);
  return approvedClients?.includes(clientId) ?? false;
}

export async function addApprovedClient(
  request: Request,
  clientId: string,
  cookieSecret: string,
): Promise<string> {
  const approvedClientsCookieName = APPROVED_COOKIE;
  const THIRTY_DAYS_IN_SECONDS = 2592000;

  const existingApprovedClients = (await getApprovedClientsFromCookie(request, cookieSecret)) || [];
  const updatedApprovedClients = Array.from(new Set([...existingApprovedClients, clientId]));

  const payload = JSON.stringify(updatedApprovedClients);
  const signature = await signData(payload, cookieSecret);
  const cookieValue = `${signature}.${btoa(payload)}`;

  return `${approvedClientsCookieName}=${cookieValue}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${THIRTY_DAYS_IN_SECONDS}`;
}

export interface ApprovalDialogOptions {
  client: ClientInfo | null;
  server: { name: string; logo?: string; description?: string };
  state: Record<string, unknown>;
  csrfToken: string;
  setCookie: string;
}

export function renderApprovalDialog(request: Request, options: ApprovalDialogOptions): Response {
  const { client, server, state, csrfToken, setCookie } = options;
  const encodedState = btoa(JSON.stringify(state));

  const serverName = sanitizeText(server.name);
  const clientName = client?.clientName ? sanitizeText(client.clientName) : 'Unknown MCP Client';
  const serverDescription = server.description ? sanitizeText(server.description) : '';

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${serverName} — Sign In</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500&family=Poppins:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root {
      --m-dark-green: hsl(174,55%,18%);
      --m-dark-green-light: hsl(174,55%,25%);
      --m-teal: hsl(174,40%,55%);
      --m-cream: hsl(60,26%,94%);
      --m-light-cream: hsl(55,69%,97%);
      --m-warm-gray: hsl(30,5%,35%);
      --m-light-gray: hsl(40,13%,89%);
      --m-gradient: linear-gradient(135deg, #5BBFB5 0%, #154944 35%, #8CB83D 65%, #DBD40F 100%);
      --radius: 0.75rem;
      --shadow-modal: 0 16px 48px rgba(0,0,0,0.12);
      --shadow-raised: 0 1px 3px rgba(0,0,0,0.02);
      --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
    }
    body {
      font-family: 'Onest', system-ui, sans-serif;
      line-height: 1.5;
      color: hsl(0,0%,10%);
      background: var(--m-cream);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .page {
      width: 100%;
      max-width: 420px;
      padding: 1.5rem;
    }
    .brand {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      margin-bottom: 2.5rem;
    }
    .brand svg { width: 44px; height: 44px; flex-shrink: 0; }
    .brand-name {
      font-family: 'Poppins', system-ui, sans-serif;
      font-size: 0.6875rem;
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--m-warm-gray);
    }
    .card {
      background: var(--m-light-cream);
      border: 1.5px solid var(--m-light-gray);
      border-radius: var(--radius);
      padding: 2.5rem 2rem 2rem;
      box-shadow: var(--shadow-modal);
      animation: card-enter 350ms var(--ease-standard) both;
    }
    @keyframes card-enter {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .card h1 {
      font-size: clamp(1rem, 0.9rem + 0.5vw, 1.25rem);
      font-weight: 500;
      text-align: center;
      margin-bottom: 0.5rem;
      color: hsl(0,0%,10%);
    }
    .card .desc {
      font-size: clamp(0.8125rem, 0.78rem + 0.15vw, 0.875rem);
      color: var(--m-warm-gray);
      text-align: center;
      margin-bottom: 2rem;
      line-height: 1.6;
    }
    .client-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      background: hsl(174,55%,18%,0.06);
      border: 1px solid hsl(174,55%,18%,0.12);
      border-radius: calc(var(--radius) - 2px);
      padding: 0.375rem 0.75rem;
      font-size: clamp(0.75rem, 0.73rem + 0.1vw, 0.8125rem);
      color: var(--m-dark-green);
      font-weight: 500;
      margin-bottom: 1.5rem;
    }
    .client-badge::before {
      content: '';
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--m-teal);
      flex-shrink: 0;
    }
    .divider {
      height: 1.5px;
      background: var(--m-light-gray);
      margin: 0 -2rem 1.5rem;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.75rem 1.5rem;
      border-radius: calc(var(--radius) - 2px);
      font-family: 'Onest', system-ui, sans-serif;
      font-size: clamp(0.8125rem, 0.78rem + 0.15vw, 0.875rem);
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 150ms var(--ease-standard);
      text-decoration: none;
    }
    .btn-primary {
      background: var(--m-dark-green);
      color: #fff;
    }
    .btn-primary:hover {
      background: var(--m-dark-green-light);
      box-shadow: 0 4px 16px rgba(0,0,0,0.05);
    }
    .btn-primary:active { transform: scale(0.98); }
    .btn-primary svg { width: 18px; height: 18px; }
    .btn-secondary {
      background: transparent;
      border: 1.5px solid var(--m-light-gray);
      color: var(--m-warm-gray);
    }
    .btn-secondary:hover {
      border-color: hsl(174,55%,18%,0.2);
      color: hsl(0,0%,10%);
    }
    .footer {
      text-align: center;
      margin-top: 1.5rem;
      font-size: clamp(0.625rem, 0.6rem + 0.1vw, 0.6875rem);
      color: var(--m-warm-gray);
      opacity: 0.7;
    }
    @media (prefers-reduced-motion: reduce) {
      .card { animation: none; }
      .btn { transition: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="brand">
      <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="mg" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#5BBFB5"/><stop offset="50%" stop-color="#154944"/><stop offset="100%" stop-color="#1a5c55"/></linearGradient></defs>
        <rect width="80" height="80" rx="18" fill="url(#mg)"/>
        <g stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M30 40h20"/><path d="M36 32a10 10 0 1 0 0 16"/><path d="M44 32a10 10 0 1 1 0 16"/></g>
      </svg>
      <span class="brand-name">${serverName}</span>
    </div>

    <div class="card">
      <div style="text-align:center"><span class="client-badge">${clientName}</span></div>
      <h1>Authorize Connection</h1>
      <p class="desc">${serverDescription || 'This application wants to connect to your Productive.io workspace.'}</p>
      <div class="divider"></div>
      <form method="post" action="${new URL(request.url).pathname}">
        <input type="hidden" name="state" value="${encodedState}">
        <input type="hidden" name="csrf_token" value="${csrfToken}">
        <div class="actions">
          <button type="submit" class="btn btn-primary">
            <svg viewBox="0 0 21 21" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z"/><path d="M11 0h10v10H11z"/><path d="M0 11h10v10H0z"/><path d="M11 11h10v10H11z"/></svg>
            Sign in with Microsoft
          </button>
          <button type="button" class="btn btn-secondary" onclick="window.history.back()">Cancel</button>
        </div>
      </form>
    </div>

    <p class="footer">Secured with Microsoft Entra ID</p>
  </div>
</body>
</html>`;

  return new Response(htmlContent, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': setCookie,
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
    },
  });
}

// --- Internal Helpers ---

async function getApprovedClientsFromCookie(
  request: Request,
  cookieSecret: string,
): Promise<string[] | null> {
  const approvedClientsCookieName = APPROVED_COOKIE;
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map((c) => c.trim());
  const targetCookie = cookies.find((c) => c.startsWith(`${approvedClientsCookieName}=`));
  if (!targetCookie) return null;

  const cookieValue = targetCookie.substring(approvedClientsCookieName.length + 1);
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;

  const [signatureHex, base64Payload] = parts;
  const payload = atob(base64Payload);
  const isValid = await verifySignature(signatureHex, payload, cookieSecret);
  if (!isValid) return null;

  try {
    const approvedClients = JSON.parse(payload);
    if (
      !Array.isArray(approvedClients) ||
      !approvedClients.every((item) => typeof item === 'string')
    ) {
      return null;
    }
    return approvedClients as string[];
  } catch {
    return null;
  }
}

async function signData(data: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const enc = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifySignature(
  signatureHex: string,
  data: string,
  secret: string,
): Promise<boolean> {
  const key = await importKey(secret);
  const enc = new TextEncoder();
  try {
    const signatureBytes = new Uint8Array(
      signatureHex.match(/.{1,2}/g)!.map((byte) => Number.parseInt(byte, 16)),
    );
    return await crypto.subtle.verify('HMAC', key, signatureBytes.buffer, enc.encode(data));
  } catch {
    return false;
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  if (!secret) {
    throw new Error('cookieSecret is required for signing cookies');
  }
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign', 'verify'],
  );
}
