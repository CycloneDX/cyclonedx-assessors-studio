import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spaFallback } from '../../app.js';

describe('spaFallback', () => {
  let dir: string;
  let app: express.Express;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>shell</title>');
    app = express();
    app.use(spaFallback(dir));
    app.use((_req, res) => { res.status(404).end(); });
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('serves the shell for GET on a client route', async () => {
    const res = await supertest(app).get('/assessments/123');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>shell</title>');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('answers HEAD like GET, so monitors probing with HEAD see 200', async () => {
    const res = await supertest(app).head('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('never serves the shell for API paths or other methods', async () => {
    expect((await supertest(app).get('/api/v1/nope')).status).toBe(404);
    expect((await supertest(app).head('/metrics')).status).toBe(404);
    expect((await supertest(app).post('/')).status).toBe(404);
  });
});
