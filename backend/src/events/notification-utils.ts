/**
 * Shared notification utility functions.
 * Extracted from in-app-channel.ts and rules-engine.ts to reduce duplication.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import { logger } from '../utils/logger.js';
import type { EventEnvelope } from './types.js';

// ---- Title and message builders using lookup maps ----

type TitleBuilder = (data: Record<string, unknown>) => string;
type MessageBuilder = (data: Record<string, unknown>) => string;

/**
 * Title builders for specific event types.
 */
const titleBuilders: Record<string, TitleBuilder> = {
  'evidence.state_changed': (data) => {
    const state = data.newState as string | undefined;
    if (state === 'in_review') return 'Evidence Submitted for Review';
    if (state === 'approved' || state === 'claimed') return 'Evidence Approved';
    if (state === 'in_progress') return 'Evidence Rejected';
    return 'Evidence State Changed';
  },
  'assessment.state_changed': (data) => {
    const state = data.newState as string | undefined;
    if (state === 'in_progress') return 'Assessment Started';
    if (state === 'complete' || state === 'completed') return 'Assessment Completed';
    return 'Assessment State Changed';
  },
  'assessment.created': () => 'New Assessment Created',
  'attestation.created': () => 'Attestation Created',
  'attestation.signed': () => 'Attestation Signed',
};

/**
 * Message builders for specific event types.
 */
const messageBuilders: Record<string, MessageBuilder> = {
  'evidence.state_changed': (data) => {
    const state = data.newState as string | undefined;
    const name = (data.evidenceName || '') as string;
    if (state === 'in_review') return `Evidence "${name}" has been submitted for your review`;
    if (state === 'approved' || state === 'claimed') return `Your evidence "${name}" has been approved`;
    if (state === 'in_progress') {
      const reason = data.rejectionReason as string | undefined;
      return reason
        ? `Your evidence "${name}" has been rejected. Reason: ${reason}`
        : `Your evidence "${name}" has been rejected`;
    }
    return `Evidence "${name}" state changed to ${state}`;
  },
  'assessment.state_changed': (data) => {
    const state = data.newState as string | undefined;
    const title = (data.assessmentTitle || '') as string;
    if (state === 'in_progress') return `Assessment "${title}" has been started`;
    if (state === 'complete' || state === 'completed') return `Assessment "${title}" has been completed`;
    return `Assessment "${title}" state changed to ${state}`;
  },
  'assessment.created': (data) => {
    const title = (data.assessmentTitle || '') as string;
    return `Assessment "${title}" has been created`;
  },
};

/**
 * Build a human readable notification title from an event envelope.
 */
export function buildTitle(envelope: EventEnvelope): string {
  const builder = titleBuilders[envelope.type];
  if (builder) {
    return builder(envelope.data);
  }
  return envelope.type.replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build a human readable notification message from an event envelope.
 */
export function buildMessage(envelope: EventEnvelope): string {
  const builder = messageBuilders[envelope.type];
  if (builder) {
    return builder(envelope.data);
  }
  const name = (envelope.data.evidenceName || envelope.data.assessmentTitle || envelope.data.name || '') as string;
  return `${buildTitle(envelope)}: ${name || envelope.type}`;
}

/**
 * Build a link for the notification.
 */
export function buildLink(envelope: EventEnvelope): string | null {
  const { type, data } = envelope;

  if (type.startsWith('evidence.') && data.evidenceId) {
    return `/evidence/${String(data.evidenceId)}`;
  }
  if (type.startsWith('assessment.') && data.assessmentId) {
    return `/assessments/${String(data.assessmentId)}`;
  }
  if (type.startsWith('attestation.') && data.attestationId) {
    return `/attestations/${String(data.attestationId)}`;
  }
  if (type.startsWith('project.') && data.projectId) {
    return `/projects/${String(data.projectId)}`;
  }
  return null;
}

/**
 * Insert a notification into the database.
 * Shared by both in-app channel and rules engine.
 */
export async function insertNotification(
  db: Kysely<Database>,
  envelope: EventEnvelope,
  userId: string,
  title: string,
  message: string,
  link: string | null
): Promise<void> {
  try {
    await db
      .insertInto('notification')
      .values({
        id: uuidv4(),
        user_id: userId,
        type: envelope.type.replace(/\./g, '_'),
        title,
        message,
        link: link || undefined,
        is_read: false,
      })
      .execute();
  } catch (error) {
    logger.error('Failed to create in-app notification', {
      eventId: envelope.id,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
