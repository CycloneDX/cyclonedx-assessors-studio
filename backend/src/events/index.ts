/**
 * Event system barrel export.
 *
 * Provides a singleton event bus and channel registry, along with
 * initialization and shutdown functions for application lifecycle.
 */

export { EventBus } from './event-bus.js';
export { ChannelRegistry } from './channel-registry.js';
export { InAppChannel } from './in-app-channel.js';
export { WebhookChannel } from './webhook-channel.js';
export { EmailChannel } from './channels/email.js';
export { SlackChannel } from './channels/chat-slack.js';
export { TeamsChannel } from './channels/chat-teams.js';
export { MattermostChannel } from './channels/chat-mattermost.js';
export { RulesEngine } from './rules-engine.js';
export type { NotificationChannel } from './channel.js';
export type { EventEnvelope, Actor, EventOptions } from './types.js';
export type { RuleMatch } from './rules-engine.js';
export * from './catalog.js';

import { EventBus } from './event-bus.js';
import { ChannelRegistry } from './channel-registry.js';
import { InAppChannel } from './in-app-channel.js';
import { WebhookChannel } from './webhook-channel.js';
import { EmailChannel } from './channels/email.js';
import { SlackChannel } from './channels/chat-slack.js';
import { TeamsChannel } from './channels/chat-teams.js';
import { MattermostChannel } from './channels/chat-mattermost.js';
import { RulesEngine } from './rules-engine.js';
import { getDatabase } from '../db/connection.js';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

let eventBus: EventBus | null = null;
let channelRegistry: ChannelRegistry | null = null;
let rulesEngine: RulesEngine | null = null;

/**
 * Initialize the event system: create the bus, register channels,
 * wire the rules engine, and set up the event bus listener.
 */
export async function initializeEventSystem(): Promise<void> {
  eventBus = new EventBus();
  channelRegistry = new ChannelRegistry();

  // In-app channel is always registered
  const inAppChannel = new InAppChannel(() => getDatabase());
  channelRegistry.register(inAppChannel);

  // Register every enabled channel first, then initialize them all once.
  // initializeAll used to run before the email and chat channels were
  // registered, so they were never initialized (no SMTP transport, so no
  // email at all) and never subscribed (security review X9).
  const config = getConfig();
  const systemEmitter = (type: string, data: Record<string, unknown>) => {
    eventBus!.emit(type, data, { userId: null, displayName: 'System' });
  };

  let webhookChannel: WebhookChannel | null = null;
  if (config.WEBHOOK_ENABLED) {
    webhookChannel = new WebhookChannel(() => getDatabase());
    channelRegistry.register(webhookChannel);
  }

  if (config.SMTP_ENABLED) {
    channelRegistry.register(new EmailChannel(() => getDatabase()));
  }

  if (config.SLACK_ENABLED) {
    const slackChannel = new SlackChannel(() => getDatabase());
    channelRegistry.register(slackChannel);
    slackChannel.setEmitter(systemEmitter);
  }

  if (config.TEAMS_ENABLED) {
    const teamsChannel = new TeamsChannel(() => getDatabase());
    channelRegistry.register(teamsChannel);
    teamsChannel.setEmitter(systemEmitter);
  }

  if (config.MATTERMOST_ENABLED) {
    const mattermostChannel = new MattermostChannel(() => getDatabase());
    channelRegistry.register(mattermostChannel);
    mattermostChannel.setEmitter(systemEmitter);
  }

  await channelRegistry.initializeAll(eventBus!);

  // Wire the webhook emitter after initialization so the webhook channel
  // can emit events (e.g., channel.webhook.disabled) without a circular
  // dependency on the event bus.
  webhookChannel?.setEmitter(systemEmitter);

  // Initialize rules engine
  rulesEngine = new RulesEngine(() => getDatabase());
  rulesEngine.setChannelRegistry(channelRegistry);

  // Wire rules engine into event bus: process every event through rules
  eventBus.onAny(async (envelope) => {
    try {
      await rulesEngine!.processEvent(envelope);
    } catch (error) {
      logger.error('Rules engine error processing event', {
        eventId: envelope.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  logger.info('Event system initialized', {
    channels: channelRegistry.getChannelNames(),
    rulesEngineEnabled: true,
  });
}

/**
 * Shut down the event system gracefully.
 */
export async function shutdownEventSystem(): Promise<void> {
  if (channelRegistry) {
    await channelRegistry.shutdownAll();
  }
  if (eventBus) {
    eventBus.removeAllListeners();
  }
  eventBus = null;
  channelRegistry = null;
  rulesEngine = null;
  logger.info('Event system shut down');
}

/**
 * Get the singleton event bus. Throws if the system has not been initialized.
 */
export function getEventBus(): EventBus {
  if (!eventBus) {
    throw new Error('Event system not initialized. Call initializeEventSystem() first.');
  }
  return eventBus;
}

/**
 * Get the singleton channel registry.
 */
export function getChannelRegistry(): ChannelRegistry {
  if (!channelRegistry) {
    throw new Error('Event system not initialized. Call initializeEventSystem() first.');
  }
  return channelRegistry;
}

/**
 * Get the singleton rules engine.
 */
export function getRulesEngine(): RulesEngine {
  if (!rulesEngine) {
    throw new Error('Event system not initialized. Call initializeEventSystem() first.');
  }
  return rulesEngine;
}
