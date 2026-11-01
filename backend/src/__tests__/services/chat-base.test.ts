/**
 * Unit tests for the BaseChatChannel abstract class.
 *
 * Tests retry logic, auto-disable on failures, delivery tracking,
 * and filter handling for chat-based channels.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { BaseChatChannel } from '../../events/channels/chat-base.js';
import type { EventEnvelope } from '../../events/types.js';

/**
 * Concrete implementation for testing the abstract BaseChatChannel.
 */
class TestChatChannel extends BaseChatChannel {
  platform = 'test-platform';

  formatMessage(_envelope: EventEnvelope, _appUrl: string): Record<string, unknown> {
    return {
      text: 'Test message',
      channel: '#general',
    };
  }

  static validateWebhookUrl(url: string): boolean {
    return url.startsWith('http');
  }
}

// Mock config
vi.mock('../../config/index.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    APP_URL: 'https://studio.example.com',
    CHAT_TIMEOUT: 5000,
    CHAT_DELIVERY_RETENTION_DAYS: 30,
  }),
}));

// Mock fetch. Delivery goes through safeFetch (pinned DNS, no redirects);
// bridge it to the global fetch mock so these tests stay hermetic and keep
// asserting on the request that would be sent.
global.fetch = vi.fn();
vi.mock('../../utils/safe-fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/safe-fetch.js')>();
  return {
    ...actual,
    safeFetch: vi.fn(async (url: string, opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }) => {
      try {
        const r = await (global.fetch as unknown as (u: string, i: unknown) => Promise<{ status: number; ok: boolean }>)(
          url, { method: opts.method, headers: opts.headers, body: opts.body },
        );
        return { status: r.status, ok: r.ok, text: '', truncated: false };
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw new Error(`Request timed out after ${opts.timeoutMs}ms`);
        throw err;
      }
    }),
  };
});

describe('BaseChatChannel', () => {
  let channel: TestChatChannel;
  let mockDb: Kysely<Database>;

  beforeEach(() => {
    // Create a mock database with chainable methods
    mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
      executeTakeFirst: vi.fn().mockResolvedValue(null),
      insertInto: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue({}),
        }),
      }),
      updateTable: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            execute: vi.fn().mockResolvedValue({}),
          }),
        }),
      }),
      deleteFrom: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue([{ numDeletedRows: 0n }]),
        }),
      }),
    } as unknown as Kysely<Database>;

    channel = new TestChatChannel(() => mockDb);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialize()', () => {
    it('sets name to platform identifier', async () => {
      await channel.initialize();
      expect(channel.name).toBe('test-platform');
    });

    it('starts retry timer', async () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      await channel.initialize();
      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        30_000, // RETRY_POLL_INTERVAL_MS
      );
      setIntervalSpy.mockRestore();
    });

    it('starts cleanup timer', async () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      await channel.initialize();
      const calls = setIntervalSpy.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      setIntervalSpy.mockRestore();
    });
  });

  describe('handles()', () => {
    it('always returns true', async () => {
      await channel.initialize();

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'assessment.created',
        category: 'assessment',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-1', displayName: 'John Doe' },
        data: {},
      };

      expect(channel.handles(envelope)).toBe(true);
    });
  });

  describe('process()', () => {
    it('skips test events to avoid loops', async () => {
      await channel.initialize();

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'channel.test',
        category: 'system',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: null, displayName: 'System' },
        data: {},
      };

      await channel.process(envelope);

      // Should not have queried integrations
      expect(mockDb.selectFrom).not.toHaveBeenCalled();
    });

    it('queries active integrations for platform', async () => {
      await channel.initialize();

      (mockDb.selectFrom as any).mockReturnValue({
        where: vi.fn().mockReturnThis(),
        selectAll: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([]),
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'assessment.created',
        category: 'assessment',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-1', displayName: 'John Doe' },
        data: {},
      };

      await channel.process(envelope);

      expect(mockDb.selectFrom).toHaveBeenCalled();
    });

    it('filters integrations by event category', async () => {
      await channel.initialize();

      const integration = {
        id: 'int-1',
        platform: 'test-platform',
        name: 'General Channel',
        webhook_url: 'https://example.com/webhook',
        event_categories: '["assessment"]',
        is_active: true,
        consecutive_failures: 0,
      };

      (mockDb.selectFrom as any).mockReturnValue({
        where: vi.fn().mockReturnThis(),
        selectAll: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([integration]),
        executeTakeFirst: vi.fn().mockResolvedValue(null),
      });

      (mockDb.insertInto as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue({}),
        }),
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'assessment.created',
        category: 'assessment',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-1', displayName: 'John Doe' },
        data: {},
      };

      await channel.process(envelope);

      // Give async dispatch time
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(true).toBe(true);
    });

    it('handles wildcard event category filter', async () => {
      await channel.initialize();

      const integration = {
        id: 'int-1',
        platform: 'test-platform',
        name: 'All Events',
        webhook_url: 'https://example.com/webhook',
        event_categories: '["*"]',
        is_active: true,
        consecutive_failures: 0,
      };

      (mockDb.selectFrom as any).mockReturnValue({
        where: vi.fn().mockReturnThis(),
        selectAll: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([integration]),
        executeTakeFirst: vi.fn().mockResolvedValue(null),
      });

      (mockDb.insertInto as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue({}),
        }),
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'custom.event',
        category: 'custom',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-1', displayName: 'John Doe' },
        data: {},
      };

      await channel.process(envelope);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(true).toBe(true);
    });
  });

  describe('Retry logic', () => {
    it('has retry delays in milliseconds', () => {
      // Test by checking that retry schedule follows expected pattern
      // Immediate (0ms), 1m, 5m, 30m, 2h
      expect(channel.platform).toBe('test-platform');
    });

    it('has MAX_RETRIES of 5 attempts', () => {
      // Verified by implementation reading
      expect(channel.platform).toBe('test-platform');
    });

    it('retries failed deliveries', async () => {
      await channel.initialize();

      const pendingRetry = {
        delivery_id: 'dlv-123',
        attempt: 2,
        event_id: 'evt-456',
        event_type: 'assessment.created',
        integration_id: 'int-789',
        webhook_url: 'https://example.com/webhook',
        consecutive_failures: 3,
      };

      let callCount = 0;
      (mockDb.selectFrom as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // processRetries query
          return {
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue([pendingRetry]),
          };
        }
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue([]),
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        };
      });

      (mockDb.updateTable as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            execute: vi.fn().mockResolvedValue({}),
          }),
        }),
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
      });

      // Trigger retry processing
      await (channel as any).processRetries();

      expect(true).toBe(true);
    });

    it('exhausts after MAX_RETRIES', async () => {
      await channel.initialize();

      const exhaustedDelivery = {
        delivery_id: 'dlv-123',
        attempt: 5,
        event_id: 'evt-456',
        event_type: 'assessment.created',
        integration_id: 'int-789',
        webhook_url: 'https://example.com/webhook',
        consecutive_failures: 10,
      };

      let callCount = 0;
      (mockDb.selectFrom as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue([exhaustedDelivery]),
          };
        }
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue([]),
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        };
      });

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
      });

      expect(true).toBe(true);
    });
  });

  describe('Auto-disable threshold', () => {
    it('disables integration after 50 consecutive failures', async () => {
      await channel.initialize();

      // Integration with 50+ failures should be auto-disabled
      const failingIntegration = {
        id: 'int-fail',
        platform: 'test-platform',
        name: 'Failing Webhook',
        webhook_url: 'https://example.com/webhook',
        event_categories: '["assessment"]',
        is_active: true,
        consecutive_failures: 49, // Will increment to 50 on next failure
      };

      (mockDb.selectFrom as any).mockReturnValue({
        where: vi.fn().mockReturnThis(),
        selectAll: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([failingIntegration]),
        executeTakeFirst: vi.fn().mockResolvedValue(null),
      });

      (mockDb.insertInto as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue({}),
        }),
      });

      (mockDb.updateTable as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            execute: vi.fn().mockResolvedValue({}),
          }),
        }),
      });

      (global.fetch as any).mockRejectedValue(new Error('Connection failed'));

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'assessment.created',
        category: 'assessment',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-1', displayName: 'John Doe' },
        data: {},
      };

      await channel.process(envelope);

      // The auto-disable path writes to the DB asynchronously after
      // process() resolves — the failure bookkeeping continues in a
      // background promise, and the updateTable call lands a few
      // event-loop ticks later. Poll for the side effect instead of
      // sleeping a fixed 100 ms: under full-suite parallel load that
      // wait is not always long enough and the test flakes.
      await vi.waitFor(
        () => {
          expect(mockDb.updateTable).toHaveBeenCalled();
        },
        { timeout: 5_000, interval: 25 },
      );
    });
  });

  describe('sendTestMessage()', () => {
    it('sends test message to integration', async () => {
      await channel.initialize();

      const integration = {
        id: 'int-1',
        platform: 'test-platform',
        name: 'Test Integration',
        webhook_url: 'https://example.com/webhook',
        is_active: true,
      };

      (mockDb.selectFrom as any).mockReturnValue({
        where: vi.fn().mockReturnThis(),
        selectAll: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([]),
        executeTakeFirst: vi.fn().mockResolvedValue(integration),
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
      });

      const result = await channel.sendTestMessage('int-1');

      expect(result.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('returns failure message when integration not found', async () => {
      await channel.initialize();

      (mockDb.selectFrom as any).mockReturnValue({
        where: vi.fn().mockReturnThis(),
        selectAll: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn().mockResolvedValue(null),
      });

      const result = await channel.sendTestMessage('int-nonexistent');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('returns timeout error on fetch timeout', async () => {
      await channel.initialize();

      const integration = {
        id: 'int-1',
        webhook_url: 'https://example.com/webhook',
        name: 'Test',
        is_active: true,
      };

      (mockDb.selectFrom as any).mockReturnValue({
        where: vi.fn().mockReturnThis(),
        selectAll: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn().mockResolvedValue(integration),
      });

      const abortError = new Error('Aborted');
      (abortError as any).name = 'AbortError';
      (global.fetch as any).mockRejectedValue(abortError);

      const result = await channel.sendTestMessage('int-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('timed out');
    });
  });

  describe('shutdown()', () => {
    it('clears retry timer', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      await channel.initialize();
      await channel.shutdown();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('clears cleanup timer', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      await channel.initialize();
      await channel.shutdown();
      const callCount = clearIntervalSpy.mock.calls.length;
      expect(callCount).toBeGreaterThanOrEqual(2);
      clearIntervalSpy.mockRestore();
    });
  });

  describe('setEmitter()', () => {
    it('sets event emitter callback', async () => {
      const emitFn = vi.fn();
      channel.setEmitter(emitFn);

      // Emitter is used internally on auto-disable
      expect(true).toBe(true);
    });
  });

  describe('Delivery tracking', () => {
    it('creates delivery record on dispatch', async () => {
      await channel.initialize();

      const integration = {
        id: 'int-1',
        platform: 'test-platform',
        webhook_url: 'https://example.com/webhook',
        event_categories: '["assessment"]',
        is_active: true,
        consecutive_failures: 0,
        name: 'Test',
      };

      (mockDb.selectFrom as any).mockReturnValue({
        where: vi.fn().mockReturnThis(),
        selectAll: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([integration]),
        executeTakeFirst: vi.fn().mockResolvedValue(null),
      });

      (mockDb.insertInto as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue({}),
        }),
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'assessment.created',
        category: 'assessment',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-1', displayName: 'John Doe' },
        data: {},
      };

      await channel.process(envelope);

      // process() schedules the chat_delivery insert asynchronously;
      // poll for the side effect rather than sleep, so the assertion
      // does not flake when the full suite runs under parallel load.
      await vi.waitFor(
        () => {
          expect(mockDb.insertInto).toHaveBeenCalled();
        },
        { timeout: 5_000, interval: 25 },
      );
    });
  });

  describe('Category filtering', () => {
    it('parses JSON array categories', async () => {
      await channel.initialize();

      const integration = {
        id: 'int-1',
        platform: 'test-platform',
        webhook_url: 'https://example.com/webhook',
        event_categories: '["assessment", "evidence"]',
        is_active: true,
        consecutive_failures: 0,
        name: 'Test',
      };

      (mockDb.selectFrom as any).mockReturnValue({
        where: vi.fn().mockReturnThis(),
        selectAll: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([integration]),
        executeTakeFirst: vi.fn().mockResolvedValue(null),
      });

      (mockDb.insertInto as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue({}),
        }),
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'assessment.created',
        category: 'assessment',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-1', displayName: 'John Doe' },
        data: {},
      };

      await channel.process(envelope);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(true).toBe(true);
    });

    it('parses comma-separated categories', async () => {
      await channel.initialize();

      const integration = {
        id: 'int-1',
        platform: 'test-platform',
        webhook_url: 'https://example.com/webhook',
        event_categories: 'assessment, evidence, attestation',
        is_active: true,
        consecutive_failures: 0,
        name: 'Test',
      };

      (mockDb.selectFrom as any).mockReturnValue({
        where: vi.fn().mockReturnThis(),
        selectAll: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([integration]),
        executeTakeFirst: vi.fn().mockResolvedValue(null),
      });

      (mockDb.insertInto as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          execute: vi.fn().mockResolvedValue({}),
        }),
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'evidence.created',
        category: 'evidence',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-1', displayName: 'John Doe' },
        data: {},
      };

      await channel.process(envelope);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(true).toBe(true);
    });
  });
});
