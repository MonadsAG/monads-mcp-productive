/**
 * Inline SVG logo for Productive MCP.
 * Teal gradient with a minimal "link" icon representing API integration.
 * Exported as a data URI for use in HTML without external file dependencies.
 */
export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none">
  <defs>
    <linearGradient id="mg" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#5BBFB5"/>
      <stop offset="50%" stop-color="#154944"/>
      <stop offset="100%" stop-color="#1a5c55"/>
    </linearGradient>
  </defs>
  <rect width="80" height="80" rx="18" fill="url(#mg)"/>
  <g stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M30 40h20"/>
    <path d="M36 32a10 10 0 1 0 0 16"/>
    <path d="M44 32a10 10 0 1 1 0 16"/>
  </g>
</svg>`;

export const LOGO_DATA_URI = `data:image/svg+xml;base64,${typeof btoa !== 'undefined' ? btoa(LOGO_SVG) : Buffer.from(LOGO_SVG).toString('base64')}`;
