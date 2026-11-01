/**
 * Microsoft Teams notification channel.
 *
 * Sends event notifications to Teams channels via incoming webhooks
 * using Adaptive Card message format.
 */

import { isPrivateOrReservedUrl } from '../../utils/url-safety.js';
import type { EventEnvelope } from '../types.js';
import { BaseChatChannel } from './chat-base.js';
import { formatTeamsMessage } from './chat-formatters.js';

export class TeamsChannel extends BaseChatChannel {
  platform = 'teams';

  formatMessage(envelope: EventEnvelope, appUrl: string): Record<string, unknown> {
    return formatTeamsMessage(envelope, appUrl);
  }

  /**
   * Validate webhook URL format for Teams.
   * Must start with https:// and contain .webhook.office.com/ or .logic.azure.com/
   */
  static validateWebhookUrl(url: string): boolean {
    // Parse the host; a substring test accepted https://evil/?.webhook.office.com/
    if (isPrivateOrReservedUrl(url)) return false;
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('.webhook.office.com') || host.endsWith('.logic.azure.com');
  }
}
