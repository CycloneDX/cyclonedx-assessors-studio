/**
 * Every column that holds an encryption-service envelope. Key rotation
 * (admin rotate and the master-key rekey script) must re-wrap all of
 * them; a column missing here becomes undecryptable after a rotation,
 * which breaks signing and sealing (security review X7). Add new
 * encrypted columns here.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

export const ENCRYPTED_COLUMNS = [
  { table: 'webhook', column: 'secret' },
  { table: 'chat_integration', column: 'webhook_url' },
  { table: 'platform_signing_key', column: 'private_key_encrypted' },
  { table: 'user_signature', column: 'payload_encrypted' },
] as const;

type Rekey = (
  read: () => AsyncIterable<{ id: string; value: string }>,
  write: (id: string, value: string) => Promise<void>,
) => Promise<{ processed: number; rekeyed: number }>;

/** Runs `rekey` over every encrypted column and sums the counts. */
export async function rekeyAllColumns(
  db: Kysely<Database>,
  rekey: Rekey,
): Promise<{ processed: number; rekeyed: number; byTable: Record<string, { processed: number; rekeyed: number }> }> {
  // biome-ignore lint/suspicious/noExplicitAny: table and column names come from the constant list above
  const anyDb = db as unknown as Kysely<any>;
  let processed = 0;
  let rekeyed = 0;
  const byTable: Record<string, { processed: number; rekeyed: number }> = {};
  for (const { table, column } of ENCRYPTED_COLUMNS) {
    const result = await rekey(
      async function* () {
        const rows = await anyDb.selectFrom(table).select(['id', column]).execute();
        for (const row of rows) {
          const value = row[column];
          if (typeof value === 'string' && value.length > 0) yield { id: row.id as string, value };
        }
      },
      async (id, value) => {
        await anyDb.updateTable(table).set({ [column]: value }).where('id', '=', id).execute();
      },
    );
    byTable[table] = result;
    processed += result.processed;
    rekeyed += result.rekeyed;
  }
  return { processed, rekeyed, byTable };
}
