/**
 * Unit tests for the webhook notification channel.
 *
 * Tests HMAC signature, delivery creation, retry logic, auto-disable,
 * wildcard subscriptions, and delivery cleanup.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Hermetic delivery: these tests used to make live requests to httpbin.org
// and example.com. Keep the same outcomes without the network.
vi.mock('../../utils/safe-fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/safe-fetch.js')>();
  return {
    ...actual,
    safeFetch: vi.fn(async (url: string) => {
      const host = new URL(url).hostname;
      if (host === 'httpbin.org') return { status: 200, ok: true, text: '', truncated: false };
      if (host === 'example.com') return { status: 404, ok: false, text: '', truncated: false };
      throw new actual.UnsafeUrlError('Target address is private or reserved');
    }),
  };
});
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { computeSignature, WebhookChannel } from '../../events/webhook-channel.js';
import { CHANNEL_WEBHOOK_DISABLED, EVIDENCE_STATE_CHANGED } from '../../events/catalog.js';
import type { EventEnvelope } from '../../events/types.js';
import {
  setupTestDb,
  teardownTestDb,
  getTestDatabase,
  createTestUser,
} from '../helpers/setup.js';

describe('HMAC Signature', () => {
  it('computes correct HMAC-SHA256 signature', () => {
    const secret = 'test-secret';
    const timestamp = 1700000000;
    const body = '{"type":"test"}';

    const sig = computeSignature(secret, timestamp, body);

    // Verify independently
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    expect(sig).toBe(expected);
  });

  it('produces different signatures for different secrets', () => {
    const body = '{"type":"test"}';
    const ts = 1700000000;
    const sig1 = computeSignature('secret-a', ts, body);
    const sig2 = computeSignature('secret-b', ts, body);
    expect(sig1).not.toBe(sig2);
  });

  it('produces different signatures for different timestamps', () => {
    const body = '{"type":"test"}';
    const sig1 = computeSignature('secret', 1000, body);
    const sig2 = computeSignature('secret', 2000, body);
    expect(sig1).not.toBe(sig2);
  });

  it('produces different signatures for different bodies', () => {
    const sig1 = computeSignature('secret', 1000, '{"a":1}');
    const sig2 = computeSignature('secret', 1000, '{"a":2}');
    expect(sig1).not.toBe(sig2);
  });
});

describe('WebhookChannel with database', () => {
  beforeAll(async () => {
    process.env.WEBHOOK_ENABLED = 'true';
    process.env.WEBHOOK_TIMEOUT = '5000';
    process.env.WEBHOOK_MAX_RETRIES = '5';
    process.env.WEBHOOK_DELIVERY_RETENTION_DAYS = '30';
    await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await teardownTestDb();
  }, 30_000);

  it('creates delivery records when processing events', async () => {
    const db = getTestDatabase();
    const admin = await createTestUser({ username: 'wh_admin_1', role: 'admin' });

    // Create a webhook subscription
    const webhookId = uuidv4();
    await db.insertInto('webhook').values({
      id: webhookId,
      name: 'Test Webhook',
      url: 'https://httpbin.org/status/200',
      secret: 'test-secret-123',
      event_types: ['evidence.state_changed'] as any,
      is_active: true,
      consecutive_failures: 0,
      created_by: admin.id,
      created_at: new Date(),
      updated_at: new Date(),
    }).execute();

    const channel = new WebhookChannel(() => db);

    const envelope: EventEnvelope = {
      id: 'evt_test-wh-1',
      type: EVIDENCE_STATE_CHANGED,
      category: 'evidence',
      timestamp: new Date().toISOString(),
      version: '1',
      actor: { userId: admin.id, displayName: 'Admin' },
      data: { evidenceId: 'ev-1' },
    };

    await channel.process(envelope);

    // Give async delivery time to create the record
    await new Promise((resolve) => setTimeout(resolve, 200));

    const deliveries = await db
      .selectFrom('webhook_delivery')
      .where('webhook_id', '=', webhookId)
      .where('event_id', '=', 'evt_test-wh-1')
      .selectAll()
      .execute();

    expect(deliveries.length).toBeGreaterThanOrEqual(1);
    expect(deliveries[0].event_type).toBe('evidence.state_changed');
    expect(deliveries[0].attempt).toBe(1);
  });

  it('skips inactive webhooks', async () => {
    const db = getTestDatabase();
    const admin = await createTestUser({ username: 'wh_admin_2', role: 'admin' });

    const webhookId = uuidv4();
    await db.insertInto('webhook').values({
      id: webhookId,
      name: 'Inactive Webhook',
      url: 'https://example.com/hook',
      secret: 'secret',
      event_types: ['*'] as any,
      is_active: false,
      consecutive_failures: 0,
      created_by: admin.id,
      created_at: new Date(),
      updated_at: new Date(),
    }).execute();

    const channel = new WebhookChannel(() => db);

    const envelope: EventEnvelope = {
      id: 'evt_test-wh-2',
      type: 'test.event',
      category: 'test',
      timestamp: new Date().toISOString(),
      version: '1',
      actor: { userId: null, displayName: 'System' },
      data: {},
    };

    await channel.process(envelope);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const deliveries = await db
      .selectFrom('webhook_delivery')
      .where('webhook_id', '=', webhookId)
      .selectAll()
      .execute();

    expect(deliveries).toHaveLength(0);
  });

  it('wildcard subscription matches all event types', async () => {
    const db = getTestDatabase();
    const admin = await createTestUser({ username: 'wh_admin_3', role: 'admin' });

    const webhookId = uuidv4();
    await db.insertInto('webhook').values({
      id: webhookId,
      name: 'Wildcard Webhook',
      url: 'https://httpbin.org/status/200',
      secret: 'secret',
      event_types: ['*'] as any,
      is_active: true,
      consecutive_failures: 0,
      created_by: admin.id,
      created_at: new Date(),
      updated_at: new Date(),
    }).execute();

    const channel = new WebhookChannel(() => db);

    // Emit two different event types
    const e1: EventEnvelope = {
      id: 'evt_wc-1',
      type: 'assessment.created',
      category: 'assessment',
      timestamp: new Date().toISOString(),
      version: '1',
      actor: { userId: null, displayName: 'System' },
      data: {},
    };

    const e2: EventEnvelope = {
      id: 'evt_wc-2',
      type: 'project.archived',
      category: 'project',
      timestamp: new Date().toISOString(),
      version: '1',
      actor: { userId: null, displayName: 'System' },
      data: {},
    };

    await channel.process(e1);
    await channel.process(e2);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const deliveries = await db
      .selectFrom('webhook_delivery')
      .where('webhook_id', '=', webhookId)
      .selectAll()
      .execute();

    expect(deliveries.length).toBeGreaterThanOrEqual(2);
    const types = deliveries.map((d: any) => d.event_type);
    expect(types).toContain('assessment.created');
    expect(types).toContain('project.archived');
  });

  it('does not match unsubscribed event types', async () => {
    const db = getTestDatabase();
    const admin = await createTestUser({ username: 'wh_admin_4', role: 'admin' });

    const webhookId = uuidv4();
    await db.insertInto('webhook').values({
      id: webhookId,
      name: 'Scoped Webhook',
      url: 'https://httpbin.org/status/200',
      secret: 'secret',
      event_types: ['assessment.created'] as any,
      is_active: true,
      consecutive_failures: 0,
      created_by: admin.id,
      created_at: new Date(),
      updated_at: new Date(),
    }).execute();

    const channel = new WebhookChannel(() => db);

    const envelope: EventEnvelope = {
      id: 'evt_scoped-1',
      type: 'project.archived',
      category: 'project',
      timestamp: new Date().toISOString(),
      version: '1',
      actor: { userId: null, displayName: 'System' },
      data: {},
    };

    await channel.process(envelope);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const deliveries = await db
      .selectFrom('webhook_delivery')
      .where('webhook_id', '=', webhookId)
      .selectAll()
      .execute();

    expect(deliveries).toHaveLength(0);
  });

  it('delivery retention cleanup removes old success/exhausted records', async () => {
    const db = getTestDatabase();
    const admin = await createTestUser({ username: 'wh_admin_5', role: 'admin' });

    const webhookId = uuidv4();
    await db.insertInto('webhook').values({
      id: webhookId,
      name: 'Cleanup Webhook',
      url: 'https://example.com/hook',
      secret: 'secret',
      event_types: ['*'] as any,
      is_active: true,
      consecutive_failures: 0,
      created_by: admin.id,
      created_at: new Date(),
      updated_at: new Date(),
    }).execute();

    // Insert old delivery records (60 days ago)
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const oldSuccessId = uuidv4();
    const oldExhaustedId = uuidv4();
    const recentSuccessId = uuidv4();

    await db.insertInto('webhook_delivery').values({
      id: oldSuccessId,
      webhook_id: webhookId,
      event_id: 'evt_old1',
      event_type: 'test',
      status: 'success',
      attempt: 1,
      created_at: oldDate,
    }).execute();

    await db.insertInto('webhook_delivery').values({
      id: oldExhaustedId,
      webhook_id: webhookId,
      event_id: 'evt_old2',
      event_type: 'test',
      status: 'exhausted',
      attempt: 5,
      created_at: oldDate,
    }).execute();

    await db.insertInto('webhook_delivery').values({
      id: recentSuccessId,
      webhook_id: webhookId,
      event_id: 'evt_recent',
      event_type: 'test',
      status: 'success',
      attempt: 1,
      created_at: new Date(),
    }).execute();

    const channel = new WebhookChannel(() => db);
    await channel.cleanupDeliveries();

    // Old records should be deleted, recent one should remain
    const remaining = await db
      .selectFrom('webhook_delivery')
      .where('webhook_id', '=', webhookId)
      .selectAll()
      .execute();

    const ids = remaining.map((r: any) => r.id);
    expect(ids).not.toContain(oldSuccessId);
    expect(ids).not.toContain(oldExhaustedId);
    expect(ids).toContain(recentSuccessId);
  });

  it('auto-disables webhook after threshold consecutive failures', async () => {
    const db = getTestDatabase();
    const admin = await createTestUser({ username: 'wh_admin_6', role: 'admin' });

    const webhookId = uuidv4();
    await db.insertInto('webhook').values({
      id: webhookId,
      name: 'Fragile Webhook',
      url: 'https://example.com/hook',
      secret: 'secret',
      event_types: ['*'] as any,
      is_active: true,
      consecutive_failures: 49, // one away from threshold
      created_by: admin.id,
      created_at: new Date(),
      updated_at: new Date(),
    }).execute();

    let disabledEventEmitted = false;
    const channel = new WebhookChannel(() => db);
    channel.setEmitter((type, _data) => {
      if (type === CHANNEL_WEBHOOK_DISABLED) {
        disabledEventEmitted = true;
      }
    });

    // Directly create a delivery record and simulate failure
    const deliveryId = uuidv4();
    await db.insertInto('webhook_delivery').values({
      id: deliveryId,
      webhook_id: webhookId,
      event_id: 'evt_fail',
      event_type: 'test',
      status: 'pending',
      attempt: 5, // at max retries so it will exhaust
      created_at: new Date(),
    }).execute();

    // Call attemptDelivery with a URL that will fail (connection refused)
    // We use a non-routable address to ensure failure
    await channel.attemptDelivery(
      deliveryId,
      { id: webhookId, url: 'http://192.0.2.1:1/', secret: 'secret', consecutive_failures: 49 },
      '{"type":"test"}',
      Math.floor(Date.now() / 1000),
      'fakesig',
      1000, // 1s timeout
    );

    // Check webhook was auto-disabled
    const webhook = await db
      .selectFrom('webhook')
      .where('id', '=', webhookId)
      .selectAll()
      .executeTakeFirst();

    expect(webhook!.is_active).toBe(false);
    expect(webhook!.consecutive_failures).toBe(50);
    expect(disabledEventEmitted).toBe(true);
  }, 15_000);

  it('resets consecutive failures on successful delivery', async () => {
    const db = getTestDatabase();
    const admin = await createTestUser({ username: 'wh_admin_7', role: 'admin' });

    const webhookId = uuidv4();
    await db.insertInto('webhook').values({
      id: webhookId,
      name: 'Recovery Webhook',
      url: 'https://httpbin.org/status/200',
      secret: 'secret',
      event_types: ['*'] as any,
      is_active: true,
      consecutive_failures: 10,
      created_by: admin.id,
      created_at: new Date(),
      updated_at: new Date(),
    }).execute();

    const channel = new WebhookChannel(() => db);
    const deliveryId = uuidv4();

    await db.insertInto('webhook_delivery').values({
      id: deliveryId,
      webhook_id: webhookId,
      event_id: 'evt_recover',
      event_type: 'test',
      status: 'pending',
      attempt: 1,
      created_at: new Date(),
    }).execute();

    const success = await channel.attemptDelivery(
      deliveryId,
      { id: webhookId, url: 'https://httpbin.org/status/200', secret: 'secret', consecutive_failures: 10 },
      '{"type":"test"}',
      Math.floor(Date.now() / 1000),
      'sig',
      5000,
    );

    expect(success).toBe(true);

    const webhook = await db
      .selectFrom('webhook')
      .where('id', '=', webhookId)
      .selectAll()
      .executeTakeFirst();

    expect(webhook!.consecutive_failures).toBe(0);
  }, 15_000);
});
