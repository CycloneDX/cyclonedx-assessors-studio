/**
 * Integration tests for the admin storage endpoints.
 */
import { describe, it, expect } from 'vitest';
import { setupHttpTests, loginAs } from '../helpers/http.js';

describe('Admin Storage Endpoints (HTTP integration)', () => {
  setupHttpTests();

  describe('POST /api/v1/admin/integrations/test/storage', () => {
    it('should verify database connectivity for admin users', async () => {
      const agent = await loginAs('admin');
      const res = await agent.post('/api/v1/admin/integrations/test/storage');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.provider).toBe('database');
      expect(res.body.message).toContain('verified');
    });

    it('should reject non-admin users', async () => {
      const agent = await loginAs('assessee');
      const res = await agent.post('/api/v1/admin/integrations/test/storage');

      expect(res.status).toBe(403);
    });
  });
});
