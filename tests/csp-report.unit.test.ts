/**
 * AJ-52 — POST /api/csp-reports: tarayıcının CSP ihlal raporu — birim testi (DB gerektirmez).
 *
 * Kapsam: geçerli rapor (iki biçim) → 204 + tek günlük satırı, sorgu dizgisi/parça KIRPILMIŞ;
 * aşırı büyük gövde / yanlış içerik tipi / bozuk JSON / tanınmayan yönerge → 204 ama YAZILMAZ;
 * IP-bazlı oran sınırı aşılınca 429; kimlik başlığı gerekmez; uç server.ts'te genel `/api` sınırının
 * arkasında bağlı. Günlük (`logger`) sahte — SystemLog'a inmez.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import express from 'express';
import supertest from 'supertest';

const warn = vi.fn();
vi.mock('../src/services/logger.js', () => ({
  logger: { warn: (...args: unknown[]) => warn(...args), info: vi.fn(), error: vi.fn() },
}));

// Gerçek bağlama: uç, server.ts'te `/api` altına bağlı onboardingRoutes içinden sunulur.
const { default: onboardingRoutes } = await import('../src/routes/onboardingRoutes.js');
const {
  CSP_UNKNOWN_VALUE,
  CSP_REPORT_MAX_PER_REQUEST,
  extractCspViolations,
  sanitizeBlockedUri,
  sanitizeDocumentUri,
} = await import('../src/services/cspReport.js');

/** server.ts ile aynı sıra: genel JSON ayrıştırıcı (1 MB) → `app.use('/api', onboardingRoutes)`. */
function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', onboardingRoutes);
  return app;
}

const SECRET = 'gizli-sifirlama-degeri-123';

function legacyReport(overrides: Record<string, unknown> = {}) {
  return {
    'csp-report': {
      'document-uri': `https://app.example.org/reset-password?token=${SECRET}#bolum`,
      'violated-directive': "img-src 'self' https:",
      'effective-directive': 'img-src',
      'blocked-uri': `https://cdn.example.net/logo.png?sig=${SECRET}#x`,
      'original-policy': "default-src 'self'",
      disposition: 'enforce',
      'script-sample': 'ornek-kod',
      ...overrides,
    },
  };
}

function post(body: string, contentType: string) {
  return supertest(buildApp()).post('/api/csp-reports').set('Content-Type', contentType).send(body);
}

beforeEach(() => {
  warn.mockReset();
});

afterEach(() => {
  delete process.env['CSP_REPORT_RATE_RPM'];
});

describe('AJ-52 POST /api/csp-reports — kabul ve kırpma', () => {
  it('eski biçim (application/csp-report): 204 + tek günlük satırı; sorgu dizgisi ve parça KIRPILMIŞ', async () => {
    const res = await post(JSON.stringify(legacyReport()), 'application/csp-report');
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    const [category, message, meta] = warn.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(category).toBe('CSP');
    expect(message).toBe('CSP ihlali: img-src');
    expect(meta).toEqual({
      directive: 'img-src',
      documentPath: '/reset-password',
      blocked: 'https://cdn.example.net/logo.png',
      disposition: 'enforce',
    });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain('#');
    expect(logged).not.toContain('ornek-kod');
    expect(logged).not.toContain('default-src');
  });

  it('Reporting API biçimi (application/reports+json): csp-violation yazılır, diğer tür yok sayılır, kırpılır', async () => {
    const body = [
      {
        type: 'csp-violation',
        url: `https://app.example.org/profile?email=${SECRET}`,
        user_agent: 'Tarayici/1.0',
        body: {
          documentURL: `https://app.example.org/profile?email=${SECRET}`,
          effectiveDirective: 'script-src-elem',
          blockedURL: 'inline',
          disposition: 'enforce',
          sample: 'alert(1)',
        },
      },
      { type: 'deprecation', body: { id: 'x' } },
    ];
    const res = await post(JSON.stringify(body), 'application/reports+json');
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[2]).toEqual({
      directive: 'script-src-elem',
      documentPath: '/profile',
      blocked: 'inline',
      disposition: 'enforce',
    });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain('Tarayici');
    expect(logged).not.toContain('alert(1)');
  });

  it('kimlik başlığı gerekmez: Authorization / çerez / X-Tenant-Id olmadan 204 ve yazılır', async () => {
    const res = await supertest(buildApp())
      .post('/api/csp-reports')
      .set('Content-Type', 'application/csp-report')
      .send(JSON.stringify(legacyReport()));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('AJ-52 POST /api/csp-reports — negatif: yazılmayanlar (hepsi 204, bilgi sızmaz)', () => {
  it('aşırı büyük gövde (> 8 KB) → 204, YAZILMAZ', async () => {
    const big = JSON.stringify(legacyReport({ 'original-policy': 'a'.repeat(9 * 1024) }));
    const res = await post(big, 'application/csp-report');
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(warn).not.toHaveBeenCalled();
  });

  it('yanlış içerik tipi (application/json) → 204, YAZILMAZ', async () => {
    const res = await post(JSON.stringify(legacyReport()), 'application/json');
    expect(res.status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it('yanlış içerik tipi (text/plain) → 204, YAZILMAZ', async () => {
    const res = await post(JSON.stringify(legacyReport()), 'text/plain');
    expect(res.status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it('bozuk JSON → 204 (genel hata gövdesi dönmez), YAZILMAZ', async () => {
    const res = await post('{"csp-report": {', 'application/csp-report');
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(warn).not.toHaveBeenCalled();
  });

  it('tanınmayan yönerge → 204, YAZILMAZ', async () => {
    const res = await post(
      JSON.stringify(legacyReport({ 'effective-directive': '<script>', 'violated-directive': undefined })),
      'application/csp-report',
    );
    expect(res.status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it('yönergeye satır sonuyla sahte günlük enjeksiyonu → yalnız ilk sözcük yazılır', async () => {
    const res = await post(
      JSON.stringify(legacyReport({ 'effective-directive': 'img-src\n[ERROR] sahte satir' })),
      'application/csp-report',
    );
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sahte satir');
  });

  it(`Reporting API toplu gönderimde en fazla ${CSP_REPORT_MAX_PER_REQUEST} rapor yazılır`, async () => {
    const one = { type: 'csp-violation', body: { documentURL: 'https://app.example.org/a', effectiveDirective: 'img-src', blockedURL: 'data' } };
    const res = await post(JSON.stringify(Array.from({ length: 20 }, () => one)), 'application/reports+json');
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(CSP_REPORT_MAX_PER_REQUEST);
  });
});

describe('AJ-52 POST /api/csp-reports — IP-bazlı oran sınırı', () => {
  it('eşik aşılınca 429 ve aşan rapor YAZILMAZ', async () => {
    process.env['CSP_REPORT_RATE_RPM'] = '3';
    const app = buildApp();
    const send = () =>
      supertest(app).post('/api/csp-reports').set('Content-Type', 'application/csp-report').send(JSON.stringify(legacyReport()));
    for (let i = 0; i < 3; i++) expect((await send()).status).toBe(204);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('RATE_LIMIT');
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe('AJ-52 — alan daraltma (saf)', () => {
  it('belge adresi: yalnız yol; davet token yol parçası maskelenir; geçersiz adres işaretlenir', () => {
    expect(sanitizeDocumentUri('https://app.example.org/a/b?x=1#y')).toBe('/a/b');
    expect(sanitizeDocumentUri('https://app.example.org/invitations/abc.def.ghi/join')).toBe('/invitations/[gizli]/join');
    expect(sanitizeDocumentUri('yol-degil')).toBe(CSP_UNKNOWN_VALUE);
    expect(sanitizeDocumentUri(undefined)).toBe(CSP_UNKNOWN_VALUE);
  });

  it('engellenen adres: anahtar sözcük aynen; data:/blob: yalnız şema; kimlik bilgisi ve sorgu atılır', () => {
    expect(sanitizeBlockedUri('eval')).toBe('eval');
    expect(sanitizeBlockedUri('data:image/png;base64,AAAA')).toBe('data');
    expect(sanitizeBlockedUri('https://kullanici:parola@cdn.example.net/x.js?k=v')).toBe('https://cdn.example.net/x.js');
    expect(sanitizeBlockedUri('javascript:alert(1)')).toBe('javascript');
    expect(sanitizeBlockedUri('%%%')).toBe(CSP_UNKNOWN_VALUE);
  });

  it('tanınmayan gövde boş liste döner, fırlatmaz', () => {
    expect(extractCspViolations(null)).toEqual([]);
    expect(extractCspViolations('metin')).toEqual([]);
    expect(extractCspViolations({ baska: 1 })).toEqual([]);
  });
});

describe('AJ-52 — bağlantı (server.ts DEĞİŞMEDİ; uç onboardingRoutes içinden)', () => {
  it('server.ts: onboardingRoutes `/api` altına, genel /api oran sınırından SONRA bağlı; önündeki önekler /api/csp-reports ile çakışmaz', () => {
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    const general = server.indexOf("app.use('/api', generalRateLimiter)");
    const mount = server.indexOf("app.use('/api', onboardingRoutes)");
    expect(general).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(general);
    const earlierPrefixes = [...server.slice(0, mount).matchAll(/app\.use\('(\/api[^']*)'/g)].map((m) => m[1]);
    for (const prefix of earlierPrefixes) {
      if (prefix === '/api') continue;
      expect('/api/csp-reports'.startsWith(`${prefix}/`) || prefix === '/api/csp-reports').toBe(false);
    }
  });

  it('onboardingRoutes: uç requireTenant\'tan ÖNCE bağlı (tenant başlığı/kimlik olmadan 204 ve yazılır)', async () => {
    const routes = readFileSync(new URL('../src/routes/onboardingRoutes.ts', import.meta.url), 'utf8');
    expect(routes.indexOf("router.use('/csp-reports', cspReportRoutes)")).toBeGreaterThan(-1);
    expect(routes.indexOf("router.use('/csp-reports', cspReportRoutes)")).toBeLessThan(routes.indexOf('router.use(requireTenant'));
    const res = await post(JSON.stringify(legacyReport()), 'application/csp-report');
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
