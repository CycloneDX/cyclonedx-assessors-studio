/**
 * Notification Rules Engine.
 *
 * Evaluates notification rules against events to determine which users
 * should receive notifications via which channels. Replaces hardcoded
 * recipient resolution in recipients.ts.
 */

import type { Kysely, Selectable } from 'kysely';
import type { Database } from '../db/types.js';
import { logger } from '../utils/logger.js';
import type { EventEnvelope } from './types.js';
import type { NotificationRule } from '../db/types.js';
import { ChannelRegistry } from './channel-registry.js';
import { buildTitle, buildMessage, buildLink, insertNotification } from './notification-utils.js';
import { readableAssessmentIds, allowsAssessment, visibleEvidenceIds } from '../utils/access.js';

/**
 * Result of evaluating a rule against an event.
 * Contains the rule, the target user(s), and the resolved destination.
 */
export interface RuleMatch {
  rule: Selectable<NotificationRule>;
  userId?: string;
  destination?: Record<string, unknown>;
}


const NAMED_USER_FIELDS = ['authorId', 'reviewerId', 'requiredUserId', 'userId', 'assigneeId'];

/** The assessment an event is about, directly or via its attestation or affirmation. */
async function subjectAssessmentId(db: Kysely<Database>, data: Record<string, unknown>): Promise<string | null> {
  if (typeof data.assessmentId === 'string') return data.assessmentId;
  for (const [field, table] of [['attestationId', 'attestation'], ['affirmationId', 'affirmation']] as const) {
    const id = data[field];
    if (typeof id !== 'string') continue;
    const row = await db.selectFrom(table).select('assessment_id').where('id', '=', id).executeTakeFirst();
    if (row?.assessment_id) return row.assessment_id as string;
  }
  return null;
}

export class RulesEngine {
  private getDb: () => Kysely<Database>;
  private channelRegistry: ChannelRegistry | null = null;

  private canSee: (db: Kysely<Database>, userId: string, envelope: EventEnvelope) => Promise<boolean>;

  /**
   * @param canSee visibility check for personal rules; defaults to
   *   ownerCanSeeSubject. Injectable so unit tests of rule matching can run
   *   without a database.
   */
  constructor(
    getDb: () => Kysely<Database>,
    canSee?: (db: Kysely<Database>, userId: string, envelope: EventEnvelope) => Promise<boolean>,
  ) {
    this.getDb = getDb;
    this.canSee = canSee ?? ((db, userId, envelope) => this.ownerCanSeeSubject(db, userId, envelope));
  }

  /**
   * Set the channel registry (needed for dispatching to channels).
   */
  setChannelRegistry(registry: ChannelRegistry): void {
    this.channelRegistry = registry;
  }

  /**
   * Whether the owner of a personal rule may learn about this event:
   * they are named in it (author, reviewer, required signer), or they can
   * read its subject (assessment, evidence, attestation, affirmation).
   * Events with no recognizable subject are not delivered to personal rules.
   */
  private async ownerCanSeeSubject(db: Kysely<Database>, userId: string, envelope: EventEnvelope): Promise<boolean> {
    const data = envelope.data ?? {};
    if (NAMED_USER_FIELDS.some((k) => data[k] === userId)) return true;

    const user = await db.selectFrom('app_user').select(['id', 'role', 'is_active']).where('id', '=', userId).executeTakeFirst();
    if (!user || !user.is_active) return false;
    const owner = { id: user.id, role: user.role as string };

    const assessmentId = await subjectAssessmentId(db, data);
    if (assessmentId) {
      return allowsAssessment(await readableAssessmentIds(db, owner), assessmentId);
    }
    if (typeof data.evidenceId === 'string') {
      const visible = await visibleEvidenceIds(db, owner, [data.evidenceId]);
      return visible === null || visible.has(data.evidenceId);
    }
    return false;
  }

  /**
   * Evaluate all enabled rules against an event.
   * Returns matches: rule, userId, and resolved destination.
   */
  async evaluate(envelope: EventEnvelope): Promise<RuleMatch[]> {
    const db = this.getDb();
    const matches: RuleMatch[] = [];

    // Get all enabled rules
    const rules = (await db
      .selectFrom('notification_rule')
      .where('enabled', '=', true)
      .selectAll()
      .execute()) as Selectable<NotificationRule>[];

    for (const rule of rules) {
      // Check if event type is in the rule's event_types
      const eventTypes = Array.isArray(rule.event_types) ? rule.event_types : (rule.event_types || []);
      if (eventTypes.length > 0 && !eventTypes.includes(envelope.type) && !eventTypes.includes('*')) {
        continue;
      }

      // Handle system vs. user scoped rules
      if (rule.scope === 'system') {
        // System rules can apply to everyone (no user_id filter needed)
        const match = await this.evaluateRule(rule, envelope);
        if (match) {
          matches.push(match);
        }
      } else if (rule.scope === 'user' && rule.user_id) {
        // User rules only apply to that user
        if (!(await this.personalRuleApplies(db, rule.user_id, eventTypes, envelope))) {
          continue;
        }

        const match = await this.evaluateRule(rule, envelope);
        if (match) {
          match.userId = rule.user_id;
          matches.push(match);
        }
      }
    }

    return matches;
  }

  /**
   * A personal rule never fires for its owner's own actions, must name its
   * events (no '*' or empty list), and may only fire for events whose
   * subject its owner can see; '*' used to deliver every event in the
   * organization (security review Z10). Rules saved before the fix are
   * filtered here too.
   */
  private async personalRuleApplies(db: Kysely<Database>, userId: string, eventTypes: string[], envelope: EventEnvelope): Promise<boolean> {
    if (envelope.actor.userId === userId) return false;
    if (eventTypes.length === 0 || (eventTypes.includes('*') && !eventTypes.includes(envelope.type))) return false;
    return this.canSee(db, userId, envelope);
  }

  /**
   * Evaluate a single rule against an event.
   * Returns a RuleMatch if filters pass, null otherwise.
   */
  private async evaluateRule(rule: Selectable<NotificationRule>, envelope: EventEnvelope): Promise<RuleMatch | null> {
    const db = this.getDb();
    const filters = rule.filters || {};

    // Evaluate each filter
    if (filters.my_assessments) {
      const assessmentId = envelope.data.assessmentId as string | undefined;
      if (!assessmentId || !rule.user_id) {
        return null;
      }

      // Check if user is an assessor or assessee on this assessment
      const isParticipant = await db
        .selectFrom('assessment_assessor')
        .where('assessment_id', '=', assessmentId)
        .where('user_id', '=', rule.user_id)
        .executeTakeFirst();

      if (!isParticipant) {
        const isAssessee = await db
          .selectFrom('assessment_assessee')
          .where('assessment_id', '=', assessmentId)
          .where('user_id', '=', rule.user_id)
          .executeTakeFirst();

        if (!isAssessee) {
          return null;
        }
      }
    }

    if (filters.my_evidence) {
      const authorId = envelope.data.authorId as string | undefined;
      if (!authorId || authorId !== rule.user_id) {
        return null;
      }
    }

    if (filters.my_projects) {
      const projectId = envelope.data.projectId as string | undefined;
      if (!projectId || !rule.user_id) {
        return null;
      }

      // For now, we don't have a project membership table, so skip this filter
      // In the future, this would check the project_user or similar table
      logger.debug('my_projects filter not yet fully implemented');
    }

    if (filters.specific_project && filters.specific_project_value) {
      const projectId = envelope.data.projectId as string | undefined;
      if (projectId !== filters.specific_project_value) {
        return null;
      }
    }

    if (filters.specific_standard && filters.specific_standard_value) {
      const standardId = envelope.data.standardId as string | undefined;
      if (standardId !== filters.specific_standard_value) {
        return null;
      }
    }

    if (filters.specific_assessment && filters.specific_assessment_value) {
      const assessmentId = envelope.data.assessmentId as string | undefined;
      if (assessmentId !== filters.specific_assessment_value) {
        return null;
      }
    }

    // Resolve destination based on channel
    const destination = await this.resolveDestination(rule);
    if (!destination && rule.channel !== 'in_app') {
      // in_app doesn't need a resolved destination
      return null;
    }

    return {
      rule,
      destination: destination || undefined,
    };
  }

  /**
   * Resolve the delivery destination for a rule based on channel and user profile.
   */
  // biome-ignore lint/suspicious/noExplicitAny: Returns dynamic channel-specific configuration
  private async resolveDestination(rule: Selectable<NotificationRule>): Promise<Record<string, unknown> | null> {
    if (rule.channel === 'in_app') {
      return {};
    }

    if (!rule.user_id) {
      return rule.destination;
    }

    const db = this.getDb();
    const user = await db
      .selectFrom('app_user')
      .where('id', '=', rule.user_id)
      .selectAll()
      .executeTakeFirst();

    if (!user) {
      return null;
    }

    switch (rule.channel) {
      case 'email':
        return { email: user.email };
      case 'slack':
        if (!user.slack_user_id) {
          logger.debug('User has no Slack ID', { userId: rule.user_id });
          return null;
        }
        return { slackUserId: user.slack_user_id };
      case 'teams':
        if (!user.teams_user_id) {
          logger.debug('User has no Teams ID', { userId: rule.user_id });
          return null;
        }
        return { teamsUserId: user.teams_user_id };
      case 'mattermost':
        if (!user.mattermost_username) {
          logger.debug('User has no Mattermost username', { userId: rule.user_id });
          return null;
        }
        return { mattermostUsername: user.mattermost_username };
      case 'webhook':
        return rule.destination; // Use configured webhook endpoint
      default:
        return null;
    }
  }

  /**
   * Process an event: evaluate rules and dispatch to appropriate channels.
   */
  async processEvent(envelope: EventEnvelope): Promise<void> {
    if (!this.channelRegistry) {
      logger.warn('RulesEngine: ChannelRegistry not set, skipping event processing');
      return;
    }

    try {
      const matches = await this.evaluate(envelope);

      // Group matches by channel
      const byChannel: Record<string, RuleMatch[]> = {};
      for (const match of matches) {
        const channel = match.rule.channel;
        if (!byChannel[channel]) {
          byChannel[channel] = [];
        }
        byChannel[channel].push(match);
      }

      // Dispatch to each channel
      for (const [channelName, channelMatches] of Object.entries(byChannel)) {
        if (channelName === 'in_app') {
          // Special handling for in-app: create notifications directly
          await this.deliverInApp(envelope, channelMatches);
        }
        // Every other channel (email, webhook, chat) is subscribed to the
        // event bus by ChannelRegistry.initializeAll and processes each
        // event itself. Calling process() here as well delivered twice,
        // and let any user's personal rule trigger the organization's
        // admin-configured integrations (security review X9).
      }
    } catch (error) {
      logger.error('RulesEngine: Error processing event', {
        eventId: envelope.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Deliver in-app notifications to matched users.
   */
  private async deliverInApp(envelope: EventEnvelope, matches: RuleMatch[]): Promise<void> {
    const db = this.getDb();
    const title = buildTitle(envelope);
    const message = buildMessage(envelope);
    const link = buildLink(envelope);

    for (const match of matches) {
      const userId = match.rule.user_id || match.userId;
      if (!userId) {
        continue;
      }

      await insertNotification(db, envelope, userId, title, message, link);
    }
  }
}
