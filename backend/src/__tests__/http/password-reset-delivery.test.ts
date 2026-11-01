/**
 * Password reset delivery: the forgot-password request emails a link,
 * the link's token resets the password, and outside development the
 * token is never logged.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import supertest from 'supertest';
import { setupHttpTests, createPersona, getBaseUrl } from '../helpers/http.js';
import type { EmailTemplate } from '../../events/channels/email-templates.js';

type Sent = { to: string; template: EmailTemplate };

async function mailerSeam() {
  return import('../../services/password-reset-mail.js');
}

function tokenFrom(sent: Sent): string {
  const match = /\/reset-password#token=([A-Za-z0-9_%-]+)/.exec(sent.template.text);
  if (!match) throw new Error('no reset link in email');
  return decodeURIComponent(match[1]!);
}

describe('Password reset delivery', () => {
  setupHttpTests();

  afterEach(async () => {
    (await mailerSeam()).setResetMailerForTests(undefined);
  });

  it('emails a working reset link to the account owner', async () => {
    const sent: Sent[] = [];
    (await mailerSeam()).setResetMailerForTests({ send: async (to, template) => { sent.push({ to, template }); } });
    const p = await createPersona('assessee', 'mailreset');
    const email = `${p.username}@test.local`;

    const req = await supertest(getBaseUrl()).post('/api/v1/auth/forgot-password').send({ email });
    expect(req.status).toBe(200);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.to).toBe(email);
    expect(sent[0]!.template.html).toContain('/reset-password#token=');

    const newPassword = 'Mail-Reset-Passw0rd!';
    const reset = await supertest(getBaseUrl()).post('/api/v1/auth/reset-password').send({ token: tokenFrom(sent[0]!), newPassword });
    expect(reset.status).toBe(200);
    const login = await supertest(getBaseUrl()).post('/api/v1/auth/login').send({ username: p.username, password: newPassword });
    expect(login.status).toBe(200);
  });

  it('sends nothing for an unknown address and answers the same way', async () => {
    const send = vi.fn(async () => {});
    (await mailerSeam()).setResetMailerForTests({ send });
    const res = await supertest(getBaseUrl()).post('/api/v1/auth/forgot-password').send({ email: 'nobody-here@test.local' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If an account exists/);
    await new Promise((r) => setTimeout(r, 50));
    expect(send).not.toHaveBeenCalled();
  });
});

describe('deliverPasswordReset without SMTP', () => {
  const original = process.env.NODE_ENV;

  afterEach(async () => {
    process.env.NODE_ENV = original;
    (await import('../../config/index.js')).resetConfig();
    (await mailerSeam()).setResetMailerForTests(undefined);
  });

  it('never logs the token in production', async () => {
    const { logger } = await import('../../utils/logger.js');
    const info = vi.spyOn(logger, 'info');
    const warn = vi.spyOn(logger, 'warn');
    process.env.NODE_ENV = 'production';
    (await import('../../config/index.js')).resetConfig();
    const { deliverPasswordReset, setResetMailerForTests } = await mailerSeam();
    setResetMailerForTests(null);
    const token = 'secret-token-value-that-must-not-appear';
    const outcome = await deliverPasswordReset({ id: 'u1', email: 'a@test.local' }, token, new Date(Date.now() + 60_000));
    expect(outcome).toBe('unavailable');
    const logged = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(logged).not.toContain(token);
    info.mockRestore();
    warn.mockRestore();
  });
});
