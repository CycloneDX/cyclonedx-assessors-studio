/**
 * HTTP-level security regression tests for outbound requests
 * (security review X1, I2).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import dns from 'node:dns/promises';
import { v4 as uuidv4 } from 'uuid';
import { setupHttpTests, loginAs } from '../helpers/http.js';

describe('Outbound request hardening (security review)', () => {
  setupHttpTests();

  describe('webhook deliveries API (X1)', () => {
    it('never returns a stored response body', async () => {
      const agent = await loginAs('admin');
      const created = await agent.post('/api/v1/webhooks').send({
        name: 'Body check',
        url: 'https://ci.example.com/webhook',
        eventTypes: ['evidence.state_changed'],
      });
      expect(created.status).toBe(201);
      const webhookId = created.body.id ?? created.body.webhook?.id;

      // An older row written before the fix, holding a target's response.
      const { getDatabase } = await import('../../db/connection.js');
      await getDatabase().insertInto('webhook_delivery').values({
        id: uuidv4(),
        webhook_id: webhookId,
        event_id: uuidv4(),
        event_type: 'evidence.state_changed',
        status: 'failed',
        http_status: 200,
        attempt: 1,
        response_body: 'iam-credentials-secret',
      }).execute();

      const res = await agent.get(`/api/v1/webhooks/${webhookId}/deliveries`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.body)).not.toContain('iam-credentials-secret');
      expect(res.body.data[0]).not.toHaveProperty('responseBody');
    });
  });

  describe('standards feed import (I2)', () => {
    it('rejects a non-https URL', async () => {
      const agent = await loginAs('admin');
      const res = await agent.post('/api/v1/standards/feed/import').send({ downloadUrl: 'http://example.com/std.json' });
      expect(res.status).toBe(400);
    });

    it.each([
      'https://127.0.0.1/std.json',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/std.json',
      'https://metadata.google.internal/computeMetadata/v1/',
    ])('refuses internal target %s with a generic error', async (downloadUrl) => {
      const agent = await loginAs('admin');
      const res = await agent.post('/api/v1/standards/feed/import').send({ downloadUrl });
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('Failed to fetch standard from the given URL');
    });
  });

  describe('integration URLs that resolve inside the network (E7 staging finding)', () => {
    // On staging, https://canary:8443/ was accepted at creation because
    // only IP literals and reserved names were checked; delivery then
    // refused it. Creation now resolves the name too.
    const realLookup = dns.lookup.bind(dns);
    function stubDns(map: Record<string, string>) {
      vi.spyOn(dns, 'lookup').mockImplementation((async (host: string, opts?: unknown) => {
        const addr = map[host];
        if (!addr) return realLookup(host, opts as never);
        const entry = { address: addr, family: addr.includes(':') ? 6 : 4 };
        return (opts as { all?: boolean } | undefined)?.all ? [entry] : entry;
      }) as never);
    }
    afterEach(() => vi.restoreAllMocks());

    it('refuses a webhook whose hostname resolves to a private address, on create and update', async () => {
      stubDns({ 'internal.example.test': '10.20.30.40', 'public.example.test': '93.184.216.34' });
      const agent = await loginAs('admin');
      const bad = await agent.post('/api/v1/webhooks').send({
        name: 'Internal', url: 'https://internal.example.test/hook', eventTypes: ['evidence.state_changed'],
      });
      expect(bad.status).toBe(400);

      const ok = await agent.post('/api/v1/webhooks').send({
        name: 'Public', url: 'https://public.example.test/hook', eventTypes: ['evidence.state_changed'],
      });
      expect(ok.status).toBe(201);
      const upd = await agent.put(`/api/v1/webhooks/${ok.body.id}`).send({ url: 'https://internal.example.test/hook' });
      expect(upd.status).toBe(400);
    });

    it('refuses a Mattermost URL whose hostname resolves to a private address', async () => {
      stubDns({ 'mm.internal.test': '192.168.1.20', 'mm.public.test': '93.184.216.34' });
      const agent = await loginAs('admin');
      const body = (webhookUrl: string) => ({ platform: 'mattermost', name: 'MM', webhookUrl, eventCategories: ['evidence'] });
      expect((await agent.post('/api/v1/integrations/chat').send(body('https://mm.internal.test/hooks/abc'))).status).toBe(400);
      expect((await agent.post('/api/v1/integrations/chat').send(body('https://mm.public.test/hooks/abc'))).status).toBe(201);
    });
  });
});
