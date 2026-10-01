/** Parsing and URL building for link-only Canva documents. Only edit links are accepted: these documents exist for editing. */

export interface CanvaLink {
  designId: string;
  /** Collaboration-link token from `/design/<id>/<token>/edit`; absent for links that rely on Canva team access. */
  editToken?: string;
}

export type CanvaParseError = 'empty' | 'short_link' | 'view_link' | 'invalid';
export type CanvaParseResult = { ok: true; link: CanvaLink } | { ok: false; error: CanvaParseError };

export interface CanvaDesignRef {
  canvaDesignId: string;
  canvaEditToken?: string;
}

export const CANVA_DESIGN_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const CANVA_TOKEN = /^[A-Za-z0-9_-]{4,128}$/;
const CANVA_HOSTS = new Set(['www.canva.com', 'canva.com']);

/** Parses a Canva edit link: `https://www.canva.com/design/<id>[/<token>]/edit`. */
export function parseCanvaInput(raw: string): CanvaParseResult {
  const input = raw.trim();
  if (!input) return { ok: false, error: 'empty' };
  let url: URL;
  try { url = new URL(input); } catch { return { ok: false, error: 'invalid' }; }
  if (url.protocol !== 'https:') return { ok: false, error: 'invalid' };
  if (url.hostname === 'canva.link') return { ok: false, error: 'short_link' };
  if (!CANVA_HOSTS.has(url.hostname)) return { ok: false, error: 'invalid' };
  const match = url.pathname.match(/^\/design\/([^/]+)(?:\/([^/]+))?\/(edit|view|watch)\/?$/);
  if (!match || !CANVA_DESIGN_ID.test(match[1]) || (match[2] && !CANVA_TOKEN.test(match[2]))) return { ok: false, error: 'invalid' };
  if (match[3] !== 'edit') return { ok: false, error: 'view_link' };
  return { ok: true, link: match[2] ? { designId: match[1], editToken: match[2] } : { designId: match[1] } };
}

export const canvaEditUrl = (ref: CanvaDesignRef) =>
  `https://www.canva.com/design/${encodeURIComponent(ref.canvaDesignId)}${ref.canvaEditToken ? `/${encodeURIComponent(ref.canvaEditToken)}` : ''}/edit`;
export const canvaDocumentId = (designId: string) => `canva_${designId}`;
export const canvaDefaultTitle = (designId: string) => `Canva · ${designId}`;
