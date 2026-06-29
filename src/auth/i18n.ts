/**
 * Minimal language selection for the user-facing Worker pages (the /settings
 * token page and the OAuth consent dialog).
 *
 * German for browsers requesting `de*`, English otherwise. An optional
 * `?lang=de|en` query parameter overrides the detection (handy for testing or
 * a bookmarked preference).
 */

export type Lang = 'en' | 'de';

export function detectLang(request: Request): Lang {
  const override = new URL(request.url).searchParams.get('lang');
  if (override === 'de' || override === 'en') return override;

  const header = request.headers.get('Accept-Language') ?? '';
  const first = header.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('de') ? 'de' : 'en';
}
