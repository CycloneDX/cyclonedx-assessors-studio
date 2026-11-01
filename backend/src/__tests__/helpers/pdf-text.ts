/**
 * Minimal text extraction for PDFs written by pdfkit, so tests can
 * assert on report content and layout without a PDF parser dependency.
 *
 * pdfkit writes one deflated content stream per page, and each line of
 * text as a `BT … x y Tm … [<hex> kern <hex>] TJ … ET` block using the
 * standard fonts' single-byte encoding. That is all this understands.
 */
import zlib from 'node:zlib';
import type { Response } from 'supertest';

export interface PdfTextItem {
  x: number;
  y: number;
  text: string;
}

export interface PdfPage {
  items: PdfTextItem[];
  text: string;
}

function decodeTj(array: string): string {
  let out = '';
  for (const m of array.matchAll(/<([0-9a-fA-F]*)>/g)) {
    out += Buffer.from(m[1], 'hex').toString('latin1');
  }
  return out;
}

export function extractPdfPages(pdf: Buffer): PdfPage[] {
  const raw = pdf.toString('latin1');
  const pages: PdfPage[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    if (!content.includes('BT')) continue;
    const items: PdfTextItem[] = [];
    for (const block of content.matchAll(/BT([\s\S]*?)ET/g)) {
      const tm = block[1].match(/([-\d.]+) ([-\d.]+) Tm/);
      const text = [...block[1].matchAll(/\[(.*?)\] TJ/g)].map((t) => decodeTj(t[1])).join('');
      if (!tm || text.length === 0) continue;
      items.push({ x: Number(tm[1]), y: Number(tm[2]), text });
    }
    pages.push({ items, text: items.map((i) => i.text).join('\n') });
  }
  return pages;
}

/** Number of page objects in the PDF. */
export function countPdfPages(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}

/** superagent parser that buffers a binary response body. */
export function binaryParser(res: Response, callback: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}
