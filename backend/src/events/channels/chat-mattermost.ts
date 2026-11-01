/**
 * Mattermost notification channel.
 *
 * Sends event notifications to Mattermost channels via incoming webhooks
 * using Markdown attachment format.
 */

import { isPrivateOrReservedUrl } from '../../utils/url-safety.js';
import type { EventEnvelope } from '../types.js';
import { BaseChatChannel } from './chat-base.js';
import { formatMattermostMessage } from './chat-formatters.js';

export class MattermostChannel extends BaseChatChannel {
  platform = 'mattermost';

  formatMessage(envelope: EventEnvelope, appUrl: string): Record<string, unknown> {
    return formatMattermostMessage(envelope, appUrl);
  }

  /**
   * Validate webhook URL format for Mattermost.
   * Must start with https:// (no further restriction since it is self-hosted).
   */
  static validateWebhookUrl(url: string): boolean {
    // Self-hosted, so any public https host; never a private or reserved one.
    return !isPrivateOrReservedUrl(url);
  }
}
