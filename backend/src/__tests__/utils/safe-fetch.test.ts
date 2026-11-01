/**
 * Security regression tests for outbound requests (security review X1,
 * X10, I2). A local HTTP server stands in for the "public" target; the
 * policy seam lets the test allow 127.0.0.1 so redirect handling and
 * address pinning can be observed without real DNS.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { safeFetch, UnsafeUrlError } from '../../utils/safe-fetch.js';
import { isPrivateIpAddress, isPrivateOrReservedUrl } from '../../utils/url-safety.js';
import { TeamsChannel } from '../../events/channels/chat-teams.js';
import { SlackChannel } from '../../events/channels/chat-slack.js';
import { MattermostChannel } from '../../events/channels/chat-mattermost.js';

let server: http.Server;
let port: number;
let metadataHits = 0;
let lastHostHeader = '';

const allowLoopback = {
  resolve: async () => [{ address: '127.0.0.1', family: 4 }],
  isBlockedAddress: (a: string) => a !== '127.0.0.1' && isPrivateIpAddress(a),
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastHostHeader = req.headers.host ?? '';
    if (req.url === '/redirect-to-metadata') {
      res.writeHead(302, { Location: `http://127.0.0.1:${port}/latest/meta-data/` });
      res.end();
      return;
    }
    if (req.url === '/latest/meta-data/') {
      metadataHits++;
      res.end('iam-credentials-secret');
      return;
    }
    if (req.url === '/big') {
      res.end('x'.repeat(100_000));
      return;
    }
    res.end('ok');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('safeFetch', () => {
  it('does not follow a redirect to an internal address (X1)', async () => {
    const res = await safeFetch(
      `http://hook.example.test:${port}/redirect-to-metadata`,
      { method: 'POST', body: '{}', requireHttps: false },
      allowLoopback,
    );
    expect(res.status).toBe(302);
    expect(res.ok).toBe(false);
    expect(metadataHits).toBe(0);
  });

  it('connects to the validated address while keeping the original Host (pinning)', async () => {
    const res = await safeFetch(`http://hook.example.test:${port}/`, { requireHttps: false }, allowLoopback);
    expect(res.status).toBe(200);
    expect(lastHostHeader).toBe(`hook.example.test:${port}`);
  });

  it('caps the response body', async () => {
    const res = await safeFetch(
      `http://hook.example.test:${port}/big`,
      { requireHttps: false, maxResponseBytes: 1024 },
      allowLoopback,
    );
    expect(res.text.length).toBe(1024);
    expect(res.truncated).toBe(true);
  });

  it('refuses a hostname that resolves to cloud metadata', async () => {
    await expect(
      safeFetch('https://hook.example.test/', {}, { resolve: async () => [{ address: '169.254.169.254', family: 4 }] }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses when any resolved address is private (no racing the runtime)', async () => {
    await expect(
      safeFetch('https://hook.example.test/', {}, {
        resolve: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }],
      }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('refuses plain http, credentials in the URL, and non-http schemes', async () => {
    await expect(safeFetch('http://example.com/')).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch('https://user:pw@example.com/')).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeFetch('file:///etc/passwd')).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe('address classification (X10)', () => {
  it.each([
    '169.254.169.254', '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '100.64.0.1',
    '0.0.0.0', '198.18.0.1', '192.0.0.8', '192.0.2.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fd00::1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe',
    '64:ff9b::a9fe:a9fe', '2002:a9fe:a9fe::1', '2001:db8::1', '2001::1', '::a9fe:a9fe', 'ff02::1',
  ])('blocks %s', (address) => {
    expect(isPrivateIpAddress(address)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111'])('allows public %s', (address) => {
    expect(isPrivateIpAddress(address)).toBe(false);
  });

  it('treats bracketed IPv6 literals in URLs as addresses', () => {
    expect(isPrivateOrReservedUrl('https://[::1]/hook')).toBe(true);
    expect(isPrivateOrReservedUrl('https://[::ffff:169.254.169.254]/')).toBe(true);
    expect(isPrivateOrReservedUrl('https://[64:ff9b::a9fe:a9fe]/')).toBe(true);
  });
});

describe('chat webhook URL validation (X10)', () => {
  it('Teams: parses the host instead of substring matching', () => {
    expect(TeamsChannel.validateWebhookUrl('https://evil.example/?.webhook.office.com/')).toBe(false);
    expect(TeamsChannel.validateWebhookUrl('https://contoso.webhook.office.com/webhookb2/abc')).toBe(true);
  });

  it('Slack: requires the exact hooks.slack.com host', () => {
    expect(SlackChannel.validateWebhookUrl('https://hooks.slack.com.evil.example/services/x')).toBe(false);
    expect(SlackChannel.validateWebhookUrl('https://hooks.slack.com/services/T/B/x')).toBe(true);
  });

  it('Mattermost: any public https host, never a private one', () => {
    expect(MattermostChannel.validateWebhookUrl('https://10.0.0.5/hooks/x')).toBe(false);
    expect(MattermostChannel.validateWebhookUrl('https://[::1]/hooks/x')).toBe(false);
    expect(MattermostChannel.validateWebhookUrl('https://chat.example.com/hooks/x')).toBe(true);
  });
});
