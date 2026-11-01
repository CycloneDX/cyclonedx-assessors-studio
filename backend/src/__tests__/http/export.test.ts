import { describe, it, expect } from 'vitest';
import {
  setupHttpTests,
  loginAs,
  getAgent,
  testUsers,
  forceAssessmentStateForTests,
} from '../helpers/http.js';
import { binaryParser, countPdfPages, extractPdfPages } from '../helpers/pdf-text.js';

describe('Export HTTP Routes', () => {
  setupHttpTests();

  /**
   * Helper to create comprehensive test data: project, standard with requirements,
   * assessment, assessment_assessor link, assessment_requirement links,
   * attestation, attestation_requirement links with scores, claims, and evidence.
   * Returns { projectId, standardId, assessmentId, requirementIds, attestationId }
   */
  let testDataCounter = 0;
  async function createFullTestData(
    agent: any,
    opts: { assessorIds?: string[] } = {}
  ) {
    testDataCounter++;
    const suffix = testDataCounter;

    // Create standard
    const standardRes = await agent
      .post('/api/v1/standards')
      .send({
        identifier: `EXP-STD-${suffix}-${Date.now()}`,
        name: `Export Test Standard ${suffix}`,
        version: '1.0',
      });
    expect(standardRes.status).toBe(201);
    const standardId = standardRes.body.id;

    // Create requirements
    const requirementIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const reqRes = await agent
        .post(`/api/v1/standards/${standardId}/requirements`)
        .send({
          identifier: `EXP-REQ-${suffix}-${i}`,
          name: `Export Requirement ${suffix}-${i}`,
          description: `Export test requirement ${suffix}-${i}`,
        });
      expect(reqRes.status).toBe(201);
      requirementIds.push(reqRes.body.id);
    }

    // Create project with standard
    const projectRes = await agent
      .post('/api/v1/projects')
      .send({
        name: `Export Test Project ${suffix}`,
        description: 'Project for export tests',
        standardIds: [standardId],
      });
    expect(projectRes.status).toBe(201);
    const projectId = projectRes.body.id;

    // Create assessment (optionally with pre-linked assessors so export
    // tests that exercise the declarations.assessors shape can control
    // whether the array is present).
    const assessmentRes = await agent
      .post('/api/v1/assessments')
      .send({
        title: `Export Test Assessment ${suffix}`,
        description: 'Assessment for export tests',
        projectId,
        ...(opts.assessorIds ? { assessorIds: opts.assessorIds } : {}),
      });
    expect(assessmentRes.status).toBe(201);
    const assessmentId = assessmentRes.body.id;

    // Attestations may only be authored on completed assessments —
    // force the fixture into a 'complete' state for the rest of the
    // test. The legitimate transition matrix requires scoring and
    // evidence linkage we don't care about exercising here.
    await forceAssessmentStateForTests(assessmentId, 'complete');

    // Create attestation
    const attestationRes = await agent
      .post('/api/v1/attestations')
      .send({
        assessmentId,
        summary: `Export Attestation ${suffix}`,
      });
    expect(attestationRes.status).toBe(201);
    const attestationId = attestationRes.body.id;

    // Add requirements to attestation
    for (let i = 0; i < requirementIds.length; i++) {
      const addReqRes = await agent
        .post(`/api/v1/attestations/${attestationId}/requirements`)
        .send({
          requirementId: requirementIds[i],
          conformanceScore: 0.75 + (i * 0.1),
          conformanceRationale: `Conformance rationale for requirement ${i}`,
          confidenceScore: 0.85 + (i * 0.05),
          confidenceRationale: `Confidence rationale for requirement ${i}`,
        });
      expect(addReqRes.status).toBe(201);
    }

    return { projectId, standardId, assessmentId, requirementIds, attestationId };
  }

  /**
   * Helper to create minimal test data (assessment only, no full hierarchy)
   */
  let minimalDataCounter = 0;
  async function createMinimalTestData(agent: any) {
    minimalDataCounter++;
    const suffix = minimalDataCounter;

    // Create standard (required for project)
    const standardRes = await agent
      .post('/api/v1/standards')
      .send({
        identifier: `MIN-STD-${suffix}-${Date.now()}`,
        name: `Minimal Standard ${suffix}`,
        version: '1.0',
      });
    expect(standardRes.status).toBe(201);
    const standardId = standardRes.body.id;

    // Create project with standard
    const projectRes = await agent
      .post('/api/v1/projects')
      .send({
        name: `Minimal Export Project ${suffix}`,
        description: 'Minimal test project',
        standardIds: [standardId],
      });
    expect(projectRes.status).toBe(201);
    const projectId = projectRes.body.id;

    // Create assessment
    const assessmentRes = await agent
      .post('/api/v1/assessments')
      .send({
        title: `Minimal Export Assessment ${suffix}`,
        description: 'Minimal assessment for export',
        projectId,
      });
    expect(assessmentRes.status).toBe(201);
    const assessmentId = assessmentRes.body.id;

    return { projectId, assessmentId };
  }

  describe('GET /api/v1/export/assessment/:assessmentId', () => {
    it('should export assessment as CycloneDX JSON with full structure', async () => {
      const agent = await loginAs('admin');
      const { assessmentId, standardId } = await createFullTestData(agent);

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/vnd.cyclonedx+json');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('cdx-1.7.json');

      // Verify BOM structure
      expect(res.body).toHaveProperty('$schema');
      expect(res.body).toHaveProperty('bomFormat');
      expect(res.body).toHaveProperty('specVersion');
      expect(res.body).toHaveProperty('serialNumber');
      expect(res.body).toHaveProperty('version');
      expect(res.body).toHaveProperty('metadata');
      expect(res.body).toHaveProperty('declarations');
      expect(res.body).toHaveProperty('definitions');

      // Verify CycloneDX schema — defaults to 1.7 (ECMA-424 2nd Edition)
      expect(res.body.$schema).toBe('http://cyclonedx.org/schema/bom-1.7.schema.json');
      expect(res.body.bomFormat).toBe('CycloneDX');
      expect(res.body.specVersion).toBe('1.7');
      expect(res.body.serialNumber).toMatch(/^urn:uuid:/);
      expect(res.body.version).toBe(1);

      // Brand guard: the tool identity embedded in every exported BOM is
      // the product name.
      expect(res.body.metadata.tools.components[0].name).toBe('CycloneDX Assessors Studio');

      // Verify metadata
      expect(res.body.metadata.timestamp).toBeDefined();
      expect(res.body.metadata.tools).toBeDefined();
      expect(Array.isArray(res.body.metadata.tools.components)).toBe(true);

      // Verify declarations structure. Per CycloneDX schema, optional
      // arrays are omitted when empty rather than emitted as `[]`, so
      // assessors/evidence/targets are only present when populated.
      expect(Array.isArray(res.body.declarations.attestations)).toBe(true);
      expect(Array.isArray(res.body.declarations.claims)).toBe(true);
      if (res.body.declarations.assessors !== undefined) {
        expect(Array.isArray(res.body.declarations.assessors)).toBe(true);
      }
      if (res.body.declarations.evidence !== undefined) {
        expect(Array.isArray(res.body.declarations.evidence)).toBe(true);
      }
      if (res.body.declarations.targets !== undefined) {
        expect(typeof res.body.declarations.targets).toBe('object');
      }

      // Verify definitions structure
      expect(Array.isArray(res.body.definitions.standards)).toBe(true);
    });

    it('should include assessors in CycloneDX declarations', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent, {
        assessorIds: [testUsers.assessor.id],
      });

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.declarations.assessors)).toBe(true);
      expect(res.body.declarations.assessors.length).toBe(1);

      // The CycloneDX assessor object only permits `bom-ref`,
      // `organization`, and `thirdParty`. The person's display name
      // and email belong inside `organization.contact[]`, never at the
      // top level (which would fail additionalProperties validation).
      const assessor = res.body.declarations.assessors[0];
      expect(assessor).toHaveProperty('bom-ref');
      expect(assessor['bom-ref']).toMatch(/^assessor-/);
      expect(assessor).not.toHaveProperty('name');
      expect(assessor).not.toHaveProperty('email');
      expect(assessor.organization).toBeDefined();
      expect(Array.isArray(assessor.organization.contact)).toBe(true);
      expect(assessor.organization.contact[0].name).toBe('Test Assessor');
      expect(assessor.organization.contact[0].email).toBe(testUsers.assessor.email);
    });

    it('should include attestations with requirements and scores', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent, {
        assessorIds: [testUsers.assessor.id],
      });

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}`);

      expect(res.status).toBe(200);
      expect(res.body.declarations.attestations.length).toBeGreaterThan(0);

      const attestation = res.body.declarations.attestations[0];
      // The attestation references its assessor by bom-ref. The
      // writer only sets this when an assessor is linked to the
      // assessment, so this test seeds one above.
      expect(attestation).toHaveProperty('assessor');
      expect(attestation.assessor).toMatch(/^assessor-/);
      expect(attestation).toHaveProperty('map');
      expect(Array.isArray(attestation.map)).toBe(true);

      // Each requirement map carries the conformance block and,
      // because the test seeds confidence scores, a confidence block.
      // The `claims`/`counterClaims` arrays are schema-omitted when
      // empty so we only assert them when present.
      if (attestation.map.length > 0) {
        const requirementMap = attestation.map[0];
        expect(requirementMap).toHaveProperty('requirement');
        expect(requirementMap).toHaveProperty('conformance');
        expect(requirementMap).toHaveProperty('confidence');

        expect(requirementMap.conformance).toHaveProperty('score');
        expect(typeof requirementMap.conformance.score).toBe('number');
        expect(requirementMap.conformance).toHaveProperty('rationale');
        expect(typeof requirementMap.confidence.score).toBe('number');
        expect(requirementMap.confidence.rationale).toBeDefined();

        if (requirementMap.claims !== undefined) {
          expect(Array.isArray(requirementMap.claims)).toBe(true);
        }
        if (requirementMap.counterClaims !== undefined) {
          expect(Array.isArray(requirementMap.counterClaims)).toBe(true);
        }
      }
    });

    it('should include standards in definitions', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent);

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}`);

      expect(res.status).toBe(200);
      expect(res.body.definitions.standards.length).toBeGreaterThan(0);

      // The CycloneDX standard object defines `bom-ref`, `name`,
      // `version`, `description`, `owner`, `requirements`, `levels`,
      // `externalReferences`, and `signature`. There is no
      // `identifier` property at the standard level; the internal DB
      // identifier column flows through only via the bom-ref. The
      // bom-ref is the imported value when present (verbatim from
      // the source feed) and falls back to `standard-<uuid>`
      // otherwise.
      const standard = res.body.definitions.standards[0];
      expect(standard).toHaveProperty('bom-ref');
      expect(typeof standard['bom-ref']).toBe('string');
      expect((standard['bom-ref'] as string).length).toBeGreaterThan(0);
      expect(standard).toHaveProperty('name');
      expect(standard).not.toHaveProperty('identifier');
      expect(standard).toHaveProperty('requirements');
      expect(Array.isArray(standard.requirements)).toBe(true);

      if (standard.requirements.length > 0) {
        // Each requirement uses `title`/`text` (the schema names)
        // rather than the DB column names `name`/`description`.
        // Requirements imported via the standards route preserve the
        // original bom-ref; test fixtures crafted by this suite have
        // no upstream bom-ref, so the writer synthesises
        // `requirement-<uuid>`.
        const req = standard.requirements[0];
        expect(req).toHaveProperty('bom-ref');
        expect(typeof req['bom-ref']).toBe('string');
        expect((req['bom-ref'] as string).length).toBeGreaterThan(0);
        expect(req).toHaveProperty('identifier');
        expect(req).toHaveProperty('title');
        expect(req).not.toHaveProperty('name');
        expect(req).not.toHaveProperty('description');
      }
    });

    it('should return 404 for non-existent assessment', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get('/api/v1/export/assessment/00000000-0000-0000-0000-000000000000');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('Assessment not found');
    });

    it('should return 401 for unauthenticated request', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent.get('/api/v1/export/assessment/00000000-0000-0000-0000-000000000000');

      expect(res.status).toBe(401);
    });

    it('should return 403 for user without export permission', async () => {
      const adminAgent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(adminAgent);

      const assesseeAgent = await loginAs('assessee');
      const res = await assesseeAgent.get(`/api/v1/export/assessment/${assessmentId}`);

      // Should be forbidden due to lack of export.cyclonedx permission
      expect(res.status).toBe(403);
    });

    it('should export minimal assessment without claims or evidence', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createMinimalTestData(agent);

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}`);

      expect(res.status).toBe(200);
      expect(res.body.bomFormat).toBe('CycloneDX');
      // Project requires a standard, so definitions.standards will have the linked standard
      expect(Array.isArray(res.body.definitions.standards)).toBe(true);
      // claims is always emitted (even empty) because the writer
      // spreads it unconditionally. evidence is omitted entirely when
      // empty, per schema conformance (no evidence === no key).
      expect(res.body.declarations.claims).toEqual([]);
      expect(res.body.declarations.evidence).toBeUndefined();
    });

    it('should set correct content-disposition header with assessment ID', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent);

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}`);

      expect(res.status).toBe(200);
      const disposition = res.headers['content-disposition'];
      expect(disposition).toContain('attachment');
      expect(disposition).toContain(`assessment-${assessmentId}`);
      // Filename now includes the spec version suffix (default 1.7).
      expect(disposition).toContain('cdx-1.7.json');
    });

    it('should require assessor or admin role', async () => {
      const adminAgent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(adminAgent);

      const assessorAgent = await loginAs('assessor');
      const res = await assessorAgent.get(`/api/v1/export/assessment/${assessmentId}`);

      // Assessor should have export permission
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/v1/export/assessment/:assessmentId/pdf', () => {
    it('should export assessment as PDF with correct headers', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent);

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}/pdf`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('.pdf');
      expect(res.headers['content-length']).toBeDefined();
    });

    it('should return PDF as binary data', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent);

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}/pdf`);

      expect(res.status).toBe(200);
      // PDF files start with %PDF magic bytes
      expect(res.body).toBeDefined();
      if (Buffer.isBuffer(res.body)) {
        expect(res.body.toString('utf8', 0, 4)).toBe('%PDF');
      }
    });

    it('should include assessment title in filename', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent);

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}/pdf`);

      expect(res.status).toBe(200);
      const disposition = res.headers['content-disposition'];
      expect(disposition).toContain('assessment-');
      expect(disposition).toContain('-report.pdf');
    });

    it('should sanitize assessment title in filename', async () => {
      const agent = await loginAs('admin');

      // Create assessment with special characters in title
      const projectRes = await agent
        .post('/api/v1/projects')
        .send({
          name: 'Title Sanitization Project',
          description: 'Test special chars in title',
        });
      const projectId = projectRes.body.id;

      const assessmentRes = await agent
        .post('/api/v1/assessments')
        .send({
          title: 'Assessment!@#$%^&*()',
          description: 'Special chars in title',
          projectId,
        });
      const assessmentId = assessmentRes.body.id;

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}/pdf`);

      expect(res.status).toBe(200);
      const disposition = res.headers['content-disposition'];
      // Should have sanitized the special characters
      expect(disposition).not.toContain('!');
      expect(disposition).not.toContain('@');
      expect(disposition).not.toContain('#');
    });

    it('should return 404 for non-existent assessment', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get('/api/v1/export/assessment/00000000-0000-0000-0000-000000000000/pdf');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('Assessment not found');
    });

    it('should return 401 for unauthenticated request', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent.get('/api/v1/export/assessment/00000000-0000-0000-0000-000000000000/pdf');

      expect(res.status).toBe(401);
    });

    it('should return 403 for user without export.pdf permission', async () => {
      const adminAgent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(adminAgent);

      const assesseeAgent = await loginAs('assessee');
      const res = await assesseeAgent.get(`/api/v1/export/assessment/${assessmentId}/pdf`);

      expect(res.status).toBe(403);
    });

    it('should set content-length header', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent);

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}/pdf`);

      expect(res.status).toBe(200);
      expect(res.headers['content-length']).toBeDefined();
      const contentLength = parseInt(res.headers['content-length'] as string);
      expect(contentLength).toBeGreaterThan(0);
    });

    it('should generate PDF with assessment content', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent);

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}/pdf`);

      expect(res.status).toBe(200);
      // Verify it's a valid PDF by checking the magic bytes and content-type
      // PDF compression makes text content unreadable as plaintext
      if (Buffer.isBuffer(res.body)) {
        expect(res.body.toString('utf8', 0, 4)).toBe('%PDF');
      }
      expect(res.headers['content-type']).toBe('application/pdf');
    });

    it('should require assessor or admin role', async () => {
      const adminAgent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(adminAgent);

      const assessorAgent = await loginAs('assessor');
      const res = await assessorAgent.get(`/api/v1/export/assessment/${assessmentId}/pdf`);

      // Assessor should have export.pdf permission
      expect(res.status).toBe(200);
    });
  });

  describe('Assessment PDF layout and content', () => {
    async function getPdf(agent: any, url: string): Promise<Buffer> {
      const res = await agent.get(url).buffer(true).parse(binaryParser);
      expect(res.status).toBe(200);
      return res.body as Buffer;
    }

    it('adds no blank footer-only pages and numbers every page', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent);

      const pdf = await getPdf(agent, `/api/v1/export/assessment/${assessmentId}/pdf`);
      const pageCount = countPdfPages(pdf);
      const pages = extractPdfPages(pdf);

      // Cover, overview + requirements, claims, signatures, evidence.
      expect(pageCount).toBe(5);
      expect(pages).toHaveLength(pageCount);
      pages.forEach((page, i) => {
        expect(page.text).toContain(`Page ${i + 1} of ${pageCount}`);
        const content = page.items.filter(
          (it) => !it.text.startsWith('Generated by CycloneDX Assessors Studio') && !it.text.startsWith('Page '),
        );
        expect(content.length).toBeGreaterThan(0);
      });
    });

    it('prints a 0 score as 0%, not N/A', async () => {
      const agent = await loginAs('admin');
      const { standardId, attestationId, assessmentId } = await createFullTestData(agent);

      const reqRes = await agent
        .post(`/api/v1/standards/${standardId}/requirements`)
        .send({ identifier: 'EXP-ZERO', name: 'Zero score requirement' });
      expect(reqRes.status).toBe(201);
      const addRes = await agent
        .post(`/api/v1/attestations/${attestationId}/requirements`)
        .send({
          requirementId: reqRes.body.id,
          conformanceScore: 0,
          conformanceRationale: 'Control is absent',
          confidenceScore: 0,
        });
      expect(addRes.status).toBe(201);

      const pdf = await getPdf(agent, `/api/v1/export/assessment/${assessmentId}/pdf`);
      const text = extractPdfPages(pdf).map((p) => p.text).join('\n');

      const zeroRow = text.slice(text.indexOf('Zero score requirement'), text.indexOf('Control is absent'));
      expect(zeroRow).toContain('0%');
      expect(zeroRow).toContain('0% conf.');
      expect(zeroRow).not.toContain('Not attested');
    });

    it('states when no requirements are linked', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createMinimalTestData(agent);

      const pdf = await getPdf(agent, `/api/v1/export/assessment/${assessmentId}/pdf`);
      const text = extractPdfPages(pdf).map((p) => p.text).join('\n');

      expect(text).toContain('No requirements are linked to this assessment.');
    });
  });

  describe('GET /api/v1/export/project/:projectId/pdf', () => {
    it('returns a PDF project report, not JSON', async () => {
      const agent = await loginAs('admin');
      const { projectId } = await createFullTestData(agent);

      const res = await agent
        .get(`/api/v1/export/project/${projectId}/pdf`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('-report.pdf');
      const pdf = res.body as Buffer;
      expect(pdf.toString('latin1', 0, 5)).toBe('%PDF-');

      const pages = extractPdfPages(pdf);
      const text = pages.map((p) => p.text).join('\n');
      expect(text).toContain('Project Report');
      expect(text).toMatch(/Export Test Project \d+/);
      expect(text).toMatch(/Export Test Assessment \d+/);
      expect(text).toContain('Assessments: 1 (1 complete, 0 in progress)');
      expect(text).toContain('Attestations: 1');
      // The fixture's attestation scores are 0.75, 0.85 and 0.95.
      expect(text).toContain('85%');
      pages.forEach((page, i) => {
        expect(page.text).toContain(`Page ${i + 1} of ${pages.length}`);
      });
    });

    it('reports a project with no assessments', async () => {
      const agent = await loginAs('admin');
      const { standardId } = await createFullTestData(agent);
      const projectRes = await agent
        .post('/api/v1/projects')
        .send({ name: 'Empty PDF Project', description: 'No assessments', standardIds: [standardId] });
      expect(projectRes.status).toBe(201);

      const res = await agent
        .get(`/api/v1/export/project/${projectRes.body.id}/pdf`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      const text = extractPdfPages(res.body as Buffer).map((p) => p.text).join('\n');
      expect(text).toContain('This project has no assessments.');
    });

    it('returns 404 for non-existent project', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/export/project/00000000-0000-0000-0000-000000000000/pdf');
      expect(res.status).toBe(404);
    });

    it('returns 401 for unauthenticated request', async () => {
      const res = await getAgent().get('/api/v1/export/project/00000000-0000-0000-0000-000000000000/pdf');
      expect(res.status).toBe(401);
    });

    it('returns 403 for user without export.pdf permission', async () => {
      const adminAgent = await loginAs('admin');
      const { projectId } = await createFullTestData(adminAgent);

      const assesseeAgent = await loginAs('assessee');
      const res = await assesseeAgent.get(`/api/v1/export/project/${projectId}/pdf`);

      expect(res.status).toBe(403);
    });

    it('allows assessors', async () => {
      const adminAgent = await loginAs('admin');
      const { projectId } = await createFullTestData(adminAgent);

      const assessorAgent = await loginAs('assessor');
      const res = await assessorAgent.get(`/api/v1/export/project/${projectId}/pdf`);

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/v1/export/project/:projectId', () => {
    it('should export project as CycloneDX JSON with multiple assessments', async () => {
      const agent = await loginAs('admin');
      const { projectId: projectId1 } = await createFullTestData(agent);
      const { projectId: projectId2 } = await createFullTestData(agent);

      // Create another assessment in the first project
      const standardRes = await agent
        .post('/api/v1/standards')
        .send({
          identifier: `MULTI-STD-${Date.now()}`,
          name: 'Multi Assessment Standard',
          version: '1.0',
        });
      const standardId = standardRes.body.id;

      const reqRes = await agent
        .post(`/api/v1/standards/${standardId}/requirements`)
        .send({
          identifier: 'MULTI-REQ-1',
          name: 'Multi Assessment Requirement',
          description: 'Test requirement for multiple assessments',
        });
      const requirementId = reqRes.body.id;

      const projectRes = await agent
        .post('/api/v1/projects')
        .send({
          name: `Multi Assessment Project ${Date.now()}`,
          description: 'Project with multiple assessments',
          standardIds: [standardId],
        });
      const projectId = projectRes.body.id;

      // Create two assessments in the project
      const assessment1Res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Assessment 1 Multi ${Date.now()}`,
          description: 'First assessment',
          projectId,
        });
      const assessmentId1 = assessment1Res.body.id;

      const assessment2Res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Assessment 2 Multi ${Date.now()}`,
          description: 'Second assessment',
          projectId,
        });
      const assessmentId2 = assessment2Res.body.id;

      // Both assessments must be complete before attestations can be
      // authored against them.
      await forceAssessmentStateForTests(assessmentId1, 'complete');
      await forceAssessmentStateForTests(assessmentId2, 'complete');

      // Create attestations
      const att1Res = await agent
        .post('/api/v1/attestations')
        .send({
          assessmentId: assessmentId1,
          summary: 'Attestation 1',
        });

      const att2Res = await agent
        .post('/api/v1/attestations')
        .send({
          assessmentId: assessmentId2,
          summary: 'Attestation 2',
        });

      const res = await agent.get(`/api/v1/export/project/${projectId}`);

      expect(res.status).toBe(200);
      // CycloneDX exports now advertise the registered media type.
      expect(res.headers['content-type']).toContain('application/vnd.cyclonedx+json');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('project-');

      // Verify project BOM structure
      expect(res.body).toHaveProperty('bomFormat');
      expect(res.body.bomFormat).toBe('CycloneDX');
      expect(res.body).toHaveProperty('declarations');
      expect(res.body).toHaveProperty('definitions');

      // Should have merged attestations from both assessments
      expect(Array.isArray(res.body.declarations.attestations)).toBe(true);
    });

    it('should merge assessors from multiple assessments', async () => {
      const agent = await loginAs('admin');

      // Create standard and requirements
      const standardRes = await agent
        .post('/api/v1/standards')
        .send({
          identifier: `MERGE-STD-${Date.now()}`,
          name: 'Merge Assessors Standard',
          version: '1.0',
        });
      const standardId = standardRes.body.id;

      const reqRes = await agent
        .post(`/api/v1/standards/${standardId}/requirements`)
        .send({
          identifier: 'MERGE-REQ-1',
          name: 'Merge Requirement',
          description: 'Test',
        });

      // Create project
      const projectRes = await agent
        .post('/api/v1/projects')
        .send({
          name: `Merge Assessors Project ${Date.now()}`,
          description: 'Test assessor merging',
          standardIds: [standardId],
        });
      const projectId = projectRes.body.id;

      // Create assessments, each with the same assessor linked. The
      // merge step at the project level deduplicates by bom-ref so
      // the merged BOM should carry exactly one assessor entry
      // despite two source assessments.
      const assessment1Res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Assessment Merge 1 ${Date.now()}`,
          projectId,
          assessorIds: [testUsers.assessor.id],
        });
      expect(assessment1Res.status).toBe(201);

      const assessment2Res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Assessment Merge 2 ${Date.now()}`,
          projectId,
          assessorIds: [testUsers.assessor.id],
        });
      expect(assessment2Res.status).toBe(201);

      const res = await agent.get(`/api/v1/export/project/${projectId}`);

      expect(res.status).toBe(200);
      expect(res.body.declarations.assessors).toBeDefined();
      expect(Array.isArray(res.body.declarations.assessors)).toBe(true);
      expect(res.body.declarations.assessors.length).toBe(1);
      expect(res.body.declarations.assessors[0]['bom-ref']).toMatch(/^assessor-/);
    });

    it('should merge standards from multiple assessments', async () => {
      const agent = await loginAs('admin');

      // Create two standards
      const std1Res = await agent
        .post('/api/v1/standards')
        .send({
          identifier: `STD1-${Date.now()}`,
          name: 'First Standard',
          version: '1.0',
        });
      const standardId1 = std1Res.body.id;

      const std2Res = await agent
        .post('/api/v1/standards')
        .send({
          identifier: `STD2-${Date.now()}`,
          name: 'Second Standard',
          version: '1.0',
        });
      const standardId2 = std2Res.body.id;

      // Create requirements
      await agent
        .post(`/api/v1/standards/${standardId1}/requirements`)
        .send({
          identifier: 'STD1-REQ',
          name: 'Standard 1 Requirement',
          description: 'Test',
        });

      await agent
        .post(`/api/v1/standards/${standardId2}/requirements`)
        .send({
          identifier: 'STD2-REQ',
          name: 'Standard 2 Requirement',
          description: 'Test',
        });

      // Create project with both standards
      const projectRes = await agent
        .post('/api/v1/projects')
        .send({
          name: `Multi Standard Project ${Date.now()}`,
          description: 'Test standard merging',
          standardIds: [standardId1, standardId2],
        });
      const projectId = projectRes.body.id;

      // Each assessment is scoped to a single standard under the
      // new export rule ("only the standard(s) being attested to").
      // Create one assessment per standard so the project-level
      // export merges distinct standards from every assessment.
      const assessment1Res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Std1 Assessment ${Date.now()}`,
          projectId,
          standardId: standardId1,
        });
      expect(assessment1Res.status).toBe(201);

      const assessment2Res = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Std2 Assessment ${Date.now()}`,
          projectId,
          standardId: standardId2,
        });
      expect(assessment2Res.status).toBe(201);

      const res = await agent.get(`/api/v1/export/project/${projectId}`);

      expect(res.status).toBe(200);
      expect(res.body.definitions.standards.length).toBeGreaterThanOrEqual(2);
    });

    it('should return 404 for non-existent project', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get('/api/v1/export/project/00000000-0000-0000-0000-000000000000');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('Project not found');
    });

    it('should return 401 for unauthenticated request', async () => {
      const unauthAgent = getAgent();

      const res = await unauthAgent.get('/api/v1/export/project/00000000-0000-0000-0000-000000000000');

      expect(res.status).toBe(401);
    });

    it('should return 403 for user without export permission', async () => {
      const adminAgent = await loginAs('admin');
      const { projectId } = await createFullTestData(adminAgent);

      const assesseeAgent = await loginAs('assessee');
      const res = await assesseeAgent.get(`/api/v1/export/project/${projectId}`);

      expect(res.status).toBe(403);
    });

    it('should export project with no assessments', async () => {
      const agent = await loginAs('admin');

      // Create a standard first
      const standardRes = await agent
        .post('/api/v1/standards')
        .send({
          identifier: `EMPTY-STD-${Date.now()}`,
          name: 'Empty Project Standard',
          version: '1.0',
        });
      expect(standardRes.status).toBe(201);
      const standardId = standardRes.body.id;

      const projectRes = await agent
        .post('/api/v1/projects')
        .send({
          name: `Empty Export Project ${Date.now()}`,
          description: 'Project with no assessments',
          standardIds: [standardId],
        });
      expect(projectRes.status).toBe(201);
      const projectId = projectRes.body.id;

      const res = await agent.get(`/api/v1/export/project/${projectId}`);

      expect(res.status).toBe(200);
      expect(res.body.bomFormat).toBe('CycloneDX');
      // attestations is always emitted (writer spreads it
      // unconditionally) but assessors is omitted when empty per
      // schema conformance.
      expect(res.body.declarations.attestations).toEqual([]);
      expect(res.body.declarations.assessors).toBeUndefined();
    });

    it('should set correct content-disposition header with project ID', async () => {
      const agent = await loginAs('admin');
      const { projectId } = await createFullTestData(agent);

      const res = await agent.get(`/api/v1/export/project/${projectId}`);

      expect(res.status).toBe(200);
      const disposition = res.headers['content-disposition'];
      expect(disposition).toContain('attachment');
      expect(disposition).toContain(`project-${projectId}`);
      // Filename now includes the spec version suffix (default 1.7).
      expect(disposition).toContain('cdx-1.7.json');
    });

    it('should require assessor or admin role', async () => {
      const adminAgent = await loginAs('admin');
      const { projectId } = await createFullTestData(adminAgent);

      const assessorAgent = await loginAs('assessor');
      const res = await assessorAgent.get(`/api/v1/export/project/${projectId}`);

      // Assessor should have export.cyclonedx permission
      expect(res.status).toBe(200);
    });

    it('should include unique merged data without duplicates', async () => {
      const agent = await loginAs('admin');

      // Create standard
      const standardRes = await agent
        .post('/api/v1/standards')
        .send({
          identifier: `DEDUP-STD-${Date.now()}`,
          name: 'Deduplication Test Standard',
          version: '1.0',
        });
      const standardId = standardRes.body.id;

      // Create single requirement
      const reqRes = await agent
        .post(`/api/v1/standards/${standardId}/requirements`)
        .send({
          identifier: 'DEDUP-REQ',
          name: 'Dedup Requirement',
          description: 'Test deduplication',
        });
      const requirementId = reqRes.body.id;

      // Create project
      const projectRes = await agent
        .post('/api/v1/projects')
        .send({
          name: `Dedup Project ${Date.now()}`,
          description: 'Test deduplication',
          standardIds: [standardId],
        });
      const projectId = projectRes.body.id;

      // Create assessment
      const assessmentRes = await agent
        .post('/api/v1/assessments')
        .send({
          title: `Dedup Assessment ${Date.now()}`,
          projectId,
        });

      const res = await agent.get(`/api/v1/export/project/${projectId}`);

      expect(res.status).toBe(200);
      // Standards should not have duplicates even if referenced by multiple assessments
      expect(res.body.definitions.standards.length).toBeGreaterThan(0);

      // Check no duplicate identifiers in standards
      const standardIds = res.body.definitions.standards.map((s: any) => s.identifier);
      const uniqueIds = new Set(standardIds);
      expect(uniqueIds.size).toBe(standardIds.length);
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle invalid UUID format in assessment export', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get('/api/v1/export/assessment/invalid-uuid');

      // Should return 400, 404, or 500 depending on validation
      expect([400, 404, 500]).toContain(res.status);
    });

    it('should handle invalid UUID format in project export', async () => {
      const agent = await loginAs('admin');

      const res = await agent.get('/api/v1/export/project/invalid-uuid');

      expect([400, 404, 500]).toContain(res.status);
    });

    it('should handle special characters in assessment title for PDF export', async () => {
      const agent = await loginAs('admin');

      const projectRes = await agent
        .post('/api/v1/projects')
        .send({
          name: 'Special Char Project',
          description: 'Test',
        });
      const projectId = projectRes.body.id;

      // Test with various special characters
      const testTitles = [
        'Assessment with "quotes"',
        "Assessment with 'apostrophes'",
        'Assessment with /slashes/\\backslashes',
        'Assessment with ?question=marks',
        'Assessment with *asterisks*',
      ];

      for (const title of testTitles) {
        const assessmentRes = await agent
          .post('/api/v1/assessments')
          .send({
            title,
            description: 'Special char test',
            projectId,
          });
        const assessmentId = assessmentRes.body.id;

        const res = await agent.get(`/api/v1/export/assessment/${assessmentId}/pdf`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        // Filename should be sanitized
        const disposition = res.headers['content-disposition'];
        expect(disposition).toBeDefined();
        expect(disposition).toContain('.pdf');
      }
    });

    it('should consistently generate BOM serial numbers (unique UUIDs)', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent);

      // Export the same assessment twice
      const res1 = await agent.get(`/api/v1/export/assessment/${assessmentId}`);
      const res2 = await agent.get(`/api/v1/export/assessment/${assessmentId}`);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Serial numbers should be different (unique UUIDs)
      expect(res1.body.serialNumber).not.toBe(res2.body.serialNumber);
      expect(res1.body.serialNumber).toMatch(/^urn:uuid:/);
      expect(res2.body.serialNumber).toMatch(/^urn:uuid:/);
    });

    it('should include timestamp in metadata', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent);

      const beforeExport = new Date();
      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}`);
      const afterExport = new Date();

      expect(res.status).toBe(200);
      expect(res.body.metadata.timestamp).toBeDefined();

      const exportTimestamp = new Date(res.body.metadata.timestamp);
      expect(exportTimestamp.getTime()).toBeGreaterThanOrEqual(beforeExport.getTime() - 1000);
      expect(exportTimestamp.getTime()).toBeLessThanOrEqual(afterExport.getTime() + 1000);
    });

    it('should handle concurrent export requests', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent);

      // Make multiple concurrent requests
      const requests = Array(3).fill(null).map(() =>
        agent.get(`/api/v1/export/assessment/${assessmentId}`)
      );

      const results = await Promise.all(requests);

      // All should succeed
      results.forEach(res => {
        expect(res.status).toBe(200);
        expect(res.body.bomFormat).toBe('CycloneDX');
      });

      // All should have unique serial numbers
      const serialNumbers = results.map(r => r.body.serialNumber);
      const uniqueSerials = new Set(serialNumbers);
      expect(uniqueSerials.size).toBe(3);
    });
  });

  describe('CycloneDX compliance', () => {
    it('should use bom-ref format for all referenced elements', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent, {
        assessorIds: [testUsers.assessor.id],
      });

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}`);

      expect(res.status).toBe(200);

      // Check assessor bom-refs (assessors omitted when empty, so
      // this test seeds one so the array is populated).
      expect(Array.isArray(res.body.declarations.assessors)).toBe(true);
      res.body.declarations.assessors.forEach((a: any) => {
        expect(a['bom-ref']).toMatch(/^assessor-/);
      });

      // Check standard and requirement bom-refs in definitions.
      // Upstream CycloneDX standards can bring their own bom-refs
      // (e.g. `ssdf-1.1-PO.1.1`), so the format check is "non-empty
      // string" rather than a prefix match. The writer synthesises
      // `standard-<uuid>` / `requirement-<uuid>` only when the
      // source feed did not carry a bom-ref.
      res.body.definitions.standards.forEach((s: any) => {
        expect(typeof s['bom-ref']).toBe('string');
        expect((s['bom-ref'] as string).length).toBeGreaterThan(0);
        (s.requirements ?? []).forEach((r: any) => {
          expect(typeof r['bom-ref']).toBe('string');
          expect((r['bom-ref'] as string).length).toBeGreaterThan(0);
        });
      });

      // Check claim and evidence bom-refs only if present (both are
      // omitted from declarations when the collection is empty).
      (res.body.declarations.claims ?? []).forEach((c: any) => {
        expect(c['bom-ref']).toMatch(/^claim-/);
      });
      (res.body.declarations.evidence ?? []).forEach((e: any) => {
        expect(e['bom-ref']).toMatch(/^evidence-/);
      });
    });

    it('should conform to CycloneDX 1.7 schema by default', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent);

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}`);

      expect(res.status).toBe(200);
      expect(res.body.specVersion).toBe('1.7');
      expect(res.body.$schema).toBe('http://cyclonedx.org/schema/bom-1.7.schema.json');

      // Verify required fields
      expect(res.body.bomFormat).toBeDefined();
      expect(res.body.serialNumber).toBeDefined();
      expect(res.body.version).toBeDefined();
      expect(res.body.metadata).toBeDefined();
      expect(res.body.declarations).toBeDefined();
    });

    it('should fall back to CycloneDX 1.6 when ?spec=1.6 is requested', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent);

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}?spec=1.6`);

      expect(res.status).toBe(200);
      expect(res.body.specVersion).toBe('1.6');
      expect(res.body.$schema).toBe('http://cyclonedx.org/schema/bom-1.6.schema.json');
      expect(res.headers['content-disposition']).toContain('cdx-1.6.json');
    });

    it('should ignore unknown spec values and fall back to the default 1.7', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent);

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}?spec=9.9`);

      expect(res.status).toBe(200);
      expect(res.body.specVersion).toBe('1.7');
      expect(res.body.$schema).toBe('http://cyclonedx.org/schema/bom-1.7.schema.json');
    });

    it('should handle optional fields correctly', async () => {
      const agent = await loginAs('admin');
      const { assessmentId } = await createFullTestData(agent);

      const res = await agent.get(`/api/v1/export/assessment/${assessmentId}`);

      expect(res.status).toBe(200);

      // Optional confidence scores should be omitted if null/undefined
      res.body.declarations.attestations.forEach((att: any) => {
        att.map.forEach((reqMap: any) => {
          if (reqMap.confidence.score === undefined) {
            expect(reqMap.confidence).not.toHaveProperty('score');
          }
        });
      });
    });
  });
});
