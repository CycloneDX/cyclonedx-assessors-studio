import { describe, it, expect } from 'vitest';
import type {
  AssessmentReportModel,
  ReportRequirement,
} from '../../services/assessment-report/model.js';
import { renderAssessmentReportPdf, verdictSentence } from '../../services/assessment-report/render-pdf.js';
import { countPdfPages, extractPdfPages } from '../helpers/pdf-text.js';

function requirement(identifier: string, overrides: Partial<ReportRequirement> = {}): ReportRequirement {
  return {
    id: identifier,
    identifier,
    name: `Requirement ${identifier}`,
    result: 'yes',
    rationale: `Rationale for ${identifier}`,
    conformance: 1,
    confidence: 0.9,
    attestedRationale: null,
    evidenceRefs: ['E1'],
    claimRefs: [],
    ...overrides,
  };
}

function model(overrides: Partial<AssessmentReportModel> = {}): AssessmentReportModel {
  return {
    generatedAt: new Date('2026-10-27T12:30:00Z'),
    assessment: {
      id: 'a1',
      title: 'Supplier A SSDF Assessment',
      description: 'Assessment of Supplier A.',
      state: 'complete',
      startDate: new Date('2026-01-05T00:00:00Z'),
      dueDate: new Date('2026-02-27T00:00:00Z'),
      endDate: null,
    },
    project: '2026 Security Assessments',
    standard: 'SSDF 1.1',
    target: 'Supplier A',
    assessors: ['Jane Thompson'],
    assessees: ['Sara Patil'],
    attestationSummaries: ['Supplier A substantially meets SSDF.'],
    summary: {
      requirementCount: 3,
      assessedCount: 3,
      resultCounts: { yes: 1, partial: 1, no: 1, not_applicable: 0, not_assessed: 0 },
      attestedCount: 3,
      meanConformance: 0.5,
      meanConfidence: 0.6,
      evidenceCount: 1,
      claimCount: 1,
      counterClaimCount: 0,
    },
    groups: [
      {
        title: 'PO',
        description: 'Prepare the Organization: organizations should ensure that their people, processes, and technology are prepared.',
        requirements: [
          requirement('PO.1.1'),
          requirement('PO.1.2', { result: 'partial', conformance: 0.5, confidence: 0.5 }),
        ],
      },
      {
        title: 'PW Produce Well-Secured Software',
        description: null,
        requirements: [requirement('PW.1.1', { result: 'no', conformance: 0, confidence: 0, claimRefs: ['C1'] })],
      },
    ],
    claims: [{
      ref: 'C1', name: 'Hardened builds', predicate: 'Builds use hardening flags', target: 'Supplier A',
      reasoning: 'Reviewed build configs', isCounterClaim: false, evidenceRefs: ['E1'], counterEvidenceRefs: [],
    }],
    evidence: [{
      ref: 'E1', name: 'Build configuration', description: 'Compiler flags', state: 'claimed', author: 'Jane Thompson',
      expiresOn: null, isCounterEvidence: false, supports: ['PO.1.1', 'PO.1.2', 'C1'],
    }],
    affirmation: {
      statement: 'We attest to Supplier A conformance.',
      signatories: [
        { title: 'CISO', name: 'Alice Chen', role: 'CISO', organization: 'Acme', signatureType: 'digital', signedAt: new Date('2026-03-01T10:00:00Z') },
        { title: 'Lead assessor', name: null, role: null, organization: null, signatureType: null, signedAt: null },
      ],
      sealStatus: 'verified',
      sealedAt: new Date('2026-03-02T09:00:00Z'),
      platformKeyFingerprint: '8b110332f2032e621a0a',
      issues: [],
    },
    ...overrides,
  };
}

async function render(m: AssessmentReportModel) {
  const pdf = await renderAssessmentReportPdf(m);
  const pages = extractPdfPages(pdf);
  return { pdf, pages, text: pages.map((p) => p.text).join('\n') };
}

describe('verdictSentence', () => {
  it('lists the non-empty result counts in order', () => {
    expect(verdictSentence(model())).toBe(
      'Of 3 requirements in scope, 1 conforms, 1 partially conforms and 1 does not conform.',
    );
  });

  it('handles an assessment with no requirements', () => {
    const empty = model();
    empty.summary = { ...empty.summary, requirementCount: 0 };
    expect(verdictSentence(empty)).toBe('No requirements are linked to this assessment.');
  });
});

describe('renderAssessmentReportPdf', () => {
  it('puts the executive summary, seal status and contents on the cover', async () => {
    const { pages } = await render(model());
    const cover = pages[0].text;

    expect(cover).toContain('Assessment Report');
    expect(cover).toContain('Supplier A SSDF Assessment');
    expect(cover).toContain('Executive summary');
    expect(cover).toContain('Of 3 requirements in scope, 1 conforms, 1 partially conforms and 1 does not conform.');
    expect(cover).toContain('3 / 3');
    expect(cover).toContain('50%');
    expect(cover).toContain('Seal verified');
    expect(cover).toContain('1 of 2 signatories have signed.');
    expect(cover).toContain('Contents');
  });

  it('gives each contents entry the page its section starts on', async () => {
    const { pages } = await render(model());
    const headings = ['1. Overview', '2. Requirements', '3. Claims', '4. Signatures and seal', '5. Evidence'];
    const coverItems = pages[0].items;

    for (const heading of headings) {
      const actual = pages.findIndex((p, i) => i > 0 && p.items.some((it) => it.text === heading)) + 1;
      const entry = coverItems.find((it) => it.text === heading)!;
      const pageNumber = coverItems.find((it) => it.y === entry.y && /^\d+$/.test(it.text));
      expect(pageNumber?.text).toBe(String(actual));
    }
  });

  it('shows group headings, coloured result labels and attested scores in one table', async () => {
    const { text } = await render(model());

    expect(text).toContain('Prepare the Organization: organizations should ensure');
    expect(text).toContain('PW Produce Well-Secured Software');
    expect(text).toMatch(/PO\.1\.1[\s\S]*Conforms[\s\S]*100%/);
    expect(text).toContain('Partial');
    expect(text).toContain('Does not conform');
    // Zero scores are real scores.
    expect(text).toContain('0% conf.');
    expect(text.indexOf('PO.1.2')).toBeLessThan(text.indexOf('PW.1.1'));
  });

  it('lists claims, signatories and each evidence item once', async () => {
    const { text } = await render(model());

    expect(text).toMatch(/C1\nHardened builds\nBuilds use hardening flags/);
    expect(text).toContain('Builds use hardening flags');
    expect(text).toContain('We attest to Supplier A conformance.');
    expect(text).toContain('Alice Chen');
    expect(text).toContain('Digital');
    expect(text).toContain('Pending');
    expect(text.match(/Build configuration/g)).toHaveLength(1);
    expect(text).toContain('PO.1.1, PO.1.2, C1');
  });

  it('says when there is no affirmation, claims or evidence', async () => {
    const { text } = await render(model({ affirmation: null, claims: [], evidence: [] }));

    expect(text).toContain('No affirmation recorded');
    expect(text).toContain('No claims are recorded for this assessment.');
    expect(text).toContain('No evidence is linked to this assessment.');
  });

  it('flags a failed seal with its issues', async () => {
    const m = model();
    m.affirmation = { ...m.affirmation!, sealStatus: 'failed', issues: ['Slot x canonical payload has drifted since signing'] };
    const { pages } = await render(m);

    expect(pages[0].text).toContain('Seal verification failed');
    expect(pages[0].text).toContain('Issue: Slot x canonical payload has drifted since signing');
  });

  it('paginates long requirement tables without blank pages', async () => {
    const many = Array.from({ length: 120 }, (_, i) => requirement(`R.${i + 1}`, {
      name: `A long requirement name that wraps over more than one line in the table, number ${i + 1}`,
    }));
    const { pdf, pages } = await render(model({ groups: [{ title: null, description: null, requirements: many }] }));
    const pageCount = countPdfPages(pdf);

    expect(pages).toHaveLength(pageCount);
    pages.forEach((page, i) => {
      expect(page.text).toContain(`Page ${i + 1} of ${pageCount}`);
      const body = page.items.filter((it) => !it.text.startsWith('Generated by') && !it.text.startsWith('Page '));
      expect(body.length).toBeGreaterThan(0);
    });
    // Continuation pages repeat the table header.
    const tablePages = pages.filter((p) => p.items.some((it) => /^R\.\d+$/.test(it.text)));
    expect(tablePages.length).toBeGreaterThan(2);
    for (const page of tablePages) {
      expect(page.items.some((it) => it.text === 'Rationale')).toBe(true);
    }
  });
});
