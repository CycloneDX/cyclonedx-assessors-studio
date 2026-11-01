/**
 * HTTP integration tests for admin integrations endpoints.
 */

import { describe, it, expect } from 'vitest';
import { setupHttpTests, loginAs } from '../helpers/http.js';

describe('Admin Integrations HTTP Routes', () => {
  setupHttpTests();

  // -----------------------------------------------------------------------
  // GET /api/v1/admin/integrations/status
  // -----------------------------------------------------------------------

  describe('GET /api/v1/admin/integrations/status', () => {
    it('should return full integration status for admin', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/admin/integrations/status');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('storage');
      expect(res.body).toHaveProperty('smtp');
      expect(res.body).toHaveProperty('webhook');

      // Storage should have provider and maxFileSize
      expect(res.body.storage).toHaveProperty('provider');
      expect(res.body.storage).toHaveProperty('maxFileSize');

      // SMTP should have enabled flag and config fields
      expect(res.body.smtp).toHaveProperty('enabled');
      expect(res.body.smtp).toHaveProperty('port');
      expect(res.body.smtp).toHaveProperty('userConfigured');
      expect(res.body.smtp).toHaveProperty('passConfigured');

      // Webhook should have enabled flag
      expect(res.body.webhook).toHaveProperty('enabled');
    });

    it('should reject non-admin users', async () => {
      const agent = await loginAs('assessor');
      const res = await agent.get('/api/v1/admin/integrations/status');
      expect(res.status).toBe(403);
    });

    it('should never expose SMTP or S3 secrets', async () => {
      const agent = await loginAs('admin');
      const res = await agent.get('/api/v1/admin/integrations/status');

      expect(res.status).toBe(200);
      expect(typeof res.body.smtp.passConfigured).toBe('boolean');
      expect(res.body.smtp).not.toHaveProperty('pass');
      expect(res.body.smtp).not.toHaveProperty('password');
      expect(JSON.stringify(res.body)).not.toMatch(/secret/i);
    });

    it('should reject unauthenticated requests', async () => {
      const { default: supertest } = await import('supertest');
      const { getBaseUrl } = await import('../helpers/http.js');
      const res = await supertest(getBaseUrl()).get('/api/v1/admin/integrations/status');
      expect(res.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/v1/admin/integrations/test/smtp
  // -----------------------------------------------------------------------

  describe('POST /api/v1/admin/integrations/test/smtp', () => {
    it('should return 400 when SMTP is not enabled', async () => {
      const agent = await loginAs('admin');
      const res = await agent.post('/api/v1/admin/integrations/test/smtp');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('not enabled');
    });

    it('should reject non-admin users', async () => {
      const agent = await loginAs('assessor');
      const res = await agent.post('/api/v1/admin/integrations/test/smtp');
      expect(res.status).toBe(403);
    });
  });
});
