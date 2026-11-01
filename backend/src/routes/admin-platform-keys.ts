/**
 * Admin routes for platform signing key management.
 *
 * Platform keys sign the declarations envelope and the top level
 * document envelope during the affirmation seal ceremony. Rotation
 * generates a fresh keypair, flips the old one to inactive, and
 * leaves the historical row intact so prior seals can still be
 * verified by fingerprint.
 */

import { auditMutations } from '../utils/audit.js';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission, type AuthRequest, requireSession } from '../middleware/auth.js';
import { asyncHandler } from '../utils/route-helpers.js';
import { listKeys, rotateKey, getActiveKey } from '../services/platform-keys.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(auditMutations('platform_signing_key'));

const rotateSchema = z.object({
  algorithm: z
    .enum(['Ed25519', 'Ed448', 'ES256', 'ES384', 'ES512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512'])
    .optional(),
});

/**
 * GET /admin/platform-keys
 * List all platform keys, active first. Does not return private
 * material.
 */
router.get(
  '/',
  requireAuth,
  requirePermission('platform_keys.rotate'),
  asyncHandler(async (_req: AuthRequest, res: Response): Promise<void> => {
    const keys = await listKeys();
    res.json({ data: keys.map(({ ...k }) => k) });
  }),
);

/**
 * GET /admin/platform-keys/active
 * Convenience endpoint that also bootstraps the first key if none
 * exists yet.
 */
router.get(
  '/active',
  requireAuth,
  requirePermission('platform_keys.rotate'),
  asyncHandler(async (_req: AuthRequest, res: Response): Promise<void> => {
    const active = await getActiveKey();
    // Drop private key from the response intentionally.
    const { privateKeyPem: _private, ...publicShape } = active;
    res.json({ data: publicShape });
  }),
);

/**
 * POST /admin/platform-keys/rotate
 * Generate a new keypair and atomically mark it active. Returns the
 * public half of the new key. Old keys remain in the table and stay
 * available to verify historic signatures.
 */
router.post(
  '/rotate',
  requireSession,
  requirePermission('platform_keys.rotate'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }
    const parsed = rotateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }
    const material = await rotateKey({ algorithm: parsed.data.algorithm, rotatedBy: userId });
    logger.info('Platform signing key rotated', {
      fingerprint: material.fingerprint,
      algorithm: material.algorithm,
      rotatedBy: userId,
    });
    const { privateKeyPem: _private, ...publicShape } = material;
    res.status(201).json({ data: publicShape });
  }),
);

export default router;
