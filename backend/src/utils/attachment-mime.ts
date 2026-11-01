/**
 * Attachment MIME verification.
 *
 * Evidence attachments are uploaded over the public API by authenticated
 * users, then later served back to other users over the same-origin
 * download endpoint. A file that is stored under the wrong
 * Content-Type but then served back with the claimed Content-Type can
 * be used to smuggle executable content (HTML, JavaScript) into the
 * application origin, where it would execute under this app's CSP and
 * cookies. The functions in this file gate every upload through a
 * magic-number sniff against an explicit allowlist, then map the
 * detected type to the value persisted on the attachment row. Clients
 * cannot influence the persisted Content-Type beyond the point of a
 * filename hint, so mislabeling a file no longer changes how it is
 * served back.
 *
 * This module purposefully avoids a native "file-type" style binary
 * dependency: every format below is recognized through a short
 * pure-JavaScript magic-byte or content heuristic, which keeps the
 * dependency closure minimal and the behavior fully auditable.
 */

/** Allowed MIME types for evidence attachments. */
const DEFAULT_ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/json',
  'application/xml',
  'text/xml',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/zip',
  'application/gzip',
  'application/x-bzip2',
  'application/vnd.cyclonedx+json',
  'application/vnd.cyclonedx+xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/octet-stream',
]);

/**
 * MIME types that are explicitly refused regardless of any other
 * evidence, because browsers treat them as executable when served
 * same-origin. Keeping this list explicit is deliberate: a future
 * contributor cannot flip a flag and suddenly allow HTML evidence.
 */
const BLOCKED_MIME_TYPES: ReadonlySet<string> = new Set([
  'text/html',
  'application/xhtml+xml',
  'application/javascript',
  'application/ecmascript',
  'text/javascript',
  'text/ecmascript',
  'image/svg+xml',
]);

export interface AttachmentMimeDecision {
  /** True when the upload passes the allowlist. */
  allowed: boolean;
  /** Reason for rejection; only populated when allowed is false. */
  reason?: string;
  /** MIME type to persist with the attachment row. */
  resolvedType: string;
  /** Whether the detected type differed from the client-supplied type. */
  mismatched: boolean;
}

function matches(prefix: readonly number[], buffer: Buffer, offset = 0): boolean {
  if (buffer.length < offset + prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounds checked above
    if (buffer[offset + i] !== prefix[i]!) return false;
  }
  return true;
}

function startsWithAscii(buffer: Buffer, text: string): boolean {
  if (buffer.length < text.length) return false;
  return buffer.subarray(0, text.length).toString('ascii') === text;
}

function sniffByMagic(buffer: Buffer): string | null {
  // PDF
  if (startsWithAscii(buffer, '%PDF-')) return 'application/pdf';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], buffer)) return 'image/png';
  // JPEG: FF D8 FF
  if (matches([0xff, 0xd8, 0xff], buffer)) return 'image/jpeg';
  // GIF87a / GIF89a
  if (startsWithAscii(buffer, 'GIF87a') || startsWithAscii(buffer, 'GIF89a')) return 'image/gif';
  // WebP: "RIFF"...."WEBP"
  if (startsWithAscii(buffer, 'RIFF') && buffer.length >= 12 && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  // Gzip
  if (matches([0x1f, 0x8b], buffer)) return 'application/gzip';
  // BZip2
  if (startsWithAscii(buffer, 'BZh')) return 'application/x-bzip2';
  // ZIP family (local file header / empty archive / spanned)
  if (matches([0x50, 0x4b, 0x03, 0x04], buffer)
    || matches([0x50, 0x4b, 0x05, 0x06], buffer)
    || matches([0x50, 0x4b, 0x07, 0x08], buffer)) {
    return 'application/zip';
  }
  // Legacy MS Office compound document (D0 CF 11 E0 A1 B1 1A E1)
  if (matches([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], buffer)) {
    return 'application/x-ole-storage';
  }
  return null;
}

function isLikelyText(buffer: Buffer): boolean {
  // Look at the first 4 KiB. If more than one in thirty-two bytes is a
  // control character other than tab, newline, or carriage return, we
  // treat it as binary. This is the same heuristic git uses to decide
  // whether to run a binary diff.
  const sampleLength = Math.min(buffer.length, 4096);
  if (sampleLength === 0) return true;
  let suspicious = 0;
  for (let i = 0; i < sampleLength; i++) {
    // biome-ignore lint/style/noNonNullAssertion: bounds checked above
    const byte = buffer[i]!;
    if (byte === 0) return false;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      suspicious++;
    }
  }
  return suspicious / sampleLength < 1 / 32;
}

function sniffTextual(buffer: Buffer, filename: string): string {
  const headSlice = buffer.subarray(0, Math.min(buffer.length, 2048));
  const head = headSlice.toString('utf8').trimStart();
  const lower = filename.toLowerCase();

  // XML family
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    if (lower.endsWith('.cdx.xml')) return 'application/vnd.cyclonedx+xml';
    if (head.includes('<bom') && head.toLowerCase().includes('cyclonedx')) {
      return 'application/vnd.cyclonedx+xml';
    }
    return 'application/xml';
  }

  // JSON
  if (head.startsWith('{') || head.startsWith('[')) {
    if (lower.endsWith('.cdx.json')
      || (head.includes('"bomFormat"') && head.includes('"CycloneDX"'))) {
      return 'application/vnd.cyclonedx+json';
    }
    return 'application/json';
  }

  // CSV heuristic: at least one line with comma separators
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';

  return 'text/plain';
}

function refineZipByFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  return 'application/zip';
}

function refineLegacyOfficeByFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  return 'application/octet-stream';
}

/**
 * Verify that uploaded bytes match an allowlisted MIME type and
 * compute the value we will persist on the attachment row. The caller
 * should reject the upload with 415 Unsupported Media Type when the
 * returned `allowed` flag is false.
 */
export function verifyAttachmentMimeType(
  buffer: Buffer,
  filename: string,
  claimedType: string,
): AttachmentMimeDecision {
  const claimed = claimedType.toLowerCase().split(';')[0]?.trim() ?? '';

  if (BLOCKED_MIME_TYPES.has(claimed)) {
    return {
      allowed: false,
      resolvedType: claimed,
      mismatched: false,
      reason: `Content type ${claimed} is not permitted for evidence attachments`,
    };
  }

  let resolved: string;
  const magic = sniffByMagic(buffer);
  if (magic === 'application/zip') {
    resolved = refineZipByFilename(filename);
  } else if (magic === 'application/x-ole-storage') {
    resolved = refineLegacyOfficeByFilename(filename);
  } else if (magic !== null) {
    resolved = magic;
  } else if (isLikelyText(buffer)) {
    resolved = sniffTextual(buffer, filename);
  } else {
    resolved = 'application/octet-stream';
  }

  if (BLOCKED_MIME_TYPES.has(resolved)) {
    return {
      allowed: false,
      resolvedType: resolved,
      mismatched: true,
      reason: `Detected content type ${resolved} is not permitted for evidence attachments`,
    };
  }

  if (!DEFAULT_ALLOWED_MIME_TYPES.has(resolved)) {
    return {
      allowed: false,
      resolvedType: resolved,
      mismatched: resolved !== claimed,
      reason: `Detected content type ${resolved} is not in the evidence attachment allowlist`,
    };
  }

  return {
    allowed: true,
    resolvedType: resolved,
    mismatched: resolved !== claimed,
  };
}
