/**
 * Entra-gated "Bring Your Own Token" settings page.
 *
 * A Hono sub-app mounted at /settings (see entra-handler.ts). Lets each user
 * store, rotate, and delete their own Productive PAT without re-connecting the
 * MCP client. Identity is established by a short-lived HMAC-signed session
 * cookie -- independent of the MCP OAuth grant -- so re-login is rare. The PAT
 * value is never displayed, logged, or echoed (NFR-2).
 */

import { Hono } from 'hono';
import { productiveApiBase, type WorkerEnv } from '../config/worker-config.js';
import {
  decodeJwtPayload,
  ENTRA_SCOPE,
  exchangeCodeForTokens,
  getEntraAuthorizeUrl,
} from './entra-oidc.js';
import {
  generateCSRFProtection,
  OAuthError,
  sanitizeText,
  signData,
  validateCSRFToken,
  verifySignature,
} from './workers-oauth-utils.js';
import { deleteUserPat, getUserPatStatus, putUserPat, type PatStatus } from './pat-store.js';
import { detectLang, type Lang } from './i18n.js';

const SESSION_COOKIE = '__Host-SETTINGS_SESSION';
const STATE_COOKIE = '__Host-SETTINGS_STATE';
/** Session lifetime. Tunable; re-login is rare since /settings is visited seldom. */
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const STATE_TTL_SECONDS = 600;
/** CSRF cookie lifetime -- long enough to leave, create a PAT in Productive, and return. */
const CSRF_TTL_SECONDS = 60 * 60;

const app = new Hono<{ Bindings: WorkerEnv }>();

interface SettingsSession {
  oid: string;
  email: string;
  exp: number; // epoch seconds
}

// --- Cookie helpers ---

function getCookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  const match = header
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? match.substring(name.length + 1) : null;
}

function sessionCookie(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

function stateCookie(value: string, maxAge: number): string {
  return `${STATE_COOKIE}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** UTF-8-safe base64 (raw btoa/atob mishandle multi-byte chars, e.g. accented emails). */
function utf8ToBase64(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}
function base64ToUtf8(b64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

async function issueSessionCookie(session: SettingsSession, secret: string): Promise<string> {
  const payload = JSON.stringify(session);
  const signature = await signData(payload, secret);
  return sessionCookie(`${signature}.${utf8ToBase64(payload)}`, SESSION_TTL_SECONDS);
}

async function readSession(request: Request, secret: string): Promise<SettingsSession | null> {
  const raw = getCookieValue(request, SESSION_COOKIE);
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;

  let payload: string;
  try {
    payload = base64ToUtf8(parts[1]);
  } catch {
    return null;
  }
  if (!(await verifySignature(parts[0], payload, secret))) return null;

  let session: SettingsSession;
  try {
    session = JSON.parse(payload) as SettingsSession;
  } catch {
    return null;
  }
  if (
    typeof session.oid !== 'string' ||
    typeof session.email !== 'string' ||
    typeof session.exp !== 'number'
  ) {
    return null;
  }
  if (session.exp * 1000 < Date.now()) return null; // expired

  return session;
}

// --- Entra login round-trip (separate callback from the MCP grant flow) ---

async function startLogin(request: Request, env: WorkerEnv): Promise<Response> {
  const stateToken = crypto.randomUUID();
  const redirectUri = new URL('/settings/callback', request.url).href;
  const location = getEntraAuthorizeUrl({
    tenantId: env.ENTRA_TENANT_ID,
    clientId: env.ENTRA_CLIENT_ID,
    redirectUri,
    state: stateToken,
    scope: ENTRA_SCOPE,
  });

  const headers = new Headers({ Location: location });
  headers.append('Set-Cookie', stateCookie(await sha256Hex(stateToken), STATE_TTL_SECONDS));
  return new Response(null, { status: 302, headers });
}

// --- PAT validation (FR-4): a lightweight read-only call with the candidate PAT ---

type PatVerdict = 'valid' | 'invalid' | 'unverified';

/**
 * Probe the candidate PAT with a lightweight read-only call.
 * - 'invalid'    -> Productive rejected the token (401): definitely bad, don't store.
 * - 'valid'      -> authenticated (2xx) or 403 (token works but lacks the people
 *                   scope; a least-privilege PAT is still a real token -> accept).
 * - 'unverified' -> network error / 429 / 5xx: can't tell right now, so don't store
 *                   AND don't claim the token is bad.
 */
async function checkPat(env: WorkerEnv, pat: string): Promise<PatVerdict> {
  let resp: Response;
  try {
    resp = await fetch(
      `${productiveApiBase(env)}people?${new URLSearchParams({ 'page[size]': '1' })}`,
      {
        headers: {
          'Content-Type': 'application/vnd.api+json',
          'X-Auth-Token': pat,
          'X-Organization-Id': env.PRODUCTIVE_ORG_ID,
        },
      },
    );
  } catch {
    return 'unverified';
  }
  if (resp.ok || resp.status === 403) return 'valid';
  if (resp.status === 401) return 'invalid';
  return 'unverified';
}

// --- HTML ---

const PAGE_STYLE = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --m-dark-green:hsl(174,55%,18%);--m-dark-green-light:hsl(174,55%,25%);
  --m-teal:hsl(174,40%,55%);--m-cream:hsl(60,26%,94%);--m-light-cream:hsl(55,69%,97%);
  --m-warm-gray:hsl(30,5%,35%);--m-light-gray:hsl(40,13%,89%);
  --radius:0.75rem;--shadow-modal:0 16px 48px rgba(0,0,0,0.12);
  --ease:cubic-bezier(0.4,0,0.2,1);
}
body{font-family:'Onest',system-ui,sans-serif;line-height:1.5;color:hsl(0,0%,10%);
  background:var(--m-cream);min-height:100vh;display:flex;align-items:center;justify-content:center}
.page{width:100%;max-width:480px;padding:1.5rem}
.brand{display:flex;align-items:center;justify-content:center;gap:0.75rem;margin-bottom:2rem}
.brand svg{width:44px;height:44px;flex-shrink:0}
.brand-name{font-family:'Poppins',system-ui,sans-serif;font-size:0.6875rem;font-weight:500;
  letter-spacing:0.06em;text-transform:uppercase;color:var(--m-warm-gray)}
.card{background:var(--m-light-cream);border:1.5px solid var(--m-light-gray);
  border-radius:var(--radius);padding:2rem;box-shadow:var(--shadow-modal);
  animation:enter 350ms var(--ease) both}
@keyframes enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.card h1{font-size:1.25rem;font-weight:500;margin-bottom:0.25rem}
.card .sub{font-size:0.8125rem;color:var(--m-warm-gray);margin-bottom:1.5rem}
.status{display:flex;align-items:center;gap:0.5rem;font-size:0.875rem;font-weight:500;
  padding:0.75rem 1rem;border-radius:calc(var(--radius) - 2px);margin-bottom:1.5rem}
.status.set{background:hsl(120,40%,95%);color:hsl(140,50%,25%)}
.status.unset{background:hsl(40,60%,95%);color:hsl(30,60%,30%)}
.status .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.status.set .dot{background:hsl(140,55%,40%)}
.status.unset .dot{background:hsl(35,80%,50%)}
.meta{font-size:0.75rem;color:var(--m-warm-gray);font-weight:400;margin-left:auto}
.banner{font-size:0.8125rem;padding:0.75rem 1rem;border-radius:calc(var(--radius) - 2px);margin-bottom:1.5rem}
.banner.success{background:hsl(120,40%,95%);color:hsl(140,50%,25%)}
.banner.error{background:hsl(0,60%,96%);color:hsl(0,55%,40%)}
.banner.info{background:hsl(210,40%,96%);color:hsl(210,45%,35%)}
label{display:block;font-size:0.8125rem;font-weight:500;margin-bottom:0.5rem}
input[type=password]{width:100%;padding:0.75rem;font-size:0.875rem;font-family:inherit;
  border:1.5px solid var(--m-light-gray);border-radius:calc(var(--radius) - 2px);
  background:#fff;margin-bottom:1rem}
input[type=password]:focus{outline:none;border-color:var(--m-teal)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:0.5rem;width:100%;
  padding:0.75rem 1.5rem;border-radius:calc(var(--radius) - 2px);font-family:inherit;
  font-size:0.875rem;font-weight:500;cursor:pointer;border:none;transition:all 150ms var(--ease)}
.btn-primary{background:var(--m-dark-green);color:#fff}
.btn-primary:hover{background:var(--m-dark-green-light)}
.btn-danger{background:transparent;border:1.5px solid hsl(0,50%,80%);color:hsl(0,55%,45%);margin-top:0.75rem}
.btn-danger:hover{background:hsl(0,60%,97%)}
.divider{height:1.5px;background:var(--m-light-gray);margin:1.5rem -2rem}
.help{font-size:0.75rem;color:var(--m-warm-gray);line-height:1.6}
.help h2{font-size:0.8125rem;color:hsl(0,0%,10%);margin-bottom:0.5rem;font-weight:500}
.help ol{margin:0 0 0 1.1rem;padding:0}
.help li{margin-bottom:0.25rem}
.help a{color:var(--m-dark-green)}
.footer{text-align:center;margin-top:1.5rem;font-size:0.6875rem;color:var(--m-warm-gray);opacity:0.7}
@media (prefers-reduced-motion:reduce){.card{animation:none}.btn{transition:none}}
`;

const BRAND_SVG = `<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="mg" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#5BBFB5"/><stop offset="50%" stop-color="#154944"/><stop offset="100%" stop-color="#1a5c55"/></linearGradient></defs><rect width="80" height="80" rx="18" fill="url(#mg)"/><g stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M30 40h20"/><path d="M36 32a10 10 0 1 0 0 16"/><path d="M44 32a10 10 0 1 1 0 16"/></g></svg>`;

type Banner = { kind: 'success' | 'error' | 'info'; text: string };

interface SettingsStrings {
  title: string;
  heading: string;
  signedInAs: string;
  statusSet: string;
  statusUnset: string;
  updated: string;
  labelSet: string;
  labelReplace: string;
  placeholder: string;
  btnSave: string;
  btnReplace: string;
  btnDelete: string;
  helpHeading: string;
  helpSteps: string[];
  footer: string;
  banners: Record<string, Banner>;
}

const SETTINGS_STRINGS: Record<Lang, SettingsStrings> = {
  en: {
    title: 'Productive MCP — Token Settings',
    heading: 'Your Productive token',
    signedInAs: 'Signed in as',
    statusSet: 'Token configured',
    statusUnset: 'No token configured yet',
    updated: 'updated',
    labelSet: 'Personal Access Token',
    labelReplace: 'Replace token (rotate)',
    placeholder: 'Paste your Productive PAT',
    btnSave: 'Save token',
    btnReplace: 'Replace token',
    btnDelete: 'Remove stored token',
    helpHeading: 'How to create a Personal Access Token',
    helpSteps: [
      'In Productive, open <strong>Settings → API integrations / Access Tokens</strong>.',
      'Create a new Personal Access Token.',
      "Grant only the scopes you need — the MCP acts with exactly your token's permissions (least privilege).",
      'Copy the token and paste it above. It is encrypted before storage and never shown again.',
    ],
    footer: 'Secured with Microsoft Entra ID · token encrypted at rest',
    banners: {
      saved: {
        kind: 'success',
        text: 'Your Productive token was saved — you can close this tab and return to your MCP client.',
      },
      rotated: {
        kind: 'success',
        text: 'Your Productive token was replaced — you can close this tab and return to your MCP client.',
      },
      deleted: { kind: 'info', text: 'Your Productive token was removed.' },
      invalid: { kind: 'error', text: 'That token was rejected by Productive. Nothing was saved.' },
      missing: { kind: 'error', text: 'Please paste a token before saving.' },
      unverified: {
        kind: 'error',
        text: "Couldn't verify the token with Productive just now (temporary issue). Nothing was saved — please try again.",
      },
      error: { kind: 'error', text: 'Something went wrong saving your token. Please try again.' },
    },
  },
  de: {
    title: 'Productive MCP — Token-Einstellungen',
    heading: 'Dein Productive-Token',
    signedInAs: 'Angemeldet als',
    statusSet: 'Token hinterlegt',
    statusUnset: 'Noch kein Token hinterlegt',
    updated: 'aktualisiert',
    labelSet: 'Personal Access Token',
    labelReplace: 'Token ersetzen (rotieren)',
    placeholder: 'Productive-PAT einfügen',
    btnSave: 'Token speichern',
    btnReplace: 'Token ersetzen',
    btnDelete: 'Hinterlegten Token entfernen',
    helpHeading: 'So erstellst du einen Personal Access Token',
    helpSteps: [
      'Öffne in Productive <strong>Einstellungen → API-Integrationen / Access Tokens</strong>.',
      'Erstelle einen neuen Personal Access Token.',
      'Vergib nur die nötigen Berechtigungen — der MCP handelt mit genau den Rechten deines Tokens (Least Privilege).',
      'Kopiere den Token und füge ihn oben ein. Er wird vor dem Speichern verschlüsselt und danach nie wieder angezeigt.',
    ],
    footer: 'Abgesichert mit Microsoft Entra ID · Token verschlüsselt gespeichert',
    banners: {
      saved: {
        kind: 'success',
        text: 'Dein Productive-Token wurde gespeichert — du kannst dieses Fenster jetzt schliessen und zu deinem MCP-Client zurückkehren.',
      },
      rotated: {
        kind: 'success',
        text: 'Dein Productive-Token wurde ersetzt — du kannst dieses Fenster jetzt schliessen und zu deinem MCP-Client zurückkehren.',
      },
      deleted: { kind: 'info', text: 'Dein Productive-Token wurde entfernt.' },
      invalid: {
        kind: 'error',
        text: 'Der Token wurde von Productive abgelehnt. Es wurde nichts gespeichert.',
      },
      missing: { kind: 'error', text: 'Bitte gib einen Token ein, bevor du speicherst.' },
      unverified: {
        kind: 'error',
        text: 'Der Token konnte gerade nicht mit Productive verifiziert werden (vorübergehendes Problem). Es wurde nichts gespeichert — bitte versuche es erneut.',
      },
      error: {
        kind: 'error',
        text: 'Beim Speichern ist etwas schiefgelaufen. Bitte versuche es erneut.',
      },
    },
  },
};

function renderHead(title: string): string {
  return `<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500&family=Poppins:wght@400;500&display=swap" rel="stylesheet">
  <style>${PAGE_STYLE}</style>
</head>`;
}

function renderHelp(s: SettingsStrings): string {
  const steps = s.helpSteps.map((step) => `          <li>${step}</li>`).join('\n');
  return `<div class="help">
        <h2>${s.helpHeading}</h2>
        <ol>
${steps}
        </ol>
      </div>`;
}

function renderCard(
  s: SettingsStrings,
  opts: { isSet: boolean; email: string; csrfToken: string; banner?: Banner; updated: string },
): string {
  const { isSet, email, csrfToken, banner, updated } = opts;
  const statusBlock = isSet
    ? `<div class="status set"><span class="dot"></span>${s.statusSet}${updated ? `<span class="meta">${s.updated} ${sanitizeText(updated)}</span>` : ''}</div>`
    : `<div class="status unset"><span class="dot"></span>${s.statusUnset}</div>`;
  const bannerBlock = banner
    ? `<div class="banner ${banner.kind}">${sanitizeText(banner.text)}</div>`
    : '';
  const deleteBlock = isSet
    ? `<form method="post" action="/settings/delete">
         <input type="hidden" name="csrf_token" value="${csrfToken}">
         <button type="submit" class="btn btn-danger">${s.btnDelete}</button>
       </form>`
    : '';
  return `<div class="card">
      <h1>${s.heading}</h1>
      <p class="sub">${s.signedInAs} ${sanitizeText(email)}</p>
      ${bannerBlock}
      ${statusBlock}
      <form method="post" action="/settings" autocomplete="off">
        <input type="hidden" name="csrf_token" value="${csrfToken}">
        <label for="pat">${isSet ? s.labelReplace : s.labelSet}</label>
        <input type="password" id="pat" name="pat" placeholder="${s.placeholder}" autocomplete="off" required>
        <button type="submit" class="btn btn-primary">${isSet ? s.btnReplace : s.btnSave}</button>
      </form>
      ${deleteBlock}
      <div class="divider"></div>
      ${renderHelp(s)}
    </div>`;
}

function renderSettingsPage(opts: {
  status: PatStatus;
  csrfToken: string;
  email: string;
  lang: Lang;
  banner?: Banner;
}): string {
  const { status, csrfToken, email, lang, banner } = opts;
  const s = SETTINGS_STRINGS[lang];
  const isSet = status.set;
  const updated = status.updatedAt
    ? new Date(status.updatedAt).toLocaleString(lang === 'de' ? 'de-CH' : 'en-GB')
    : '';
  return `<!DOCTYPE html>
<html lang="${lang}">
${renderHead(s.title)}
<body>
  <div class="page">
    <div class="brand">${BRAND_SVG}<span class="brand-name">Productive Remote MCP</span></div>
    ${renderCard(s, { isSet, email, csrfToken, banner, updated })}
    <p class="footer">${s.footer}</p>
  </div>
</body>
</html>`;
}

function htmlResponse(html: string, extraCookies: string[] = []): Response {
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
  });
  for (const cookie of extraCookies) headers.append('Set-Cookie', cookie);
  return new Response(html, { headers });
}

// --- Routes (mounted under /settings) ---

app.get('/', async (c) => {
  const session = await readSession(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY);
  if (!session) return startLogin(c.req.raw, c.env);

  const lang = detectLang(c.req.raw);
  const status = await getUserPatStatus(c.env, session.oid);
  const { token: csrfToken, setCookie: csrfCookie } = generateCSRFProtection(CSRF_TTL_SECONDS);
  // Guard against prototype keys (?status=__proto__) resolving to Object.prototype.
  const statusKey = c.req.query('status') ?? '';
  const banners = SETTINGS_STRINGS[lang].banners;
  const banner = Object.prototype.hasOwnProperty.call(banners, statusKey)
    ? banners[statusKey]
    : undefined;

  // Slide the session forward so frequent users rarely re-authenticate.
  const refreshed = await issueSessionCookie(
    {
      oid: session.oid,
      email: session.email,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    },
    c.env.COOKIE_ENCRYPTION_KEY,
  );

  const html = renderSettingsPage({ status, csrfToken, email: session.email, lang, banner });
  return htmlResponse(html, [csrfCookie, refreshed]);
});

app.get('/callback', async (c) => {
  const errorParam = c.req.query('error');
  if (errorParam) {
    console.error('Settings callback error:', errorParam, c.req.query('error_description'));
    return c.text('Authentication failed. Please try again.', 400);
  }

  const state = c.req.query('state');
  const stateCookieHash = getCookieValue(c.req.raw, STATE_COOKIE);
  if (!state || !stateCookieHash || (await sha256Hex(state)) !== stateCookieHash) {
    return c.text('Invalid or expired login state. Please retry from /settings.', 400);
  }

  const code = c.req.query('code');
  if (!code) return c.text('Missing authorization code', 400);

  let oid = '';
  let email = '';
  try {
    const { idToken } = await exchangeCodeForTokens({
      tenantId: c.env.ENTRA_TENANT_ID,
      clientId: c.env.ENTRA_CLIENT_ID,
      clientSecret: c.env.ENTRA_CLIENT_SECRET,
      code,
      redirectUri: new URL('/settings/callback', c.req.url).href,
    });
    const claims = decodeJwtPayload(idToken);
    oid = (claims.oid ?? '') as string;
    email = (claims.email ?? claims.preferred_username ?? '') as string;
  } catch (error) {
    if (error instanceof OAuthError) return error.toResponse();
    return c.text('Internal server error', 500);
  }

  if (!oid) return c.text('No oid claim in Entra ID token. Check API permissions.', 400);

  const session: SettingsSession = {
    oid,
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const headers = new Headers({ Location: '/settings' });
  headers.append('Set-Cookie', await issueSessionCookie(session, c.env.COOKIE_ENCRYPTION_KEY));
  headers.append('Set-Cookie', stateCookie('', 0)); // clear state cookie
  return new Response(null, { status: 302, headers });
});

app.post('/', async (c) => {
  const session = await readSession(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY);
  if (!session) return startLogin(c.req.raw, c.env);

  let formData: FormData;
  try {
    formData = await c.req.raw.formData();
    validateCSRFToken(formData, c.req.raw);
  } catch (error) {
    if (error instanceof OAuthError) return error.toResponse();
    return c.text('Bad request', 400);
  }

  const pat = formData.get('pat');
  if (!pat || typeof pat !== 'string' || pat.trim().length === 0) {
    return c.redirect('/settings?status=missing', 302);
  }

  const verdict = await checkPat(c.env, pat.trim());
  if (verdict === 'invalid') return c.redirect('/settings?status=invalid', 302);
  if (verdict === 'unverified') return c.redirect('/settings?status=unverified', 302);

  const wasSet = (await getUserPatStatus(c.env, session.oid)).set;
  try {
    await putUserPat(c.env, session.oid, pat.trim());
  } catch (error) {
    // e.g. PAT_ENC_KEY misconfigured. Never include the PAT in the log.
    console.error('Failed to store PAT:', error instanceof Error ? error.message : 'unknown');
    return c.redirect('/settings?status=error', 302);
  }
  return c.redirect(`/settings?status=${wasSet ? 'rotated' : 'saved'}`, 302);
});

app.post('/delete', async (c) => {
  const session = await readSession(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY);
  if (!session) return startLogin(c.req.raw, c.env);

  try {
    const formData = await c.req.raw.formData();
    validateCSRFToken(formData, c.req.raw);
  } catch (error) {
    if (error instanceof OAuthError) return error.toResponse();
    return c.text('Bad request', 400);
  }

  await deleteUserPat(c.env, session.oid);
  return c.redirect('/settings?status=deleted', 302);
});

export const SettingsAuthHandler = app;
