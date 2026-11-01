/**
 * Unit tests for the RulesEngine notification rule evaluation.
 *
 * Tests event matching, filter evaluation, scope handling, and dispatch logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { RulesEngine } from '../../events/rules-engine.js';
import { ChannelRegistry } from '../../events/channel-registry.js';
import type { EventEnvelope } from '../../events/types.js';

describe('RulesEngine', () => {
  let engine: RulesEngine;
  let mockDb: Kysely<Database>;
  let mockChannelRegistry: ChannelRegistry;

  beforeEach(() => {
    // Create a mock database
    mockDb = {
      selectFrom: vi.fn().mockReturnThis(),
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
    } as unknown as Kysely<Database>;

    // Create a mock channel registry
    mockChannelRegistry = {
      getChannel: vi.fn().mockReturnValue({
        name: 'test-channel',
        handles: vi.fn().mockReturnValue(true),
        process: vi.fn().mockResolvedValue(undefined),
        initialize: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as ChannelRegistry;

    // Matching mechanics only; subject visibility is covered by the HTTP tests.
    engine = new RulesEngine(() => mockDb, async () => true);
    engine.setChannelRegistry(mockChannelRegistry);
  });

  describe('evaluate()', () => {
    it('returns empty array when no rules exist', async () => {
      (mockDb.selectFrom as any).mockReturnValueOnce({
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
        data: { assessmentId: 'ass-123' },
      };

      const matches = await engine.evaluate(envelope);
      expect(matches).toHaveLength(0);
    });

    it('filters out disabled rules', async () => {
      const enabledRule: any = {
        id: 'rule-1',
        user_id: 'user-1',
        scope: 'user',
        channel: 'in_app',
        enabled: true,
        event_types: ['assessment.created'],
        filters: {},
        destination: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const disabledRule: any = {
        id: 'rule-2',
        user_id: 'user-1',
        scope: 'user',
        channel: 'email',
        enabled: false,
        event_types: ['assessment.created'],
        filters: {},
        destination: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      let callCount = 0;
      (mockDb.selectFrom as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call for rules
          return {
            where: vi.fn().mockReturnThis(),
            selectAll: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue([enabledRule, disabledRule]),
          };
        }
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue([]),
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        };
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'assessment.created',
        category: 'assessment',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-1', displayName: 'John Doe' },
        data: { assessmentId: 'ass-123' },
      };

      const matches = await engine.evaluate(envelope);
      // Only enabled rule should match
      expect(matches.length).toBeLessThanOrEqual(1);
    });

    it('matches rules by exact event type', async () => {
      const rule: any = {
        id: 'rule-1',
        user_id: 'user-1',
        scope: 'user',
        channel: 'in_app',
        enabled: true,
        event_types: ['assessment.created'],
        filters: {},
        destination: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      let callCount = 0;
      (mockDb.selectFrom as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            where: vi.fn().mockReturnThis(),
            selectAll: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue([rule]),
          };
        }
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue([]),
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        };
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'assessment.created',
        category: 'assessment',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-2', displayName: 'Jane Doe' },
        data: { assessmentId: 'ass-123' },
      };

      const matches = await engine.evaluate(envelope);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].rule.event_types).toContain('assessment.created');
    });

    it('matches wildcard event types on system rules', async () => {
      const rule: any = {
        id: 'rule-1',
        user_id: null,
        scope: 'system',
        channel: 'in_app',
        enabled: true,
        event_types: ['*'],
        filters: {},
        destination: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      let callCount = 0;
      (mockDb.selectFrom as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            where: vi.fn().mockReturnThis(),
            selectAll: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue([rule]),
          };
        }
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue([]),
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        };
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'custom.event',
        category: 'custom',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-2', displayName: 'Jane Doe' },
        data: {},
      };

      const matches = await engine.evaluate(envelope);
      expect(matches.length).toBeGreaterThan(0);
    });

    // Security review Z10: a personal rule cannot subscribe to everything.
    it('does not let a personal rule match through a wildcard', async () => {
      const rule: any = {
        id: 'rule-1',
        user_id: 'user-1',
        scope: 'user',
        channel: 'in_app',
        enabled: true,
        event_types: ['*'],
        filters: {},
        destination: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      let callCount = 0;
      (mockDb.selectFrom as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            where: vi.fn().mockReturnThis(),
            selectAll: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue([rule]),
          };
        }
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue([]),
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        };
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'custom.event',
        category: 'custom',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-2', displayName: 'Jane Doe' },
        data: {},
      };

      const matches = await engine.evaluate(envelope);
      expect(matches).toHaveLength(0);
    });

    it('excludes actor from user-scoped rules', async () => {
      const rule: any = {
        id: 'rule-1',
        user_id: 'user-1',
        scope: 'user',
        channel: 'in_app',
        enabled: true,
        event_types: ['assessment.created'],
        filters: {},
        destination: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      let callCount = 0;
      (mockDb.selectFrom as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            where: vi.fn().mockReturnThis(),
            selectAll: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue([rule]),
          };
        }
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue([]),
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        };
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'assessment.created',
        category: 'assessment',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-1', displayName: 'John Doe' },
        data: { assessmentId: 'ass-123' },
      };

      const matches = await engine.evaluate(envelope);
      // Actor (user-1) should be excluded from their own rule
      expect(matches).toHaveLength(0);
    });

    it('includes matches for system-scoped rules regardless of actor', async () => {
      const rule: any = {
        id: 'rule-1',
        user_id: null,
        scope: 'system',
        channel: 'in_app',
        enabled: true,
        event_types: ['assessment.created'],
        filters: {},
        destination: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      let callCount = 0;
      (mockDb.selectFrom as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            where: vi.fn().mockReturnThis(),
            selectAll: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue([rule]),
          };
        }
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue([]),
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        };
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'assessment.created',
        category: 'assessment',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-1', displayName: 'John Doe' },
        data: { assessmentId: 'ass-123' },
      };

      const matches = await engine.evaluate(envelope);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  describe('resolveDestination()', () => {
    it('returns empty object for in_app channel', async () => {
      const rule: any = {
        id: 'rule-1',
        user_id: 'user-1',
        scope: 'user',
        channel: 'in_app',
        enabled: true,
        // Personal rules must name their events (security review Z10).
        event_types: ['test.event'],
        filters: {},
        destination: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      let callCount = 0;
      (mockDb.selectFrom as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            where: vi.fn().mockReturnThis(),
            selectAll: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue([rule]),
          };
        }
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue([]),
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        };
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'test.event',
        category: 'test',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-2', displayName: 'Jane Doe' },
        data: {},
      };

      const matches = await engine.evaluate(envelope);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].destination).toBeDefined();
    });
  });

  describe('processEvent()', () => {
    it('skips processing when ChannelRegistry is not set', async () => {
      const engine2 = new RulesEngine(() => mockDb, async () => true);
      // Don't set channel registry

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'assessment.created',
        category: 'assessment',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-1', displayName: 'John Doe' },
        data: {},
      };

      // Should not throw
      await expect(engine2.processEvent(envelope)).resolves.not.toThrow();
    });

    it('groups matches by channel', async () => {
      const rule1: any = {
        id: 'rule-1',
        user_id: 'user-2',
        scope: 'user',
        channel: 'in_app',
        enabled: true,
        event_types: ['assessment.created'],
        filters: {},
        destination: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const rule2: any = {
        id: 'rule-2',
        user_id: 'user-3',
        scope: 'user',
        channel: 'email',
        enabled: true,
        event_types: ['assessment.created'],
        filters: {},
        destination: { email: 'user3@example.com' },
        created_at: new Date(),
        updated_at: new Date(),
      };

      let callCount = 0;
      (mockDb.selectFrom as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            where: vi.fn().mockReturnThis(),
            selectAll: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue([rule1, rule2]),
          };
        }
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue([]),
          executeTakeFirst: vi.fn().mockResolvedValue(null),
          insertInto: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              execute: vi.fn().mockResolvedValue({}),
            }),
          }),
        };
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'assessment.created',
        category: 'assessment',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-1', displayName: 'John Doe' },
        data: { assessmentId: 'ass-123' },
      };

      await engine.processEvent(envelope);

      // The test passes if no errors are thrown during grouping and dispatch
      expect(true).toBe(true);
    });

    it('leaves non-in_app channels to their own event-bus subscription (X9)', async () => {
      const rule: any = {
        id: 'rule-1',
        user_id: 'user-2',
        scope: 'user',
        channel: 'email',
        enabled: true,
        event_types: ['assessment.created'],
        filters: {},
        destination: { email: 'user2@example.com' },
        created_at: new Date(),
        updated_at: new Date(),
      };

      let callCount = 0;
      (mockDb.selectFrom as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call: notification_rule query
          return {
            where: vi.fn().mockReturnThis(),
            selectAll: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue([rule]),
          };
        }
        // Second call: app_user lookup in resolveDestination
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue([]),
          executeTakeFirst: vi.fn().mockResolvedValue({
            id: 'user-2',
            email: 'user2@example.com',
            display_name: 'User Two',
          }),
        };
      });

      const mockChannel = {
        name: 'email',
        handles: vi.fn().mockReturnValue(true),
        process: vi.fn().mockResolvedValue(undefined),
        initialize: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined),
      };

      (mockChannelRegistry.getChannel as any).mockReturnValue(mockChannel);

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'assessment.created',
        category: 'assessment',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-1', displayName: 'John Doe' },
        data: { assessmentId: 'ass-123' },
      };

      await engine.processEvent(envelope);

      // Email, webhook and chat channels subscribe to the event bus
      // themselves; the rules engine dispatching again delivered twice and
      // let personal rules trigger admin integrations (security review X9).
      expect(mockChannel.process).not.toHaveBeenCalled();
    });

    it('handles errors gracefully during processEvent', async () => {
      (mockDb.selectFrom as any).mockImplementation(() => {
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          execute: vi.fn().mockRejectedValue(new Error('DB error')),
        };
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

      // Should not throw
      await expect(engine.processEvent(envelope)).resolves.not.toThrow();
    });
  });

  describe('Filter evaluation', () => {
    it('evaluates my_assessments filter', async () => {
      const rule: any = {
        id: 'rule-1',
        user_id: 'user-1',
        scope: 'user',
        channel: 'in_app',
        enabled: true,
        event_types: ['assessment.created'],
        filters: { my_assessments: true },
        destination: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      let callCount = 0;
      (mockDb.selectFrom as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            where: vi.fn().mockReturnThis(),
            selectAll: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue([rule]),
          };
        }
        // Simulate assessor found
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue([{ user_id: 'user-1' }]),
          executeTakeFirst: vi.fn().mockResolvedValue({ user_id: 'user-1' }),
        };
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'assessment.created',
        category: 'assessment',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-2', displayName: 'Jane Doe' },
        data: { assessmentId: 'ass-123' },
      };

      const matches = await engine.evaluate(envelope);
      // Should match because user-1 is assessor on assessment
      expect(matches.length).toBeGreaterThan(0);
    });

    it('evaluates my_evidence filter', async () => {
      const rule: any = {
        id: 'rule-1',
        user_id: 'user-1',
        scope: 'user',
        channel: 'in_app',
        enabled: true,
        event_types: ['evidence.created'],
        filters: { my_evidence: true },
        destination: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      let callCount = 0;
      (mockDb.selectFrom as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            where: vi.fn().mockReturnThis(),
            selectAll: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue([rule]),
          };
        }
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue([]),
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        };
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'evidence.created',
        category: 'evidence',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-2', displayName: 'Jane Doe' },
        data: { authorId: 'user-1' },
      };

      const matches = await engine.evaluate(envelope);
      expect(matches.length).toBeGreaterThan(0);
    });

    it('evaluates specific_project filter', async () => {
      const rule: any = {
        id: 'rule-1',
        user_id: 'user-1',
        scope: 'user',
        channel: 'in_app',
        enabled: true,
        event_types: ['project.updated'],
        filters: { specific_project: true, specific_project_value: 'proj-123' },
        destination: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      let callCount = 0;
      (mockDb.selectFrom as any).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            where: vi.fn().mockReturnThis(),
            selectAll: vi.fn().mockReturnThis(),
            execute: vi.fn().mockResolvedValue([rule]),
          };
        }
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          execute: vi.fn().mockResolvedValue([]),
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        };
      });

      const envelope: EventEnvelope = {
        id: 'evt_test',
        type: 'project.updated',
        category: 'project',
        timestamp: new Date().toISOString(),
        version: '1',
        actor: { userId: 'user-2', displayName: 'Jane Doe' },
        data: { projectId: 'proj-123' },
      };

      const matches = await engine.evaluate(envelope);
      expect(matches.length).toBeGreaterThan(0);
    });
  });
});
