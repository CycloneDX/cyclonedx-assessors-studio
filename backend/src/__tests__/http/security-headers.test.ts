/**
 * Security regression tests: response headers (security review W4, W10).
 * These run with NODE_ENV=test, which used to mean no CSP at all.
 */
import { describe, it, expect } from 'vitest';
import { setupHttpTests, getAgent } from '../helpers/http.js';

describe('Security headers (security review)', () => {
  setupHttpTests();

  it('sends a CSP even when NODE_ENV is not production (W4)', async () => {
    const res = await getAgent().get('/api/health');
    const csp = res.headers['content-security-policy'] as string | undefined;
    expect(csp).toBeDefined();
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('allows no remote image sources (W10)', async () => {
    const res = await getAgent().get('/api/health');
    const imgSrc = (res.headers['content-security-policy'] as string).split(';').find((d) => d.trim().startsWith('img-src')) ?? '';
    expect(imgSrc).not.toMatch(/https:|\*/);
  });

  it('does not opt into HSTS subdomains or preload by default (W10)', async () => {
    const res = await getAgent().get('/api/health');
    const hsts = res.headers['strict-transport-security'] as string;
    expect(hsts).toContain('max-age=31536000');
    expect(hsts).not.toContain('includeSubDomains');
    expect(hsts).not.toContain('preload');
  });
});
