/**
 * CSV export helpers with formula injection defense.
 *
 * Background: Excel, LibreOffice Calc, and Google Sheets all evaluate
 * cells that start with `=`, `+`, `-`, `@`, tab, or carriage return as
 * formulas. That means a field like `=IMPORTXML(...)` can exfiltrate
 * data as soon as a user opens the file. OWASP tracks this under the
 * CSV Injection guidance (see the "CSV Injection" cheat sheet).
 *
 * Every user-supplied field that flows into exported CSV must pass
 * through `sanitizeCsvField` first. The function prefixes any value
 * that would otherwise be interpreted as a formula with a single
 * apostrophe, which the major spreadsheet engines treat as a literal
 * text lead in.
 *
 * This module does not attempt to open a file picker. `downloadCsv`
 * creates a temporary Blob URL so the browser handles the save dialog
 * with the provided filename.
 */

/** Characters that trigger formula evaluation in common spreadsheet applications. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r'])

/**
 * Make a single CSV cell safe to open in Excel, Sheets, and Calc.
 * Null and undefined collapse to an empty string; everything else is
 * stringified, the leading formula character (if any) is neutralized
 * with a single apostrophe, quotes are doubled per RFC 4180, and the
 * whole value is wrapped in double quotes so commas, newlines, and
 * quotes inside the field do not corrupt the row.
 */
function sanitizeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '""'
  }
  let str = typeof value === 'string' ? value : String(value)
  if (str.length > 0 && FORMULA_TRIGGERS.has(str[0]!)) {
    str = `'${str}`
  }
  // Double any embedded double quotes per RFC 4180, then wrap.
  return `"${str.replace(/"/g, '""')}"`
}

/**
 * Serialize a list of rows to a CSV string. Each row is emitted in
 * column order using the provided headers array, and every cell is
 * passed through `sanitizeCsvField`.
 */
export function rowsToCsv<T extends Record<string, unknown>>(
  rows: readonly T[],
  columns: ReadonlyArray<{ key: keyof T & string; label: string }>,
): string {
  const header = columns.map((c) => sanitizeCsvField(c.label)).join(',')
  const body = rows
    .map((row) =>
      columns
        .map((c) => {
          const raw = row[c.key]
          // Objects and arrays serialize to JSON so a structured
          // `changes` field does not dump `[object Object]`.
          if (raw && typeof raw === 'object') {
            return sanitizeCsvField(JSON.stringify(raw))
          }
          return sanitizeCsvField(raw as unknown)
        })
        .join(','),
    )
    .join('\r\n')
  // Prepend a UTF-8 BOM so Excel on Windows opens the file in UTF-8
  // mode rather than the legacy Windows-1252 codepage that mangles
  // non-ASCII identifiers.
  return `\uFEFF${header}\r\n${body}`
}

/**
 * Trigger a browser download of the CSV string using a temporary
 * Blob URL. The filename is passed through `sanitizeFilename` to
 * prevent path traversal or control characters leaking into the
 * Content-Disposition suggestion.
 */
export function downloadCsv(filename: string, csv: string): void {
  const safeName = sanitizeFilename(filename)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = safeName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Strip path separators, control characters, and leading dots so an
 * attacker-controlled record cannot shape the suggested file name.
 */
function sanitizeFilename(name: string): string {
  const cleaned = name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the intent here is to strip control characters
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim()
  return cleaned.length > 0 ? cleaned : 'export.csv'
}
