/**
 * PDF renderer for the assessment report model.
 *
 * Layout: a cover page with the executive summary and contents, then
 * Overview, Requirements (grouped, one row per requirement with the
 * assessed result and attested score together), Claims, Signatures and
 * seal, and an Evidence appendix that lists each item once.
 */
import {
  createReportDocument,
  drawTable,
  ensureSpace,
  formatPercent,
  renderToBuffer,
  stampFooters,
  type PdfDoc,
  type TableCell,
} from '../../utils/pdf-report.js';
import {
  RESULT_ORDER,
  type AssessmentReportModel,
  type ReportAffirmation,
  type RequirementResult,
  type SealStatus,
} from './model.js';

const ACCENT = '#1f3a5f';
const MUTED = '#57606a';
const RULE = '#d0d7de';

const RESULT_STYLE: Record<RequirementResult, { label: string; color: string }> = {
  yes: { label: 'Conforms', color: '#1a7f37' },
  partial: { label: 'Partial', color: '#9a6700' },
  no: { label: 'Does not conform', color: '#cf222e' },
  not_applicable: { label: 'Not applicable', color: '#57606a' },
  not_assessed: { label: 'Not assessed', color: '#8c959f' },
};

const SEAL_STYLE: Record<SealStatus | 'none', { label: string; color: string; fill: string }> = {
  verified: { label: 'Seal verified', color: '#1a7f37', fill: '#e6f4ea' },
  failed: { label: 'Seal verification failed', color: '#cf222e', fill: '#fdecea' },
  rescinded: { label: 'Affirmation rescinded', color: '#cf222e', fill: '#fdecea' },
  unsealed: { label: 'Affirmation not sealed', color: '#9a6700', fill: '#fff8e1' },
  none: { label: 'No affirmation recorded', color: '#57606a', fill: '#f3f4f6' },
};

const SECTIONS = ['Overview', 'Requirements', 'Claims', 'Signatures and seal', 'Evidence'] as const;
type Section = (typeof SECTIONS)[number];

function formatReportDate(date: Date | null): string {
  if (!date) return 'N/A';
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTimestamp(date: Date): string {
  return `${formatReportDate(date)} ${date.toISOString().slice(11, 16)} UTC`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function width(doc: PdfDoc): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function left(doc: PdfDoc): number {
  return doc.page.margins.left;
}

function heading(doc: PdfDoc, title: string, size = 15): void {
  ensureSpace(doc, size * 4);
  doc.x = left(doc);
  doc.font('Helvetica-Bold').fontSize(size).fillColor(ACCENT).text(title);
  const y = doc.y + 2;
  doc.save().strokeColor(RULE).lineWidth(0.75).moveTo(left(doc), y).lineTo(left(doc) + width(doc), y).stroke().restore();
  doc.y = y + 8;
  doc.font('Helvetica').fillColor('#000000');
}

function paragraph(doc: PdfDoc, text: string, opts: { size?: number; color?: string } = {}): void {
  doc.x = left(doc);
  doc.font('Helvetica').fontSize(opts.size ?? 10).fillColor(opts.color ?? '#000000').text(text, { width: width(doc) });
  doc.fillColor('#000000');
}

function labelled(doc: PdfDoc, label: string, value: string, labelWidth = 90): void {
  doc.fontSize(9.5);
  const valueWidth = width(doc) - labelWidth;
  const height = Math.max(
    doc.font('Helvetica').heightOfString(value, { width: valueWidth }),
    doc.font('Helvetica-Bold').heightOfString(label, { width: labelWidth - 6 }),
  );
  ensureSpace(doc, height + 3);
  const top = doc.y;
  doc.font('Helvetica-Bold').fillColor(MUTED).text(label, left(doc), top, { width: labelWidth - 6 });
  doc.font('Helvetica').fillColor('#000000').text(value, left(doc) + labelWidth, top, { width: valueWidth });
  doc.x = left(doc);
  doc.y = top + height + 3;
}

/** A tinted box with a coloured left bar; returns nothing, advances doc.y. */
function callout(doc: PdfDoc, title: string, body: string[], style: { color: string; fill: string }): void {
  const inner = width(doc) - 20;
  doc.fontSize(10.5).font('Helvetica-Bold');
  let height = doc.heightOfString(title, { width: inner }) + 12;
  doc.fontSize(9).font('Helvetica');
  for (const line of body) height += doc.heightOfString(line, { width: inner }) + 2;
  ensureSpace(doc, height + 6);

  const top = doc.y;
  doc.save().fillColor(style.fill).rect(left(doc), top, width(doc), height).fill().restore();
  doc.save().fillColor(style.color).rect(left(doc), top, 4, height).fill().restore();
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(style.color).text(title, left(doc) + 14, top + 6, { width: inner });
  doc.font('Helvetica').fontSize(9).fillColor('#000000');
  for (const line of body) doc.text(line, left(doc) + 14, doc.y + 2, { width: inner });
  doc.x = left(doc);
  doc.y = top + height + 10;
}

export function verdictSentence(model: AssessmentReportModel): string {
  const { resultCounts, requirementCount } = model.summary;
  if (requirementCount === 0) return 'No requirements are linked to this assessment.';
  const parts = RESULT_ORDER.filter((r) => resultCounts[r] > 0).map((r) => {
    const n = resultCounts[r];
    const verb: Record<RequirementResult, string> = {
      yes: n === 1 ? 'conforms' : 'conform',
      partial: n === 1 ? 'partially conforms' : 'partially conform',
      no: n === 1 ? 'does not conform' : 'do not conform',
      not_applicable: 'not applicable',
      not_assessed: 'not yet assessed',
    };
    return `${n} ${verb[r]}`;
  });
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `Of ${requirementCount} requirement${requirementCount === 1 ? '' : 's'} in scope, ${list}.`;
}

function sealLines(affirmation: ReportAffirmation | null): { status: SealStatus | 'none'; lines: string[] } {
  if (!affirmation) {
    return { status: 'none', lines: ['This assessment has no affirmation, so the report is not signed.'] };
  }
  const signed = affirmation.signatories.filter((s) => s.signatureType).length;
  const lines = [`${signed} of ${affirmation.signatories.length} signatories have signed.`];
  if (affirmation.sealedAt) {
    const key = affirmation.platformKeyFingerprint ? ` with platform key ${affirmation.platformKeyFingerprint.slice(0, 16)}` : '';
    lines.push(`Sealed ${formatTimestamp(affirmation.sealedAt)}${key}.`);
  }
  for (const issue of affirmation.issues.slice(0, 3)) lines.push(`Issue: ${issue}`);
  if (affirmation.issues.length > 3) lines.push(`…and ${affirmation.issues.length - 3} more issues.`);
  return { status: affirmation.sealStatus, lines };
}

function drawTiles(doc: PdfDoc, tiles: Array<{ label: string; value: string }>): void {
  const gap = 6;
  const tileWidth = (width(doc) - gap * (tiles.length - 1)) / tiles.length;
  const top = doc.y;
  const height = 48;
  tiles.forEach((tile, i) => {
    const x = left(doc) + i * (tileWidth + gap);
    doc.save().lineWidth(0.75).strokeColor(RULE).rect(x, top, tileWidth, height).stroke().restore();
    doc.font('Helvetica-Bold').fontSize(16).fillColor(ACCENT).text(tile.value, x + 8, top + 8, { width: tileWidth - 16, lineBreak: false });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(tile.label, x + 8, top + 30, { width: tileWidth - 16 });
  });
  doc.fillColor('#000000');
  doc.x = left(doc);
  doc.y = top + height + 12;
}

function drawResultBar(doc: PdfDoc, model: AssessmentReportModel): void {
  const { resultCounts, requirementCount } = model.summary;
  if (requirementCount === 0) return;
  const top = doc.y;
  let x = left(doc);
  for (const result of RESULT_ORDER) {
    const n = resultCounts[result];
    if (n === 0) continue;
    const w = (n / requirementCount) * width(doc);
    doc.save().fillColor(RESULT_STYLE[result].color).rect(x, top, w, 10).fill().restore();
    x += w;
  }
  // Legend: one entry per non-empty result.
  let lx = left(doc);
  const ly = top + 16;
  doc.fontSize(8);
  for (const result of RESULT_ORDER) {
    const n = resultCounts[result];
    if (n === 0) continue;
    const label = `${RESULT_STYLE[result].label} ${n}`;
    doc.save().fillColor(RESULT_STYLE[result].color).rect(lx, ly + 1, 7, 7).fill().restore();
    doc.fillColor('#000000').text(label, lx + 10, ly, { lineBreak: false });
    lx += 10 + doc.widthOfString(label) + 14;
  }
  doc.x = left(doc);
  doc.y = ly + 20;
}

function drawCover(doc: PdfDoc, model: AssessmentReportModel): void {
  const { assessment, summary } = model;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('CycloneDX Assessors Studio');
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(26).fillColor(ACCENT).text('Assessment Report');
  doc.font('Helvetica').fontSize(15).fillColor('#000000').text(assessment.title);
  doc.moveDown(0.8);

  const period = [assessment.startDate, assessment.endDate ?? null]
    .map((d) => (d ? formatReportDate(d) : null))
    .filter(Boolean)
    .join(' to ');
  const meta: Array<[string, string | null]> = [
    ['Project', model.project],
    ['Standard', model.standard],
    ['Target', model.target],
    ['State', assessment.state.replace(/_/g, ' ')],
    ['Period', period || null],
    ['Due', assessment.dueDate ? formatReportDate(assessment.dueDate) : null],
    ['Assessors', model.assessors.join(', ') || null],
    ['Assessees', model.assessees.join(', ') || null],
    ['Generated', formatTimestamp(model.generatedAt)],
  ];
  for (const [label, value] of meta) {
    if (value) labelled(doc, label, value);
  }
  doc.moveDown(0.8);

  heading(doc, 'Executive summary', 13);
  paragraph(doc, verdictSentence(model), { size: 10.5 });
  doc.moveDown(0.6);
  drawTiles(doc, [
    { label: 'Requirements assessed', value: `${summary.assessedCount} / ${summary.requirementCount}` },
    { label: 'Attested conformance', value: formatPercent(summary.meanConformance) },
    { label: 'Attested confidence', value: formatPercent(summary.meanConfidence) },
    { label: 'Evidence items', value: String(summary.evidenceCount) },
    { label: summary.counterClaimCount ? `Claims (+${summary.counterClaimCount} counter)` : 'Claims', value: String(summary.claimCount) },
  ]);
  drawResultBar(doc, model);

  const seal = sealLines(model.affirmation);
  callout(doc, SEAL_STYLE[seal.status].label, seal.lines, SEAL_STYLE[seal.status]);
}

const CONTENTS_LINE = 15;

function contentsTop(doc: PdfDoc): number {
  return doc.page.height - doc.page.margins.bottom - CONTENTS_LINE * (SECTIONS.length + 1) - 6;
}

/** Contents block at the foot of the cover, filled in once page numbers are known. */
function drawContents(doc: PdfDoc, starts: Map<Section, number>): void {
  doc.switchToPage(0);
  const lineHeight = CONTENTS_LINE;
  const top = contentsTop(doc);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ACCENT).text('Contents', left(doc), top, { lineBreak: false });
  doc.font('Helvetica').fontSize(9.5).fillColor('#000000');
  SECTIONS.forEach((section, i) => {
    const y = top + lineHeight * (i + 1) + 2;
    doc.text(`${i + 1}. ${section}`, left(doc), y, { lineBreak: false });
    doc.text(String((starts.get(section) ?? 0) + 1), left(doc), y, { width: width(doc), align: 'right', lineBreak: false });
  });
}

function currentPage(doc: PdfDoc): number {
  const range = doc.bufferedPageRange();
  return range.start + range.count - 1;
}

function drawOverview(doc: PdfDoc, model: AssessmentReportModel): void {
  heading(doc, '1. Overview');
  if (model.assessment.description) {
    paragraph(doc, model.assessment.description);
    doc.moveDown(0.6);
  }
  for (const summary of model.attestationSummaries) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text('Attestation summary');
    doc.moveDown(0.2);
    paragraph(doc, summary);
    doc.moveDown(0.6);
  }
  if (!model.assessment.description && model.attestationSummaries.length === 0) {
    paragraph(doc, 'No description or attestation summary has been recorded.', { color: MUTED });
  }
  doc.moveDown(0.6);
}

function attestedCell(conformance: number | null, confidence: number | null): string {
  if (conformance === null) return 'Not attested';
  return confidence === null ? formatPercent(conformance) : `${formatPercent(conformance)}\n${formatPercent(confidence)} conf.`;
}

function rationaleCell(rationale: string | null, attested: string | null): string {
  if (rationale && attested && attested !== rationale) return `${rationale}\nAttested: ${attested}`;
  return rationale ?? attested ?? '';
}

function drawRequirements(doc: PdfDoc, model: AssessmentReportModel): void {
  heading(doc, '2. Requirements');
  if (model.summary.requirementCount === 0) {
    paragraph(doc, 'No requirements are linked to this assessment.', { color: MUTED });
    doc.moveDown();
    return;
  }
  paragraph(
    doc,
    'Each row shows the assessed result, the attested conformance and confidence, and references to supporting evidence (E) and claims (C).',
    { size: 8.5, color: MUTED },
  );
  doc.moveDown(0.6);

  for (const group of model.groups) {
    if (group.title) {
      ensureSpace(doc, 60);
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(ACCENT).text(group.title, left(doc), doc.y, { width: width(doc) });
      if (group.description) {
        doc.moveDown(0.15);
        paragraph(doc, truncate(group.description, 300), { size: 8.5, color: MUTED });
      }
      doc.font('Helvetica').fillColor('#000000');
      doc.moveDown(0.3);
    }
    drawTable(
      doc,
      [
        { header: 'ID', width: 56 },
        { header: 'Requirement', width: 140 },
        { header: 'Result', width: 62 },
        { header: 'Attested', width: 50 },
        { header: 'Rationale', width: 139 },
        { header: 'Refs', width: 48 },
      ],
      group.requirements.map((req): TableCell[] => [
        { text: req.identifier, bold: true },
        truncate(req.name, 220),
        { text: RESULT_STYLE[req.result].label, color: RESULT_STYLE[req.result].color, bold: true },
        attestedCell(req.conformance, req.confidence),
        rationaleCell(req.rationale, req.attestedRationale),
        [...req.evidenceRefs, ...req.claimRefs].join(', '),
      ]),
    );
  }
}

function drawClaims(doc: PdfDoc, model: AssessmentReportModel): void {
  heading(doc, '3. Claims');
  if (model.claims.length === 0) {
    paragraph(doc, 'No claims are recorded for this assessment.', { color: MUTED });
    doc.moveDown();
    return;
  }
  drawTable(
    doc,
    [
      { header: 'Ref', width: 32 },
      { header: 'Claim', width: 178 },
      { header: 'Target', width: 70 },
      { header: 'Reasoning', width: 160 },
      { header: 'Evidence', width: 55 },
    ],
    model.claims.map((claim): TableCell[] => [
      claim.isCounterClaim
        ? { text: claim.ref, color: RESULT_STYLE.no.color, bold: true }
        : { text: claim.ref, bold: true },
      `${claim.name}${claim.isCounterClaim ? ' (counter-claim)' : ''}\n${claim.predicate}`,
      claim.target,
      claim.reasoning ? truncate(claim.reasoning, 260) : '',
      [
        claim.evidenceRefs.join(', '),
        claim.counterEvidenceRefs.length ? `Counter: ${claim.counterEvidenceRefs.join(', ')}` : '',
      ].filter(Boolean).join('\n'),
    ]),
  );
}

function drawSignatures(doc: PdfDoc, model: AssessmentReportModel): void {
  heading(doc, '4. Signatures and seal');
  const { affirmation } = model;
  const seal = sealLines(affirmation);
  callout(doc, SEAL_STYLE[seal.status].label, seal.lines, SEAL_STYLE[seal.status]);
  if (!affirmation) return;

  doc.font('Helvetica-Bold').fontSize(10).fillColor(ACCENT).text('Affirmation statement', left(doc));
  doc.moveDown(0.3);
  paragraph(doc, affirmation.statement, { size: 9.5 });
  doc.moveDown(0.8);

  if (affirmation.signatories.length === 0) {
    paragraph(doc, 'No signatory slots are defined.', { color: MUTED });
    return;
  }
  drawTable(
    doc,
    [
      { header: 'Signs as', width: 120 },
      { header: 'Signatory', width: 185 },
      { header: 'Signature', width: 90 },
      { header: 'Signed', width: 100 },
    ],
    affirmation.signatories.map((s): TableCell[] => [
      s.title,
      [s.name, s.role, s.organization].filter(Boolean).join('\n') || 'Not signed',
      s.signatureType
        ? { text: s.signatureType === 'digital' ? 'Digital' : 'Electronic', color: RESULT_STYLE.yes.color, bold: true }
        : { text: 'Pending', color: RESULT_STYLE.partial.color, bold: true },
      s.signedAt ? formatTimestamp(s.signedAt) : '',
    ]),
  );
}

function drawEvidence(doc: PdfDoc, model: AssessmentReportModel): void {
  heading(doc, '5. Evidence');
  if (model.evidence.length === 0) {
    paragraph(doc, 'No evidence is linked to this assessment.', { color: MUTED });
    return;
  }
  paragraph(doc, 'Each evidence item is listed once, with the requirements and claims it supports.', { size: 8.5, color: MUTED });
  doc.moveDown(0.6);
  drawTable(
    doc,
    [
      { header: 'Ref', width: 32 },
      { header: 'Evidence', width: 238 },
      { header: 'State', width: 60 },
      { header: 'Author', width: 75 },
      { header: 'Supports', width: 90 },
    ],
    model.evidence.map((e): TableCell[] => [
      { text: e.ref, bold: true },
      [
        e.isCounterEvidence ? `${e.name} (counter-evidence)` : e.name,
        e.description ? truncate(e.description, 260) : null,
        e.expiresOn ? `Expires ${formatReportDate(e.expiresOn)}` : null,
      ].filter(Boolean).join('\n'),
      e.state.replace(/_/g, ' '),
      e.author ?? '',
      e.supports.join(', '),
    ]),
  );
}

export async function renderAssessmentReportPdf(model: AssessmentReportModel): Promise<Buffer> {
  const doc = createReportDocument();
  const starts = new Map<Section, number>();
  const section = (name: Section, draw: () => void, newPage = true) => {
    // Break here rather than inside the heading so the recorded start
    // page is the one the heading lands on.
    if (newPage) doc.addPage();
    else ensureSpace(doc, 120);
    starts.set(name, currentPage(doc));
    draw();
  };

  drawCover(doc, model);
  const coverFits = currentPage(doc) === 0 && doc.y < contentsTop(doc);
  section('Overview', () => drawOverview(doc, model));
  section('Requirements', () => drawRequirements(doc, model), false);
  section('Claims', () => drawClaims(doc, model));
  section('Signatures and seal', () => drawSignatures(doc, model));
  section('Evidence', () => drawEvidence(doc, model));

  if (coverFits) drawContents(doc, starts);
  stampFooters(doc, model.generatedAt.toISOString());
  return renderToBuffer(doc);
}
