/**
 * Slack notification channel.
 *
 * Sends event notifications to Slack channels via incoming webhooks
 * using Block Kit message format.
 */

import { isPrivateOrReservedUrl } from '../../utils/url-safety.js';
import type { EventEnvelope } from '../types.js';
import { BaseChatChannel } from './chat-base.js';
import { formatSlackMessage } from './chat-formatters.js';

export class SlackChannel extends BaseChatChannel {
  platform = 'slack';

  formatMessage(envelope: EventEnvelope, appUrl: string): Record<string, unknown> {
    return formatSlackMessage(envelope, appUrl);
  }

  /**
   * Validate webhook URL format for Slack.
   * Must start with https://hooks.slack.com/
   */
  static validateWebhookUrl(url: string): boolean {
    if (isPrivateOrReservedUrl(url)) return false;
    return new URL(url).hostname.toLowerCase() === 'hooks.slack.com';
  }
}
