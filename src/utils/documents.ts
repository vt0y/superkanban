export const DOCUMENT_BODY_MAX_BYTES = 900 * 1024;
export const DOCUMENT_TITLE_MAX_LENGTH = 200;
export const DOCUMENT_EXCERPT_MAX_LENGTH = 240;

export function documentContentBytes(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

export function documentExcerpt(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, '')
    .replace(/[~*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DOCUMENT_EXCERPT_MAX_LENGTH);
}

export function documentMetadata(content: string) {
  return {
    schemaVersion: 2 as const,
    excerpt: documentExcerpt(content),
    contentBytes: documentContentBytes(content),
  };
}
