import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { setupTestDb, teardownTestDb, getTestDatabase, createTestUser } from '../helpers/setup.js';

// The soft-delete guarantee: a soft-deleted row must NOT surface through the
// public table name (a filtered view) anywhere, but MUST remain in the physical
// *_raw table so it can be restored. This test proves that guarantee end-to-end
// for every deletable resource, plus that it holds across a table join (a
// soft-deleted evidence row must drop out of a claim's linked-evidence join).

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('soft-delete leak test', () => {
  beforeAll(async () => {
    await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });

  it('hides soft-deleted assessments from the view but keeps them in *_raw, and restores', async () => {
    const db = getTestDatabase();
    const id = uuidv4();
    await db.insertInto('assessment').values({ id, title: 'Leak A' } as any).execute();

    // Visible before delete
    expect(await db.selectFrom('assessment').select('id').where('id', '=', id).executeTakeFirst()).toBeTruthy();

    // Soft delete through the view
    await db.updateTable('assessment').set({ deleted_at: new Date() } as any).where('id', '=', id).execute();

    // Gone from the view, present in raw
    expect(await db.selectFrom('assessment').select('id').where('id', '=', id).executeTakeFirst()).toBeUndefined();
    expect(await db.selectFrom('assessment_raw').select('id').where('id', '=', id).executeTakeFirst()).toBeTruthy();

    // Restore via raw
    await db.updateTable('assessment_raw').set({ deleted_at: null } as any).where('id', '=', id).execute();
    expect(await db.selectFrom('assessment').select('id').where('id', '=', id).executeTakeFirst()).toBeTruthy();
  });

  it('hides soft-deleted claims and mitigations from their views', async () => {
    const db = getTestDatabase();

    const claimId = uuidv4();
    await db.insertInto('claim').values({ id: claimId, name: 'Leak C', target: 't', predicate: 'p' } as any).execute();
    await db.updateTable('claim').set({ deleted_at: new Date() } as any).where('id', '=', claimId).execute();
    expect(await db.selectFrom('claim').select('id').where('id', '=', claimId).executeTakeFirst()).toBeUndefined();
    expect(await db.selectFrom('claim_raw').select('id').where('id', '=', claimId).executeTakeFirst()).toBeTruthy();

    const mitId = uuidv4();
    await db.insertInto('mitigation').values({ id: mitId, title: 'Leak M', type: 'Technical', priority: 'Low' } as any).execute();
    await db.updateTable('mitigation').set({ deleted_at: new Date() } as any).where('id', '=', mitId).execute();
    expect(await db.selectFrom('mitigation').select('id').where('id', '=', mitId).executeTakeFirst()).toBeUndefined();
    expect(await db.selectFrom('mitigation_raw').select('id').where('id', '=', mitId).executeTakeFirst()).toBeTruthy();
  });

  it('drops soft-deleted evidence out of a claim -> evidence join', async () => {
    const db = getTestDatabase();
    const author = await createTestUser();

    const claimId = uuidv4();
    await db.insertInto('claim').values({ id: claimId, name: 'Join claim', target: 't', predicate: 'p' } as any).execute();

    const evId = uuidv4();
    await db.insertInto('evidence').values({ id: evId, name: 'Join evidence', author_id: author.id } as any).execute();

    await db.insertInto('claim_evidence').values({ claim_id: claimId, evidence_id: evId } as any).execute();

    // The join sees the evidence before deletion
    const before = await db
      .selectFrom('claim_evidence')
      .innerJoin('evidence', 'evidence.id', 'claim_evidence.evidence_id')
      .select('evidence.id')
      .where('claim_evidence.claim_id', '=', claimId)
      .execute();
    expect(before.map((r) => r.id)).toContain(evId);

    // Soft-delete the evidence; the join must now exclude it (the view hides it)
    await db.updateTable('evidence').set({ deleted_at: new Date() } as any).where('id', '=', evId).execute();
    const after = await db
      .selectFrom('claim_evidence')
      .innerJoin('evidence', 'evidence.id', 'claim_evidence.evidence_id')
      .select('evidence.id')
      .where('claim_evidence.claim_id', '=', claimId)
      .execute();
    expect(after.map((r) => r.id)).not.toContain(evId);
  });
});
