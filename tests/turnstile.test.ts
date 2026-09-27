/**
 * F-05 (G1-26) — Cloudflare Turnstile CAPTCHA testleri.
 *
 * İki katman:
 *  1. Saf middleware testleri (`requireTurnstile` doğrudan sahte req/res ile) — Cloudflare
 *     `siteverify` çağrısı `global.fetch` mock'lanarak taklit edilir. DB gerektirmez.
 *  2. Uç-noktalarına kablolama testleri (`createTestApp`) — dört public ucun (register,
 *     self-serve/register, forgot-password, suspicion-reports) gerçekten middleware'i
 *     kullandığını ve anahtar yokken davranışın DEĞİŞMEDİĞİNİ doğrular.
 *
 * `TURNSTILE_SECRET_KEY` çağrı-zamanında okunur (config.ts `getTurnstileSecretKey`) — her
 * testte `process.env` üzerinden set/temizlenir (rateLimiter eşik testleriyle aynı desen).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { requireTurnstile, CAPTCHA_MESSAGES } from '../src/middleware/turnstile.js';
import { getTurnstileSecretKey } from '../src/config.js';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant } from './helpers/factories.js';

const ORIGINAL_SECRET = process.env['TURNSTILE_SECRET_KEY'];

function setSecret(value: string | undefined): void {
  if (value === undefined) delete process.env['TURNSTILE_SECRET_KEY'];
  else process.env['TURNSTILE_SECRET_KEY'] = value;
}

function fakeRes() {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = vi.fn((payload: unknown) => {
    res.body = payload;
    return res as Response;
  });
  return res as Response & { statusCode?: number; body?: unknown };
}

function fakeReq(body: unknown): Request {
  return {
    body,
    ip: '203.0.113.9',
    socket: { remoteAddress: '203.0.113.9' },
  } as unknown as Request;
}

describe('F-05: getTurnstileSecretKey', () => {
  it('boş/tanımsız değer boş string döner (no-op tetikleyicisi)', () => {
    expect(getTurnstileSecretKey(undefined)).toBe('');
    expect(getTurnstileSecretKey('')).toBe('');
    expect(getTurnstileSecretKey('   ')).toBe('');
  });

  it('baş/son boşluğu kırpar', () => {
    expect(getTurnstileSecretKey('  gizli-anahtar  ')).toBe('gizli-anahtar');
  });
});

describe('F-05: requireTurnstile — saf middleware davranışı', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    setSecret(ORIGINAL_SECRET);
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('anahtar TANIMSIZSA no-op: next() çağrılır, fetch hiç çağrılmaz', async () => {
    setSecret(undefined);
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const next = vi.fn() as unknown as NextFunction;
    const res = fakeRes();

    await requireTurnstile(fakeReq({}), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('negatif: anahtar VARKEN token yoksa 400 CAPTCHA_GEREKLI, next() çağrılmaz', async () => {
    setSecret('test-secret');
    const next = vi.fn() as unknown as NextFunction;
    const res = fakeRes();

    await requireTurnstile(fakeReq({}), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual({ error: 'CAPTCHA_GEREKLI', message: CAPTCHA_MESSAGES.MISSING });
  });

  it('negatif: token boş string ise (yalnız boşluk) 400 CAPTCHA_GEREKLI', async () => {
    setSecret('test-secret');
    const next = vi.fn() as unknown as NextFunction;
    const res = fakeRes();

    await requireTurnstile(fakeReq({ captchaToken: '   ' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ error: 'CAPTCHA_GEREKLI' });
  });

  it('negatif: Cloudflare success:false dönerse 400 CAPTCHA_GECERSIZ', async () => {
    setSecret('test-secret');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    }) as unknown as typeof fetch;
    const next = vi.fn() as unknown as NextFunction;
    const res = fakeRes();

    await requireTurnstile(fakeReq({ captchaToken: 'kotu-token' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual({ error: 'CAPTCHA_GECERSIZ', message: CAPTCHA_MESSAGES.INVALID });
  });

  it('pozitif: Cloudflare success:true dönerse next() çağrılır, response set edilmez', async () => {
    setSecret('test-secret');
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    const next = vi.fn() as unknown as NextFunction;
    const res = fakeRes();

    await requireTurnstile(fakeReq({ captchaToken: 'iyi-token' }), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    // secret Cloudflare'e POST gövdesinde gider (loglanmaz) — burada yalnız çağrının
    // yapıldığını doğruluyoruz, secret'ı test çıktısına BASMIYORUZ.
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain('response=iyi-token');
  });

  it('negatif: ağ hatası/zaman aşımında FAIL-CLOSED → 400 CAPTCHA_DOGRULANAMADI (503 DEĞİL)', async () => {
    setSecret('test-secret');
    global.fetch = vi.fn().mockRejectedValue(new Error('network gitti — bu asla loglanmamalı')) as unknown as typeof fetch;
    const next = vi.fn() as unknown as NextFunction;
    const res = fakeRes();

    await requireTurnstile(fakeReq({ captchaToken: 'her-hangi-token' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.status).not.toHaveBeenCalledWith(503);
    expect(res.body).toEqual({ error: 'CAPTCHA_DOGRULANAMADI', message: CAPTCHA_MESSAGES.UNAVAILABLE });
  });

  it('negatif: secret hiçbir zaman yanıt gövdesine sızmaz', async () => {
    setSecret('cok-gizli-secret-deger');
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }) as unknown as typeof fetch;
    const next = vi.fn() as unknown as NextFunction;
    const res = fakeRes();

    await requireTurnstile(fakeReq({ captchaToken: 'x' }), res, next);

    expect(JSON.stringify(res.body)).not.toContain('cok-gizli-secret-deger');
  });
});

describe('F-05: public uçlar — anahtar YOKKEN regresyon (bugünkü davranış aynen)', () => {
  let http: TestAgent;

  beforeEach(async () => {
    setSecret(undefined);
    await cleanDb();
    http = agent();
  });

  afterEach(() => {
    setSecret(ORIGINAL_SECRET);
  });

  it('POST /api/suspicion-reports — captchaToken olmadan da 201 (no-op)', async () => {
    const res = await http.post('/api/suspicion-reports').send({
      tenantName: 'Şüpheli Kurum',
      reporterName: 'Test Kullanıcı',
      reporterRole: 'Yönetici',
      contact: 'test@example.com',
      description: 'Şüpheli bir davet aldım, kontrol edin lütfen.',
    });
    expect(res.status).toBe(201);
  });

  it('POST /api/auth/forgot-password — captchaToken olmadan da 200 (no-op)', async () => {
    const res = await http.post('/api/auth/forgot-password').send({ email: 'yok@example.com' });
    expect(res.status).toBe(200);
  });
});

describe('F-05: public uçlar — anahtar VARKEN (Cloudflare fetch mock)', () => {
  let http: TestAgent;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    setSecret('test-secret');
    await cleanDb();
    http = agent();
  });

  afterEach(() => {
    setSecret(ORIGINAL_SECRET);
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('negatif: POST /api/suspicion-reports token yoksa 400, kayıt OLUŞMAZ', async () => {
    const before = await testPrisma.suspicionReport.count();

    const res = await http.post('/api/suspicion-reports').send({
      tenantName: 'Şüpheli Kurum',
      reporterName: 'Test Kullanıcı',
      reporterRole: 'Yönetici',
      contact: 'test@example.com',
      description: 'Şüpheli bir davet aldım, kontrol edin lütfen.',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CAPTCHA_GEREKLI');
    expect(await testPrisma.suspicionReport.count()).toBe(before);
  });

  it('negatif: geçersiz captchaToken → 400 CAPTCHA_GECERSIZ, kayıt OLUŞMAZ', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }) as unknown as typeof fetch;
    const before = await testPrisma.suspicionReport.count();

    const res = await http.post('/api/suspicion-reports').send({
      tenantName: 'Şüpheli Kurum',
      reporterName: 'Test Kullanıcı',
      reporterRole: 'Yönetici',
      contact: 'test@example.com',
      description: 'Şüpheli bir davet aldım, kontrol edin lütfen.',
      captchaToken: 'kotu-token',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CAPTCHA_GECERSIZ');
    expect(await testPrisma.suspicionReport.count()).toBe(before);
  });

  it('pozitif: geçerli captchaToken → 201, kayıt oluşur', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }) as unknown as typeof fetch;

    const res = await http.post('/api/suspicion-reports').send({
      tenantName: 'Şüpheli Kurum',
      reporterName: 'Test Kullanıcı',
      reporterRole: 'Yönetici',
      contact: 'test@example.com',
      description: 'Şüpheli bir davet aldım, kontrol edin lütfen.',
      captchaToken: 'iyi-token',
    });

    expect(res.status).toBe(201);
    expect(await testPrisma.suspicionReport.count()).toBe(1);
  });

  it('negatif: POST /api/auth/register token yoksa 400, kullanıcı OLUŞMAZ', async () => {
    const tenant = await createTenant();
    const before = await testPrisma.user.count();

    const res = await http.post('/api/auth/register').send({
      email: 'aday@example.com',
      password: 'Test1234!',
      fullName: 'Aday Kullanıcı',
      role: 'MENTI',
      tenantSlug: tenant.slug,
      kvkkConsent: true,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CAPTCHA_GEREKLI');
    expect(await testPrisma.user.count()).toBe(before);
  });

  it('pozitif: POST /api/auth/register geçerli token ile 201, kullanıcı oluşur', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }) as unknown as typeof fetch;
    const tenant = await createTenant();

    const res = await http.post('/api/auth/register').send({
      email: 'aday2@example.com',
      password: 'Test1234!',
      fullName: 'Aday Kullanıcı',
      role: 'MENTI',
      tenantSlug: tenant.slug,
      kvkkConsent: true,
      captchaToken: 'iyi-token',
    });

    expect(res.status).toBe(201);
    const created = await testPrisma.user.findUnique({ where: { email: 'aday2@example.com' } });
    expect(created).not.toBeNull();
  });

  it('negatif: POST /api/tenants/self-serve/register token yoksa 400, tenant OLUŞMAZ', async () => {
    const before = await testPrisma.tenant.count();

    const res = await http.post('/api/tenants/self-serve/register').send({
      email: 'kurucu@example.com',
      password: 'Test1234!',
      name: 'Kurucu Kullanıcı',
      tenantName: 'Yeni Kurum',
      slug: `yeni-kurum-${Date.now()}`,
      programTemplate: 'OZEL',
      kvkkConsent: true,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CAPTCHA_GEREKLI');
    expect(await testPrisma.tenant.count()).toBe(before);
  });

  it('pozitif: POST /api/tenants/self-serve/register geçerli token ile 201, tenant oluşur', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }) as unknown as typeof fetch;

    const res = await http.post('/api/tenants/self-serve/register').send({
      email: 'kurucu2@example.com',
      password: 'Test1234!',
      name: 'Kurucu Kullanıcı',
      tenantName: 'Yeni Kurum',
      slug: `yeni-kurum-${Date.now()}`,
      programTemplate: 'OZEL',
      kvkkConsent: true,
      captchaToken: 'iyi-token',
    });

    expect(res.status).toBe(201);
  });

  it('negatif: POST /api/auth/forgot-password token yoksa 400 CAPTCHA_GEREKLI', async () => {
    const res = await http.post('/api/auth/forgot-password').send({ email: 'yok@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CAPTCHA_GEREKLI');
  });

  it('pozitif: POST /api/auth/forgot-password geçerli token ile 200 (generic mesaj)', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }) as unknown as typeof fetch;
    const res = await http.post('/api/auth/forgot-password').send({ email: 'yok@example.com', captchaToken: 'iyi-token' });
    expect(res.status).toBe(200);
  });
});
