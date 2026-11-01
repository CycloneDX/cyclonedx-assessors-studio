/**
 * Content-Disposition header for a user-supplied filename (CWE-113).
 *
 * `filename=` gets an ASCII-safe fallback (no quotes, CR/LF, separators
 * or non-ASCII, which made Node's setHeader throw ERR_INVALID_CHAR);
 * `filename*=` carries the real name UTF-8 encoded (RFC 6266 / 5987).
 * Security review I7.
 */
export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const cleaned = filename.replace(/[\r\n]/g, '').substring(0, 255);
  const ascii = cleaned
    .replace(/[/\\]/g, '_')
    .replace(/[^\w\s.\-()]/g, '_') || 'download';
  const encoded = encodeURIComponent(cleaned).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
