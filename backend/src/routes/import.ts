import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import { asyncHandler } from '../utils/route-helpers.js';
import { logger } from '../utils/logger.js';
import { AuthRequest, requireSession, requirePermission } from '../middleware/auth.js';

const router = Router();

// Zod schema for validating CycloneDX BOM import.
// We validate the top-level structure but use z.any() for deeply nested
// CycloneDX objects that we access dynamically in the import logic.
/** A string field from an untrusted document: non-strings become '', long ones are cut to the column size. */
function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** Upper bounds on document arrays; a 1 MB body can otherwise hold tens of thousands of entries. */
const MAX_IMPORT_ITEMS = 5_000;

const cyclonedxBomSchema = z.object({
  bomFormat: z.literal('CycloneDX', {
    message: 'Invalid CycloneDX document: bomFormat must be "CycloneDX"',
  }),
  specVersion: z.string().min(1, 'specVersion is required'),
  version: z.number().optional(),
  serialNumber: z.string().optional(),
  metadata: z.any().optional(),
  components: z.array(z.any()).max(MAX_IMPORT_ITEMS).optional(),
  services: z.array(z.any()).optional(),
  externalReferences: z.array(z.any()).optional(),
  definitions: z.object({
    standards: z.array(z.any()).max(MAX_IMPORT_ITEMS).optional(),
  }).passthrough().optional(),
  declarations: z.object({
    targets: z.any().optional(),
    evidence: z.array(z.any()).max(MAX_IMPORT_ITEMS).optional(),
    claims: z.array(z.any()).max(MAX_IMPORT_ITEMS).optional(),
    affirmation: z.any().optional(),
    attestations: z.array(z.any()).max(MAX_IMPORT_ITEMS).optional(),
  }).optional(),
  properties: z.array(z.any()).optional(),
}).passthrough();

/**
 * Import a CycloneDX attestation document.
 *
 * Accepts a CycloneDX JSON BOM containing declarations (attestations, claims,
 * evidence, etc.) and optionally definitions.standards. Standards are
 * deduplicated by identifier + version. All attestation data is imported and
 * linked to a new or existing project.
 */
router.post(
  '/attestation',
  requireSession,
  requirePermission('admin.import'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    // Validate CycloneDX BOM structure
    const validationResult = cyclonedxBomSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({
        error: 'Invalid CycloneDX document',
        details: validationResult.error.issues.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    const bom = validationResult.data;

    // Ensure declarations exist for this import
    if (!bom.declarations) {
      res.status(400).json({ error: 'CycloneDX document does not contain declarations' });
      return;
    }

    const importLog: string[] = [];

    // One transaction for the whole import: a bad nested value used to 500
    // mid-way and leave a partial project, standard and claims behind
    // (security review I4).
    const declarations = bom.declarations;
    const result = await getDatabase().transaction().execute(async (db) => {

    // Track bom-ref to internal ID mappings
    const standardBomRefMap = new Map<string, string>(); // bom-ref -> standard DB id
    const requirementBomRefMap = new Map<string, string>(); // bom-ref -> requirement DB id
    const evidenceBomRefMap = new Map<string, string>(); // bom-ref -> evidence DB id
    const claimBomRefMap = new Map<string, string>(); // bom-ref -> claim DB id
    const signatoryBomRefMap = new Map<string, string>(); // bom-ref -> signatory DB id
    const organizationBomRefMap = new Map<string, string>(); // bom-ref -> organization DB id

    // ---------------------------------------------------------------
    // 1. Import standards from definitions.standards (with dedup)
    // ---------------------------------------------------------------
    const standards = bom.definitions?.standards || [];
    for (const std of standards) {
      const identifier = std['bom-ref'] || std.name || '';
      const version = std.version || '';

      // Look for existing standard by identifier + version
      const existing = await db
        .selectFrom('standard')
        .where('identifier', '=', identifier)
        .selectAll()
        .executeTakeFirst();

      let standardId: string;
      if (existing && (!version || existing.version === version)) {
        // Deduplicate: use existing standard
        standardId = existing.id;
        importLog.push(`Standard "${std.name}" (${identifier}) already exists, reusing`);
      } else if (existing && version && existing.version !== version) {
        // Different version: create new
        const newIdentifier = `${identifier}-${version}`;
        standardId = uuidv4();
        await db.insertInto('standard').values({
          id: standardId,
          identifier: newIdentifier,
          name: std.name || identifier,
          description: std.description || null,
          owner: std.owner || null,
          version: version || null,
        }).execute();
        importLog.push(`Standard "${std.name}" version ${version} imported as new (different version from existing)`);
      } else {
        // Brand new standard
        standardId = uuidv4();
        await db.insertInto('standard').values({
          id: standardId,
          identifier: identifier,
          name: std.name || identifier,
          description: std.description || null,
          owner: std.owner || null,
          version: version || null,
        }).execute();
        importLog.push(`Standard "${std.name}" imported`);
      }

      if (std['bom-ref']) {
        standardBomRefMap.set(std['bom-ref'], standardId);
      }

      // An existing standard keeps its own requirements: map the document's
      // requirements to them by identifier. Inserting them again appended
      // arbitrary requirements to any standard (published ones included)
      // and duplicated them on every re-import (security review I4).
      if (existing && standardId === existing.id && Array.isArray(std.requirements)) {
        const existingReqs = await db.selectFrom('requirement')
          .select(['id', 'identifier'])
          .where('standard_id', '=', standardId)
          .execute();
        const byIdentifier = new Map(existingReqs.map((r) => [r.identifier, r.id]));
        let unmatched = 0;
        for (const req of std.requirements) {
          const reqBomRef = text(req['bom-ref'], 255);
          const match = byIdentifier.get(text(req.identifier, 255) || reqBomRef);
          if (match && reqBomRef) requirementBomRefMap.set(reqBomRef, match);
          else if (!match) unmatched++;
        }
        if (unmatched > 0) {
          importLog.push(`${unmatched} requirement(s) not found in existing standard "${identifier}" were not added`);
        }
      } else if (std.requirements && Array.isArray(std.requirements)) {
        // First pass: create all requirements (without parent links)
        const reqIdByBomRef = new Map<string, string>();
        for (const req of std.requirements) {
          const reqId = uuidv4();
          const reqBomRef = text(req['bom-ref'], 255);
          reqIdByBomRef.set(reqBomRef, reqId);
          const reqText = text(req.text, 100_000);

          await db.insertInto('requirement').values({
            id: reqId,
            identifier: text(req.identifier, 255) || reqBomRef,
            name: text(req.title, 255) || reqText.substring(0, 200) || text(req.identifier, 255) || 'Untitled',
            description: reqText || null,
            open_cre: Array.isArray(req.openCre) ? req.openCre.filter((v: unknown) => typeof v === 'string') : (typeof req.openCre === 'string' ? req.openCre : null),
            standard_id: standardId,
          }).execute();

          if (reqBomRef) {
            requirementBomRefMap.set(reqBomRef, reqId);
          }
        }

        // Second pass: set parent references
        for (const req of std.requirements) {
          if (req.parent) {
            const childId = reqIdByBomRef.get(req['bom-ref'] || '');
            const parentId = reqIdByBomRef.get(req.parent) || requirementBomRefMap.get(req.parent);
            if (childId && parentId) {
              await db.updateTable('requirement')
                .set({ parent_id: parentId })
                .where('id', '=', childId)
                .execute();
            }
          }
        }

        importLog.push(`  ${std.requirements.length} requirements imported for "${std.name}"`);
      }
    }

    // ---------------------------------------------------------------
    // 2. Import target organizations
    // ---------------------------------------------------------------
    const targets = declarations.targets || {};
    const targetOrgs = targets.organizations || [];
    for (const org of targetOrgs) {
      const orgId = uuidv4();
      await db.insertInto('organization').values({
        id: orgId,
        name: org.name || 'Unknown Organization',
        website: org.url?.[0] || null,
      }).execute();

      if (org['bom-ref']) {
        organizationBomRefMap.set(org['bom-ref'], orgId);
      }
      importLog.push(`Organization "${org.name}" imported`);
    }

    // ---------------------------------------------------------------
    // 3. Import evidence from declarations.evidence
    // ---------------------------------------------------------------
    const evidenceItems = declarations.evidence || [];
    for (const ev of evidenceItems) {
      const evidenceId = uuidv4();

      // Determine classification from evidence data
      let classification: string | null = null;
      if (ev.data && ev.data.length > 0) {
        classification = ev.data[0].classification || null;
      }

      await db.insertInto('evidence').values({
        id: evidenceId,
        bom_ref: ev['bom-ref'] || null,
        name: ev.description?.substring(0, 200) || ev.propertyName || 'Imported evidence',
        property_name: ev.propertyName || null,
        description: ev.description || null,
        state: 'in_progress',
        author_id: req.user!.id,
        classification: classification,
        expires_on: ev.expires ? new Date(ev.expires) : null,
        is_counter_evidence: false,
      }).execute();

      if (ev['bom-ref']) {
        evidenceBomRefMap.set(ev['bom-ref'], evidenceId);
      }
    }
    if (evidenceItems.length > 0) {
      importLog.push(`${evidenceItems.length} evidence items imported`);
    }

    // ---------------------------------------------------------------
    // 4. Create project to house the import
    // ---------------------------------------------------------------
    const projectId = uuidv4();
    const projectName = bom.metadata?.component?.name
      || (targetOrgs.length > 0 ? `${targetOrgs[0].name} Attestation` : 'Imported Attestation')
      + ` (${new Date().toISOString().split('T')[0]})`;

    await db.insertInto('project').values({
      id: projectId,
      name: projectName,
      description: `Imported from CycloneDX attestation ${bom.serialNumber || ''}`.trim(),
      state: 'operational',
      workflow_type: 'evidence_driven',
    }).execute();

    // Link standards to project
    for (const [, stdId] of standardBomRefMap) {
      await db.insertInto('project_standard').values({
        project_id: projectId,
        standard_id: stdId,
        created_at: new Date(),
      }).execute();
    }

    importLog.push(`Project "${projectName}" created`);

    // ---------------------------------------------------------------
    // 5. Create assessment for the attestation
    // ---------------------------------------------------------------
    const assessmentId = uuidv4();
    await db.insertInto('assessment').values({
      id: assessmentId,
      title: declarations.attestations?.[0]?.summary || 'Imported Assessment',
      description: `Assessment imported from CycloneDX attestation document`,
      project_id: projectId,
      state: 'complete',
    }).execute();

    importLog.push(`Assessment created`);

    // ---------------------------------------------------------------
    // 6. Import claims from declarations.claims
    // ---------------------------------------------------------------
    const claims = declarations.claims || [];
    for (const claim of claims) {
      const claimId = uuidv4();
      const targetRef = claim.target || '';
      const targetName = organizationBomRefMap.has(targetRef) ? targetRef : targetRef;

      await db.insertInto('claim').values({
        id: claimId,
        bom_ref: claim['bom-ref'] || null,
        name: claim.predicate?.substring(0, 200) || 'Imported claim',
        target: targetName,
        predicate: claim.predicate || '',
        reasoning: claim.reasoning || null,
        is_counter_claim: false,
      }).execute();

      if (claim['bom-ref']) {
        claimBomRefMap.set(claim['bom-ref'], claimId);
      }

      // Link claim to evidence
      if (claim.evidence && Array.isArray(claim.evidence)) {
        for (const evRef of claim.evidence) {
          const evId = evidenceBomRefMap.get(evRef);
          if (evId) {
            await db.insertInto('claim_evidence').values({
              claim_id: claimId,
              evidence_id: evId,
              created_at: new Date(),
            }).execute();
          }
        }
      }

      // Link claim to counter evidence
      if (claim.counterEvidence && Array.isArray(claim.counterEvidence)) {
        for (const evRef of claim.counterEvidence) {
          const evId = evidenceBomRefMap.get(evRef);
          if (evId) {
            await db.insertInto('claim_counter_evidence').values({
              claim_id: claimId,
              evidence_id: evId,
              created_at: new Date(),
            }).execute();
          }
        }
      }

      // Link claim to mitigation strategies
      if (claim.mitigationStrategies && Array.isArray(claim.mitigationStrategies)) {
        for (const msRef of claim.mitigationStrategies) {
          const evId = evidenceBomRefMap.get(msRef);
          if (evId) {
            await db.insertInto('claim_mitigation_strategy').values({
              claim_id: claimId,
              evidence_id: evId,
              created_at: new Date(),
            }).execute();
          }
        }
      }
    }
    if (claims.length > 0) {
      importLog.push(`${claims.length} claims imported`);
    }

    // ---------------------------------------------------------------
    // 7. Import signatories from declarations.affirmation
    // ---------------------------------------------------------------
    const affirmation = declarations.affirmation;
    if (affirmation) {
      const signatories = affirmation.signatories || [];
      for (const sig of signatories) {
        const sigId = uuidv4();

        let orgId: string | null = null;
        if (sig.organization) {
          const sigOrgId = uuidv4();
          await db.insertInto('organization').values({
            id: sigOrgId,
            name: sig.organization.name || 'Unknown',
          }).execute();
          orgId = sigOrgId;
        }

        await db.insertInto('signatory').values({
          id: sigId,
          name: sig.name || 'Unknown',
          role: sig.role || null,
          organization_id: orgId,
        }).execute();

        if (sig['bom-ref']) {
          signatoryBomRefMap.set(sig['bom-ref'], sigId);
        }
      }
      if (signatories.length > 0) {
        importLog.push(`${signatories.length} signatories imported`);
      }

      // Create affirmation record
      if (affirmation.statement) {
        const affirmationId = uuidv4();
        await db.insertInto('affirmation').values({
          id: affirmationId,
          statement: affirmation.statement,
          project_id: projectId,
          created_at: new Date(),
          updated_at: new Date(),
        }).execute();

        // Link signatories to the affirmation as already filled slots.
        // Imported affirmations arrive sealed from another tool, so the
        // slot concept does not really apply - we synthesize a title
        // from the signatory role (or fall back to the name) so the
        // NOT NULL constraint is satisfied and the rows model the
        // captured signatories rather than empty slots.
        // Count per title instead of probing "Title (n)" in a loop, which was
        // quadratic in duplicate roles (security review I4).
        const titleCounts = new Map<string, number>();
        for (const sig of signatories) {
          const sigRef = sig['bom-ref'] || sig.name;
          const sigId = sigRef ? signatoryBomRefMap.get(sigRef) : undefined;
          if (!sigId) continue;
          const title = (text(sig.role, 200) || text(sig.name, 200) || 'Signatory').trim();
          const seen = (titleCounts.get(title) ?? 0) + 1;
          titleCounts.set(title, seen);
          const uniqueTitle = seen === 1 ? title : `${title} (${seen})`;
          await db.insertInto('affirmation_signatory').values({
            affirmation_id: affirmationId,
            required_title: uniqueTitle,
            signatory_id: sigId,
            created_at: new Date(),
            updated_at: new Date(),
          }).execute();
        }
        importLog.push(`Affirmation imported with ${signatories.length} signatories`);
      }
    }

    // ---------------------------------------------------------------
    // 8. Import attestations and their requirement mappings
    // ---------------------------------------------------------------
    const attestations = declarations.attestations || [];
    for (const att of attestations) {
      const attestationId = uuidv4();

      await db.insertInto('attestation').values({
        id: attestationId,
        summary: att.summary || null,
        assessment_id: assessmentId,
      }).execute();

      // Process attestation map (requirement -> claims/conformance/confidence)
      const attMap = att.map || [];
      for (const mapping of attMap) {
        const reqRef = mapping.requirement;
        const reqId = requirementBomRefMap.get(reqRef);

        if (reqId && mapping.conformance) {
          const attReqId = uuidv4();
          await db.insertInto('attestation_requirement').values({
            id: attReqId,
            attestation_id: attestationId,
            requirement_id: reqId,
            conformance_score: mapping.conformance.score ?? 0,
            conformance_rationale: mapping.conformance.rationale || '',
            confidence_score: mapping.confidence?.score ?? null,
            confidence_rationale: mapping.confidence?.rationale || null,
          }).execute();

          // Link mitigation strategies
          if (mapping.conformance.mitigationStrategies) {
            for (const msRef of mapping.conformance.mitigationStrategies) {
              const evId = evidenceBomRefMap.get(msRef);
              if (evId) {
                await db.insertInto('attestation_requirement_mitigation').values({
                  attestation_requirement_id: attReqId,
                  evidence_id: evId,
                  created_at: new Date(),
                }).execute();
              }
            }
          }
        }

        // Link claims to attestation via the claim table's attestation_id
        if (mapping.claims && Array.isArray(mapping.claims)) {
          for (const claimRef of mapping.claims) {
            const claimId = claimBomRefMap.get(claimRef);
            if (claimId) {
              await db.updateTable('claim')
                .set({ attestation_id: attestationId })
                .where('id', '=', claimId)
                .execute();
            }
          }
        }
      }
    }
    if (attestations.length > 0) {
      importLog.push(`${attestations.length} attestations imported with requirement mappings`);
    }

    logger.info('Attestation import completed', {
      projectId,
      assessmentId,
      standards: standards.length,
      claims: claims.length,
      evidence: evidenceItems.length,
      attestations: attestations.length,
      requestId: req.requestId,
    });

    return { projectId, assessmentId };
    });

    res.status(201).json({
      message: 'Attestation imported successfully',
      projectId: result.projectId,
      assessmentId: result.assessmentId,
      importLog,
    });
  })
);

export default router;
