/**
 * Admin encryption management routes.
 *
 * Provides endpoints for viewing encryption status and rotating
 * encryption key versions.
 */

import { rekeyAllColumns } from '../utils/encrypted-columns.js';
import { auditMutations } from '../utils/audit.js';
import { Router } from 'express';
import type { Response } from 'express';
import { getDatabase } from '../db/connection.js';
import { logger } from '../utils/logger.js';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth, requirePermission, requireSession } from '../middleware/auth.js';
import {
  encryptionService,
  rotateKeyVersion,
  isEncryptedEnvelope,
} from '../utils/encryption.js';
import { asyncHandler } from '../utils/route-helpers.js';

const router = Router();
router.use(auditMutations('encryption_key'));

/**
 * GET /api/v1/admin/encryption/status
 *
 * Returns the current encryption status including key version info
 * and counts of encrypted vs. plaintext fields.
 */
router.get(
  '/status',
  requireAuth,
  requirePermission('admin.encryption'),
  asyncHandler(async (_req: AuthRequest, res: Response): Promise<void> => {
    const db = getDatabase();
    const available = encryptionService.isAvailable();
    const activeVersion = encryptionService.getActiveKeyVersion();

    // Get all key versions
    let keyVersions: Record<string, unknown>[] = [];
    try {
      keyVersions = await db
        .selectFrom('encryption_key_version')
        .selectAll()
        .orderBy('version', 'desc')
        .execute();
    } catch {
      // Table may not exist yet
    }

    // Count encrypted vs. plaintext webhook secrets
    let webhookTotal = 0;
    let webhookEncrypted = 0;
    try {
      const webhooks = await db
        .selectFrom('webhook')
        .select(['secret'])
        .execute();

      webhookTotal = webhooks.length;
      webhookEncrypted = webhooks.filter((w) => isEncryptedEnvelope(w.secret)).length;
    } catch {
      // Table may not exist
    }

    res.json({
      available,
      passthroughMode: !available,
      activeKeyVersion: activeVersion,
      keyVersions: keyVersions.map((kv) => ({
        version: kv.version,
        isActive: kv.is_active,
        createdAt: kv.created_at,
        retiredAt: kv.retired_at,
      })),
      encryptedFields: {
        webhook: {
          total: webhookTotal,
          encrypted: webhookEncrypted,
          plaintext: webhookTotal - webhookEncrypted,
        },
      },
    });
  })
);

/**
 * POST /api/v1/admin/encryption/rotate
 *
 * Rotate to a new key version. Creates a new KEK derivation salt and
 * re-wraps all existing encrypted values under the new key version.
 */
router.post(
  '/rotate',
  requireSession,
  requirePermission('admin.encryption'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    if (!encryptionService.isAvailable()) {
      res.status(400).json({
        error: 'Encryption is not available. Set MASTER_ENCRYPTION_KEY to enable.',
      });
      return;
    }

    const db = getDatabase();
    const oldVersion = encryptionService.getActiveKeyVersion();

    // Create new key version
    const newVersion = await rotateKeyVersion(db);

    // Re-wrap every encrypted-at-rest column under the new key version.
    const { processed, rekeyed, byTable } = await rekeyAllColumns(db, (read, write) => encryptionService.rekey(read, write));

    logger.info('Encryption key rotated', {
      oldVersion,
      newVersion,
      processed,
      rekeyed,
      breakdown: {
        webhooks: byTable.webhook,
        chatIntegrations: byTable.chat_integration,
        platformSigningKeys: byTable.platform_signing_key,
        userSignatures: byTable.user_signature,
      },
      userId: req.user!.id,
    });

    res.json({
      message: 'Encryption key rotated successfully',
      previousVersion: oldVersion,
      newVersion,
      processed,
      rekeyed,
      breakdown: {
        webhooks: byTable.webhook,
        chatIntegrations: byTable.chat_integration,
        platformSigningKeys: byTable.platform_signing_key,
        userSignatures: byTable.user_signature,
      },
    });
  })
);

export default router;
