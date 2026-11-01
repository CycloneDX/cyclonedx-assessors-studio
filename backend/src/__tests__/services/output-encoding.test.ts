/**
 * Security regression tests: user text in email and chat output
 * (security review X3, X4).
 */
import { describe, it, expect } from 'vitest';
import { evidenceReadyForReviewTemplate, evidenceRejectedTemplate } from '../../events/channels/email-templates.js';
import { formatSlackMessage, formatTeamsMessage, formatMattermostMessage } from '../../events/channels/chat-formatters.js';
import type { EventEnvelope } from '../../events/types.js';

const phishing = '<a href="https://evil.example/login">Re-authenticate</a>';

describe('email HTML escapes user text (X3)', () => {
  it('renders a malicious evidence name as text', () => {
    const t = evidenceReadyForReviewTemplate(
      { evidenceName: phishing, projectName: 'P', evidenceId: 'e1', submittedBy: '<img src=x onerror=alert(1)>' },
      'https://hub.example',
    );
    expect(t.html).not.toContain('<a href="https://evil.example');
    expect(t.html).not.toContain('<img src=x');
    expect(t.html).toContain('&lt;a href=&quot;https://evil.example/login&quot;&gt;');
    // Template structure (button, footer link) still renders as HTML.
    expect(t.html).toContain('<a href="https://hub.example/evidence/e1"');
    expect(t.html).toContain('https://hub.example/settings/notifications');
    // Plain text keeps the original characters.
    expect(t.text).toContain(phishing);
  });

  it('escapes the nested rejection feedback too', () => {
    const t = evidenceRejectedTemplate({ evidenceName: 'E', projectName: 'P', evidenceId: 'e1', rejectionReason: '<script>x</script>' }, undefined);
    expect(t.html).not.toContain('<script>');
    expect(t.html).toContain('<p><strong>Feedback:</strong> &lt;script&gt;x&lt;/script&gt;</p>');
  });
});

function envelope(data: Record<string, unknown>, actor = 'Mallory <!channel>'): EventEnvelope {
  return {
    id: 'evt_1',
    type: 'evidence.state_changed',
    category: 'evidence',
    timestamp: new Date().toISOString(),
    version: '1',
    actor: { userId: 'u1', displayName: actor },
    data,
  };
}

describe('chat messages escape user text (X4)', () => {
  const data = { evidenceName: '<!channel> <https://evil.example|Approve> [Approve](https://evil.example) @here', evidenceId: 'e1' };

  it('Slack: no broadcast or link syntax survives', () => {
    const text = JSON.stringify(formatSlackMessage(envelope(data), 'https://hub.example'));
    expect(text).not.toContain('<!channel>');
    expect(text).not.toContain('<https://evil.example|');
    expect(text).toContain('&lt;!channel&gt;');
  });

  it('Teams: markdown links render as text', () => {
    const text = JSON.stringify(formatTeamsMessage(envelope(data), 'https://hub.example'));
    expect(text).not.toContain('[Approve](https://evil.example)');
  });

  it('Mattermost: links and @here are neutralized', () => {
    const msg = formatMattermostMessage(envelope(data), 'https://hub.example') as { attachments: { fields: { value: string }[] }[] };
    const values = msg.attachments[0].fields.map((f) => f.value).join(' ');
    expect(values).not.toContain('[Approve](https://evil.example)');
    expect(values).not.toMatch(/@here\b/);
  });
});
