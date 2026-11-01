/**
 * Email notification channel.
 *
 * Sends emails via SMTP for events that have mapped templates.
 * Includes rate limiting (10 emails/sec), a 500 message queue cap,
 * and graceful drain on shutdown.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { logger } from '../../utils/logger.js';
import type { NotificationChannel } from '../channel.js';
import type { EventEnvelope } from '../types.js';
import {
  ASSESSMENT_CREATED,
  ASSESSMENT_STATE_CHANGED,
  ASSESSMENT_ASSIGNED,
  EVIDENCE_CREATED,
  EVIDENCE_STATE_CHANGED,
  ATTESTATION_CREATED,
  CHANNEL_WEBHOOK_DISABLED,
} from '../catalog.js';
import { resolveRecipients } from '../recipients.js';
import {
  assessmentCreatedTemplate,
  assessmentReadyForReviewTemplate,
  assessmentCompletedTemplate,
  assessmentAssignedTemplate,
  evidenceCreatedTemplate,
  evidenceReadyForReviewTemplate,
  evidenceApprovedTemplate,
  evidenceRejectedTemplate,
  attestationCreatedTemplate,
  webhookDisabledTemplate,
  type EmailTemplate,
} from './email-templates.js';

// Rate limiting constants
const SEND_RATE_PER_SECOND = 10;
const SEND_INTERVAL_MS = 1000 / SEND_RATE_PER_SECOND;
const MAX_QUEUE_SIZE = 500;

interface QueuedMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

interface SmtpConfig {
  SMTP_ENABLED: boolean;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_FROM: string;
  SMTP_TLS_REJECT_UNAUTHORIZED: boolean;
  APP_URL: string;
}

/** Event types that have email templates. */
const HANDLED_EVENT_TYPES = [
  ASSESSMENT_CREATED,
  ASSESSMENT_STATE_CHANGED,
  ASSESSMENT_ASSIGNED,
  EVIDENCE_CREATED,
  EVIDENCE_STATE_CHANGED,
  ATTESTATION_CREATED,
  CHANNEL_WEBHOOK_DISABLED,
];

export class EmailChannel implements NotificationChannel {
  name = 'email';

  private transporter: Transporter | null = null;
  private config: SmtpConfig | null = null;
  private getDb: () => Kysely<Database>;
  private messageQueue: QueuedMessage[] = [];
  private isSending = false;
  private sendTimer: ReturnType<typeof setInterval> | null = null;

  constructor(getDb: () => Kysely<Database>) {
    this.getDb = getDb;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async initialize(): Promise<void> {
    const { getConfig } = await import('../../config/index.js');
    this.config = getConfig() as unknown as SmtpConfig;

    if (!this.config.SMTP_ENABLED) {
      logger.debug('Email channel disabled');
      return;
    }

    // Validate required fields
    const required: (keyof SmtpConfig)[] = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM'];
    const missing = required.filter((key) => !this.config?.[key]);
    if (missing.length > 0) {
      throw new Error(
        `SMTP_ENABLED is true but required configuration is missing: ${missing.join(', ')}`,
      );
    }

    if (!this.config.APP_URL) {
      logger.warn('APP_URL is not configured; email links may be incomplete');
    }

    // Create transporter with connection pooling
    this.transporter = nodemailer.createTransport({
      host: this.config.SMTP_HOST,
      port: this.config.SMTP_PORT,
      secure: this.config.SMTP_SECURE,
      auth: this.config.SMTP_USER
        ? { user: this.config.SMTP_USER, pass: this.config.SMTP_PASS }
        : undefined,
      tls: {
        rejectUnauthorized: this.config.SMTP_TLS_REJECT_UNAUTHORIZED,
      },
      pool: true,
    });

    // Verify SMTP connection (non-blocking: warn on failure, don't crash)
    try {
      await this.transporter.verify();
      logger.info('Email channel initialized and SMTP connection verified');
    } catch (error) {
      logger.warn('Email channel initialized but SMTP verification failed', { error });
    }

    this.startSendProcessor();
  }

  handles(envelope: EventEnvelope): boolean {
    if (!this.transporter) return false;
    return this.hasTemplate(envelope.type);
  }

  async shutdown(): Promise<void> {
    if (!this.transporter) return;

    // Stop the send processor
    if (this.sendTimer) {
      clearInterval(this.sendTimer);
      this.sendTimer = null;
    }

    // Drain queue with a 10 second timeout
    const startTime = Date.now();
    const timeout = 10_000;
    while (this.messageQueue.length > 0 && Date.now() - startTime < timeout) {
      await this.processSendQueue();
      await new Promise((resolve) => setTimeout(resolve, SEND_INTERVAL_MS));
    }

    if (this.messageQueue.length > 0) {
      logger.warn('Email queue not fully drained on shutdown', {
        remaining: this.messageQueue.length,
      });
    }

    try {
      this.transporter.close();
      logger.info('Email channel shutdown');
    } catch (error) {
      logger.error('Error closing email transporter', { error });
    }
  }

  // -----------------------------------------------------------------------
  // Processing
  // -----------------------------------------------------------------------

  async process(envelope: EventEnvelope): Promise<void> {
    if (!this.transporter) return;

    try {
      const db = this.getDb();

      // Resolve recipients using the shared resolver
      const recipientIds = await resolveRecipients(envelope, db);
      if (recipientIds.length === 0) {
        logger.debug('No email recipients for event', { eventId: envelope.id });
        return;
      }

      // Render the template
      const template = this.renderTemplate(envelope);
      if (!template) {
        logger.debug('No email template for event type', { eventType: envelope.type });
        return;
      }

      // Queue an email for each recipient. The per-user opt-out lives
      // on app_user.email_notifications; the column defaults to TRUE so
      // existing rows keep the prior behaviour. Users toggle it off via
      // PUT /api/v1/me { emailNotifications: false }.
      for (const userId of recipientIds) {
        const user = await db
          .selectFrom('app_user')
          .where('id', '=', userId)
          .select(['email', 'email_notifications'])
          .executeTakeFirst();

        if (!user?.email) {
          logger.debug('User has no email address', { eventId: envelope.id, userId });
          continue;
        }

        // Respect the user's opt-out. The default in the DB is TRUE,
        // so omitted/null values resolve to "opted in" — only an
        // explicit FALSE suppresses delivery.
        if (user.email_notifications === false) {
          logger.debug('Skipping email: user has email notifications disabled', {
            eventId: envelope.id,
            userId,
          });
          continue;
        }

        this.queueMessage({
          to: user.email,
          subject: template.subject,
          text: template.text,
          html: template.html,
        });

        logger.debug('Email queued', {
          eventId: envelope.id,
          userId,
          to: user.email,
          type: envelope.type,
        });
      }
    } catch (error) {
      logger.error('Email channel process error', { eventId: envelope.id, error });
    }
  }

  // -----------------------------------------------------------------------
  // Public helpers (for test endpoint)
  // -----------------------------------------------------------------------

  /**
   * Send a single test email directly, bypassing the queue.
   * Used by the admin SMTP test endpoint.
   */
  async sendTestEmail(to: string): Promise<void> {
    if (!this.transporter || !this.config) {
      throw new Error('Email channel is not initialized or SMTP is disabled');
    }

    await this.transporter.sendMail({
      from: this.config.SMTP_FROM,
      to,
      subject: 'CycloneDX Assessors Studio: SMTP Test',
      text: 'This is a test email from CycloneDX Assessors Studio. If you received this, your SMTP configuration is working correctly.',
      html: '<p>This is a test email from <strong>CycloneDX Assessors Studio</strong>.</p><p>If you received this, your SMTP configuration is working correctly.</p>',
    });
  }

  /**
   * Returns whether the transporter has been created (SMTP is enabled).
   */
  get isEnabled(): boolean {
    return this.transporter !== null;
  }

  // -----------------------------------------------------------------------
  // Template resolution
  // -----------------------------------------------------------------------

  private hasTemplate(eventType: string): boolean {
    return HANDLED_EVENT_TYPES.includes(eventType);
  }

  private renderTemplate(envelope: EventEnvelope): EmailTemplate | null {
    const { type, data } = envelope;
    const appUrl = this.config?.APP_URL;

    if (type === ASSESSMENT_CREATED) {
      return assessmentCreatedTemplate(data, appUrl);
    }
    if (type === ASSESSMENT_ASSIGNED) {
      return assessmentAssignedTemplate(data, appUrl);
    }
    if (type === ASSESSMENT_STATE_CHANGED) {
      const newState = data.newState as string | undefined;
      if (newState === 'in_review') return assessmentReadyForReviewTemplate(data, appUrl);
      // The state is 'complete'; 'completed' is what older events carried.
      if (newState === 'complete' || newState === 'completed') return assessmentCompletedTemplate(data, appUrl);
      return null;
    }
    if (type === EVIDENCE_CREATED) {
      return evidenceCreatedTemplate(data, appUrl);
    }
    if (type === EVIDENCE_STATE_CHANGED) {
      const newState = data.newState as string | undefined;
      if (newState === 'in_review') return evidenceReadyForReviewTemplate(data, appUrl);
      if (newState === 'claimed') return evidenceApprovedTemplate(data, appUrl);
      // A rejection sends evidence from in_review back to in_progress.
      if (newState === 'rejected' || (newState === 'in_progress' && data.previousState === 'in_review')) {
        return evidenceRejectedTemplate(data, appUrl);
      }
      return null;
    }
    if (type === ATTESTATION_CREATED) {
      return attestationCreatedTemplate(data, appUrl);
    }
    if (type === CHANNEL_WEBHOOK_DISABLED) {
      return webhookDisabledTemplate(data, appUrl);
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Rate limited send queue
  // -----------------------------------------------------------------------

  private queueMessage(message: QueuedMessage): void {
    if (this.messageQueue.length >= MAX_QUEUE_SIZE) {
      logger.warn('Email queue full, dropping message', {
        to: message.to,
        queueSize: this.messageQueue.length,
      });
      return;
    }
    this.messageQueue.push(message);
  }

  private startSendProcessor(): void {
    this.sendTimer = setInterval(() => {
      if (!this.isSending && this.messageQueue.length > 0) {
        this.processSendQueue().catch((error) => {
          logger.error('Error processing email send queue', { error });
        });
      }
    }, SEND_INTERVAL_MS);
  }

  private async processSendQueue(): Promise<void> {
    if (this.isSending || !this.messageQueue.length || !this.transporter) return;

    this.isSending = true;
    try {
      const message = this.messageQueue.shift();
      if (!message) return;

      await this.transporter.sendMail({
        from: this.config?.SMTP_FROM || 'noreply@assessors-studio.local',
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });

      logger.debug('Email sent', { to: message.to, subject: message.subject });
    } catch (error) {
      logger.error('Failed to send email', { error });
    } finally {
      this.isSending = false;
    }
  }
}
