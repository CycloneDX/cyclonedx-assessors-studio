/**
 * Standard + requirement serializer.
 *
 * Converts internal standard and requirement DB rows into the
 * CycloneDX `standard` shape emitted under `definitions.standards`.
 *
 * The mapping from the DB columns to the CycloneDX schema is not
 * one-to-one: the DB column `requirement.name` maps to the schema's
 * `title` and `requirement.description` maps to `text`. Prior
 * hand-rolled exports emitted the DB column names verbatim which
 * caused validation failures because the CycloneDX requirement schema
 * does not define `name` or `description`. Every caller MUST route
 * through this module so the translation happens in exactly one place.
 */

import { refFor } from '../bomref.js';
import type { Standard, StandardRequirement } from '../types.js';

export interface StandardRowInput {
  id: string;
  identifier?: string | null;
  name?: string | null;
  version?: string | null;
  description?: string | null;
  owner?: string | null;
  /**
   * Original CycloneDX bom-ref captured at standards import time.
   * When present, the writer emits this verbatim so an export can
   * round trip the same identifier the source feed used.
   */
  imported_bom_ref?: string | null;
}

export interface RequirementRowInput {
  id: string;
  identifier?: string | null;
  /**
   * The DB column is `name`; in CycloneDX this becomes `title`.
   */
  name?: string | null;
  /**
   * The DB column is `description`; in CycloneDX this becomes `text`.
   */
  description?: string | null;
  parent_id?: string | null;
  open_cre?: string | null;
  /**
   * Original CycloneDX bom-ref from the upstream standard feed.
   * Falls back to `requirement-<uuid>` when null. Used for both the
   * requirement object's bom-ref and the parent pointer (resolved by
   * the caller via the lookup map below).
   */
  imported_bom_ref?: string | null;
}

export interface StandardInputs {
  row: StandardRowInput;
  requirements: RequirementRowInput[];
}

/**
 * Resolve the bom-ref for a requirement: prefer the imported value
 * captured at standards import, fall back to the deterministic UUID
 * synthesis when the column is null. Exposed so other writers
 * (e.g. attestation map serializer) can reference the same value
 * the standard block emits.
 */
function requirementBomRef(row: Pick<RequirementRowInput, 'id' | 'imported_bom_ref'>): string {
  if (row.imported_bom_ref && row.imported_bom_ref.length > 0) {
    return row.imported_bom_ref;
  }
  return refFor('requirement', row.id);
}

/**
 * Resolve the bom-ref for a standard. Same lossless-when-possible
 * preference as requirements.
 */
function standardBomRef(row: Pick<StandardRowInput, 'id' | 'imported_bom_ref'>): string {
  if (row.imported_bom_ref && row.imported_bom_ref.length > 0) {
    return row.imported_bom_ref;
  }
  return refFor('standard', row.id);
}

function requirementFromRow(
  row: RequirementRowInput,
  parentRefByDbId: Map<string, string>,
): StandardRequirement {
  const req: StandardRequirement = {
    'bom-ref': requirementBomRef(row),
  };
  if (row.identifier) req.identifier = row.identifier;
  if (row.name) req.title = row.name;
  if (row.description) req.text = row.description;
  if (row.parent_id) {
    // The parent reference must use whatever bom-ref the parent
    // requirement itself emits. Look it up from the precomputed map
    // so a parent that survived import with its own bom-ref points
    // at that bom-ref, not the synthesised fallback.
    const parentRef = parentRefByDbId.get(row.parent_id);
    if (parentRef) {
      req.parent = parentRef;
    } else {
      req.parent = refFor('requirement', row.parent_id);
    }
  }
  if (row.open_cre && row.open_cre.trim().length > 0) {
    req.openCre = row.open_cre
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return req;
}

export function standardFromRow(inputs: StandardInputs): Standard {
  const std: Standard = {
    'bom-ref': standardBomRef(inputs.row),
  };
  // The DB `identifier` (e.g. "SSDF") is a short code and the DB
  // `name` is the expanded form ("Secure Software Development
  // Framework"). The CycloneDX schema only defines `name`, so the
  // full name is used here. The identifier flows through only as the
  // basis for the bom-ref which is already covered above.
  if (inputs.row.name) std.name = inputs.row.name;
  if (inputs.row.version) std.version = inputs.row.version;
  if (inputs.row.description) std.description = inputs.row.description;
  if (inputs.row.owner) std.owner = inputs.row.owner;

  if (inputs.requirements.length > 0) {
    // Build a parent-lookup table once so each requirement can
    // resolve its parent reference to the same bom-ref the parent
    // requirement itself will emit. Without this, an imported feed
    // with bom-refs like "ssdf-1.1-PO.1" would emit
    // `parent: "requirement-<uuid>"` while the parent itself emits
    // `bom-ref: "ssdf-1.1-PO.1"`, breaking the parent link.
    const parentRefByDbId = new Map<string, string>();
    for (const r of inputs.requirements) {
      parentRefByDbId.set(r.id, requirementBomRef(r));
    }
    std.requirements = inputs.requirements.map((r) =>
      requirementFromRow(r, parentRefByDbId),
    );
  }
  return std;
}
