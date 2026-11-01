/**
 * Shared helpers for notification rule CRUD operations.
 * Extracted from admin-notification-rules.ts and notification-rules.ts.
 */

import { z } from 'zod';

/**
 * Shared validation schema for creating notification rules.
 */
export const createRuleSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  channel: z.enum(['in_app', 'email', 'slack', 'teams', 'mattermost', 'webhook']),
  eventTypes: z.array(z.string()).min(1, 'At least one event type is required'),
  filters: z.record(z.string(), z.unknown()).optional().default({}),
  destination: z.record(z.string(), z.unknown()).optional().default({}),
  enabled: z.boolean().optional().default(true),
});

/**
 * Shared validation schema for updating notification rules (partial).
 */
export const updateRuleSchema = createRuleSchema.partial();

/**
 * Valid event types for admin/system rules (comprehensive list).
 */
export const ADMIN_VALID_EVENT_TYPES = [
  // Assessment
  'assessment.created',
  'assessment.state_changed',
  'assessment.deleted',
  'assessment.assigned',
  // Evidence
  'evidence.created',
  'evidence.state_changed',
  'evidence.attachment_added',
  'evidence.attachment_removed',
  // Claim
  'claim.created',
  'claim.updated',
  // Attestation
  'attestation.created',
  'attestation.signed',
  'attestation.exported',
  // Affirmation
  'affirmation.created',
  'affirmation.signatory_assigned',
  'affirmation.signed',
  'affirmation.seal_ready',
  'affirmation.sealed',
  'affirmation.rescinded',
  // Project
  'project.created',
  'project.state_changed',
  'project.archived',
  // Standard
  'standard.imported',
  'standard.state_changed',
  // System
  'user.created',
  'user.deactivated',
  'apikey.created',
  // Wildcard
  '*',
];

/**
 * Valid event types for user-scoped rules (restricted list).
 */
export const USER_VALID_EVENT_TYPES = [
  'assessment.created',
  'assessment.state_changed',
  'evidence.state_changed',
  'attestation.created',
  'attestation.signed',
  'affirmation.signatory_assigned',
  'affirmation.seal_ready',
  'affirmation.sealed',
  'affirmation.rescinded',
  // No '*': a personal rule names the events it wants (security review Z10).
];

/**
 * Validate event types against a list of valid types.
 * Returns error message if validation fails, null if successful.
 */
export function validateEventTypes(
  eventTypes: string[],
  validTypes: string[]
): string | null {
  for (const eventType of eventTypes) {
    if (!validTypes.includes(eventType)) {
      return `Invalid event type: ${eventType}`;
    }
  }
  return null;
}
