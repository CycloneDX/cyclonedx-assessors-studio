import { Router } from 'express';
import type { Response } from 'express';
import { getConfig } from '../config/index.js';
import { getDatabase } from '../db/connection.js';
import { type AuthRequest, requireAuth, requirePermission } from '../middleware/auth.js';
import {
  getStorageProviderName,
  resolveProvider,
  type S3StorageProvider,
} from '../storage/index.js';
import { getChannelRegistry } from '../events/index.js';
import type { EmailChannel } from '../events/channels/email.js';
import { asyncHandler } from '../utils/route-helpers.js';

const router = Router();

/**
 * POST /api/v1/admin/integrations/test/storage
 *
 * Verifies the storage backend is reachable.
 *
 * For database: reads from the evidence_attachment table that holds the bytes.
 * For S3: writes and reads a small test object in the configured bucket.
 */
router.post(
  '/integrations/test/storage',
  requireAuth,
  requirePermission('admin.settings'),
  asyncHandler(async (_req: AuthRequest, res: Response): Promise<void> => {
    const providerName = getStorageProviderName();

    if (providerName === 's3') {
      const provider = resolveProvider('s3') as S3StorageProvider;
      const result = await provider.testConnection();

      if (result.ok) {
        res.json({ success: true, provider: 's3', message: 'S3 connectivity verified' });
      } else {
        res.status(502).json({
          success: false,
          provider: 's3',
          message: `S3 connection failed: ${result.error}`,
        });
      }
    } else {
      // Database provider: attachment bytes live in evidence_attachment,
      // so read from that table to prove it is reachable.
      const db = getDatabase();

      try {
        await db.selectFrom('evidence_attachment').select('id').limit(1).execute();

        res.json({
          success: true,
          provider: 'database',
          message: 'Database storage verified',
        });
      } catch (error: unknown) {
        const err = error as Record<string, unknown> | null;
        const errorMessage = typeof err?.message === 'string' ? err.message : 'Unknown error';
        res.status(502).json({
          success: false,
          provider: 'database',
          message: `Database test failed: ${errorMessage}`,
        });
      }
    }
  })
);

// ---------------------------------------------------------------------------
// SMTP / Email integrations
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/admin/integrations/test/smtp
 *
 * Sends a test email to the currently logged in admin's email address
 * to verify that the SMTP relay is working.
 */
router.post(
  '/integrations/test/smtp',
  requireAuth,
  requirePermission('admin.settings'),
  asyncHandler(async (req: AuthRequest, res: Response): Promise<void> => {
    const config = getConfig();
    if (!config.SMTP_ENABLED) {
      res.status(400).json({ success: false, message: 'SMTP is not enabled' });
      return;
    }

    // Get the admin user's email address
    const db = getDatabase();
    const user = await db
      .selectFrom('app_user')
      .where('id', '=', req.user?.id ?? '')
      .select(['email'])
      .executeTakeFirst();

    if (!user?.email) {
      res.status(400).json({ success: false, message: 'Your account does not have an email address configured' });
      return;
    }

    // Find the email channel from the registry
    let emailChannel: EmailChannel | undefined;
    try {
      const registry = getChannelRegistry();
      emailChannel = registry.getChannel('email') as EmailChannel | undefined;
    } catch {
      // Event system may not be initialized in test environments
    }

    if (!emailChannel || !emailChannel.isEnabled) {
      res.status(400).json({
        success: false,
        message: 'Email channel is not active. Check SMTP configuration.',
      });
      return;
    }

    await emailChannel.sendTestEmail(user.email);

    res.json({
      success: true,
      message: `Test email sent to ${user.email}`,
    });
  })
);

/**
 * GET /api/v1/admin/integrations/status
 *
 * Returns the status of all integration channels in one call.
 */
router.get(
  '/integrations/status',
  requireAuth,
  requirePermission('admin.settings'),
  asyncHandler(async (_req: AuthRequest, res: Response): Promise<void> => {
    const config = getConfig();
    const providerName = getStorageProviderName();

    // biome-ignore lint/suspicious/noExplicitAny: Storage config structure varies by provider
    const storageConfig: Record<string, unknown> = { provider: providerName };
    if (providerName === 's3') {
      storageConfig.s3 = {
        bucket: config.S3_BUCKET,
        region: config.S3_REGION,
        endpoint: config.S3_ENDPOINT || null,
        accessKeyConfigured: !!config.S3_ACCESS_KEY_ID,
        forcePathStyle: config.S3_FORCE_PATH_STYLE,
      };
    }
    storageConfig.maxFileSize = config.UPLOAD_MAX_FILE_SIZE;

    // Count chat integrations per platform
    const db = getDatabase();
    const chatCounts: Record<string, number> = { slack: 0, teams: 0, mattermost: 0 };
    try {
      const rows = await db
        .selectFrom('chat_integration')
        .select(['platform', db.fn.count<number>('id').as('count')])
        .groupBy('platform')
        .execute();
      for (const row of rows) {
        chatCounts[row.platform] = Number(row.count);
      }
    } catch {
      // Table may not exist yet on first run before migration
    }

    res.json({
      storage: storageConfig,
      smtp: {
        enabled: config.SMTP_ENABLED,
        host: config.SMTP_HOST || null,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        from: config.SMTP_FROM || null,
        userConfigured: !!config.SMTP_USER,
        passConfigured: !!config.SMTP_PASS,
        tlsRejectUnauthorized: config.SMTP_TLS_REJECT_UNAUTHORIZED,
      },
      webhook: {
        enabled: config.WEBHOOK_ENABLED,
      },
      slack: {
        enabled: config.SLACK_ENABLED,
        integrationCount: chatCounts.slack,
      },
      teams: {
        enabled: config.TEAMS_ENABLED,
        integrationCount: chatCounts.teams,
      },
      mattermost: {
        enabled: config.MATTERMOST_ENABLED,
        integrationCount: chatCounts.mattermost,
      },
      metrics: {
        enabled: config.METRICS_ENABLED,
        prefix: config.METRICS_PREFIX,
        domainRefreshInterval: config.METRICS_DOMAIN_REFRESH_INTERVAL,
        tokenConfigured: !!config.METRICS_TOKEN,
      },
    });
  })
);

export default router;
