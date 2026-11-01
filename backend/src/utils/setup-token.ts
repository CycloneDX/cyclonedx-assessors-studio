/**
 * One-time token that gates POST /api/v1/setup (security review W3/A12).
 *
 * Before setup completes, anyone who can reach the server could create
 * the first admin. The token proves the caller can read the server's
 * logs (or its configuration): it comes from SETUP_TOKEN when set,
 * otherwise it is generated at boot and printed to the log.
 */
import crypto from 'node:crypto';
import { getConfig } from '../config/index.js';
import { logger } from './logger.js';

let generated: string | null = null;

export function getSetupToken(): string {
  const configured = getConfig().SETUP_TOKEN;
  if (configured) return configured;
  generated ??= crypto.randomBytes(18).toString('base64url');
  return generated;
}

/** Constant-time comparison against the active setup token. */
export function isValidSetupToken(candidate: unknown): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  const expected = Buffer.from(getSetupToken());
  const actual = Buffer.from(candidate);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Logs where to find the token, at boot, while setup is incomplete. */
export function announceSetupToken(): void {
  if (getConfig().SETUP_TOKEN) {
    logger.warn('Setup is not complete. Enter the SETUP_TOKEN from your configuration in the setup wizard.');
    return;
  }
  // The value is in the message text on purpose: the logger redacts
  // fields named "token", and the operator must be able to read it.
  logger.warn(`Setup is not complete. Setup token for the wizard: ${getSetupToken()}`);
}
