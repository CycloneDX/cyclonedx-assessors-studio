/**
 * Delivers password reset links by email.
 *
 * Independent of the notification email channel: a reset link is an
 * account-security message, sent whatever the user's notification rules
 * say, as long as SMTP is configured.
 *
 * The token travels in the URL fragment (#token=...), so browsers never
 * send it to the server in a request line or a Referer header.
 */
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { passwordResetTemplate, type EmailTemplate } from '../events/channels/email-templates.js';

export interface ResetMailer {
  send(to: string, template: EmailTemplate): Promise<void>;
}

let mailerOverride: ResetMailer | null | undefined;
let transporter: Transporter | null = null;

/**
 * Test seam: replace the mailer (null = behave as if SMTP is off).
 *
 * @internal Test seam; not part of the module API.
 */
export function setResetMailerForTests(mailer: ResetMailer | null | undefined): void {
  mailerOverride = mailer;
}

function smtpMailer(): ResetMailer | null {
  if (mailerOverride !== undefined) return mailerOverride;
  const config = getConfig();
  if (!config.SMTP_ENABLED || !config.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    tls: { rejectUnauthorized: config.SMTP_TLS_REJECT_UNAUTHORIZED },
  });
  const from = config.SMTP_FROM || config.SMTP_USER;
  const smtp = transporter;
  return {
    async send(to, template) {
      await smtp.sendMail({ from, to, subject: template.subject, text: template.text, html: template.html });
    },
  };
}

export function resetUrl(token: string): string {
  const base = getConfig().APP_URL.replace(/\/+$/, '');
  return `${base}/reset-password#token=${encodeURIComponent(token)}`;
}

/**
 * Sends the reset email. Returns what happened: 'sent', 'logged' (no
 * SMTP outside production: the link is written to the log for local
 * use), or 'unavailable' (no SMTP in production: nothing is sent and the
 * token is never logged).
 */
export async function deliverPasswordReset(
  user: { id: string; email: string },
  token: string,
  expiresAt: Date,
): Promise<'sent' | 'logged' | 'unavailable'> {
  const url = resetUrl(token);
  const mailer = smtpMailer();
  if (mailer) {
    const expiresInMinutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
    await mailer.send(user.email, passwordResetTemplate({ resetUrl: url, expiresInMinutes }));
    logger.info('Password reset email sent', { userId: user.id });
    return 'sent';
  }
  if (getConfig().NODE_ENV === 'production') {
    logger.warn('Password reset requested but SMTP is not configured; no email was sent', { userId: user.id });
    return 'unavailable';
  }
  // Development convenience only. The message text carries the link
  // because the logger redacts fields named like tokens.
  logger.info(`Password reset link (SMTP not configured, not production): ${url}`, { userId: user.id });
  return 'logged';
}
