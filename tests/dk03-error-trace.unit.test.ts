/**
 * DK-03 · hata iz kaydı (stack) süzgeci + panel görünümü + istemci yanıtı (DB'siz birim testi).
 *
 * KARAR-24 → B: tam iz kaydı platform paneline KİŞİSEL VERİ TEMİZLENMİŞ açılır. Bu dosya:
 *  - `scrubStackTrace` iz içindeki e-posta / JWT / Bearer / telefon / URL sorgu değeri /
 *    Prisma tırnaklı değerini maskeler, dosya yolu + satır numarasını korur.
 *  - `buildErrorTraceView` yalnız ERROR kaydını, yalnız izin listesindeki alanlarla ve temizlenmiş
 *    döndürür (ham meta anahtarları — ör. `email` — görünüme hiç girmez).
 *  - `globalErrorHandler` istemciye stack/iç detay DÖNDÜRMEZ; SystemLog'a yazılan stack temizdir.
 * Örnek veriler uydurmadır (gerçek kişi/numara değil).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const systemLogCreate = vi.fn().mockResolvedValue({});
vi.mock('../src/db.js', () => ({
  prisma: { systemLog: { create: (...a: unknown[]) => systemLogCreate(...a) } },
}));

import { scrubStackTrace, REDACTED } from '../src/services/logSanitizer.js';
import { buildErrorTraceView } from '../src/services/errorTrace.js';
import { globalErrorHandler } from '../src/middleware/errorHandler.js';

const EMAIL = 'ornek.kisi@example.org';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1LTEiLCJ0ZW5hbnRJZCI6InQtMSJ9.c2lnbmF0dXJlLWRlZ2VyaQ';
const PHONE = '+90 555 123 45 67';
const QUERY_SECRET = 'sorgu-degeri-gizli-123';
const QUOTED_NAME = 'Deneme Kisi Adi';

const RAW_STACK = [
  `PrismaClientKnownRequestError: Invalid \`prisma.user.create()\` invocation: { data: { fullName: "${QUOTED_NAME}", email: "${EMAIL}" } }`,
  `Unique constraint failed for ${EMAIL} phone ${PHONE} on /api/meetings?page=2&ref=${QUERY_SECRET}`,
  `Authorization: Bearer ${JWT}`,
  '    at createUser (/srv/app/dist/services/userService.js:42:17)',
  '    at async handler (/srv/app/dist/controllers/userController.js:118:5)',
].join('\n');

function assertClean(text: string) {
  expect(text).not.toContain(EMAIL);
  expect(text).not.toContain(JWT);
  expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  expect(text).not.toContain(PHONE);
  expect(text).not.toContain('555 123 45 67');
  expect(text).not.toContain(QUERY_SECRET);
  expect(text).not.toContain(QUOTED_NAME);
}

describe('DK-03 · scrubStackTrace', () => {
  it('e-posta, JWT, Bearer, telefon, URL sorgu değeri ve tırnaklı değer maskelenir', () => {
    const out = scrubStackTrace(RAW_STACK);
    assertClean(out);
    expect(out).toContain(REDACTED);
    expect(out).toContain('@example.org'); // e-posta maskesi alan adını bırakır (maskEmail)
    expect(out).toContain('?page=[gizli]&ref=[gizli]'); // anahtar kalır, değer gider
  });

  it('teşhis bilgisi korunur: dosya yolu + satır:sütun + fonksiyon adı', () => {
    const out = scrubStackTrace(RAW_STACK);
    expect(out).toContain('at createUser (/srv/app/dist/services/userService.js:42:17)');
    expect(out).toContain('userController.js:118:5');
    expect(out).toContain('PrismaClientKnownRequestError');
  });

  it('PII içermeyen iz AYNEN kalır', () => {
    const plain = "TypeError: Cannot read properties of undefined (reading 'id')\n    at f (/srv/a.js:1:2)";
    expect(scrubStackTrace(plain)).toBe(plain);
  });

  it('aşırı uzun iz kesilir (panel yükü sınırlı)', () => {
    const out = scrubStackTrace('x'.repeat(50_000));
    expect(out.length).toBeLessThan(16_100);
    expect(out.endsWith('[kesildi]')).toBe(true);
  });

  it('uzun, eşleşmeyen girdide doğrusal kalır (karesel süre yok)', () => {
    const started = Date.now();
    scrubStackTrace(`${'a'.repeat(15_000)}?${'b'.repeat(900)}`);
    scrubStackTrace('"'.repeat(15_000));
    scrubStackTrace('1 '.repeat(7_000));
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('DK-03 · buildErrorTraceView', () => {
  const base = { id: 'log-1', category: 'HTTP', message: 'Beklenmedik sunucu hatası', createdAt: new Date('2026-09-28T10:00:00Z') };

  it('ERROR kaydı: yalnız izin listesindeki alanlar, hepsi temizlenmiş', () => {
    const view = buildErrorTraceView({
      ...base,
      level: 'ERROR',
      meta: {
        message: `Unique constraint failed for ${EMAIL}`,
        stack: RAW_STACK,
        url: `/api/invitations/davet-tokeni-123/join?token=${QUERY_SECRET}&phone=05551234567`,
        method: 'POST',
        userId: 'u-42',
        tenantId: 't-7',
        email: EMAIL,               // izin listesinde yok → görünüme girmez
        fullName: QUOTED_NAME,      // izin listesinde yok → görünüme girmez
      },
    });
    expect(view).not.toBeNull();
    expect(Object.keys(view!).sort()).toEqual(
      ['category', 'createdAt', 'errorMessage', 'id', 'message', 'method', 'stack', 'tenantId', 'url', 'userId'],
    );
    assertClean(JSON.stringify(view));
    expect(JSON.stringify(view)).not.toContain('davet-tokeni-123');
    expect(JSON.stringify(view)).not.toContain('05551234567');
    expect(view!.stack).toContain('userService.js:42:17');
    expect(view!.method).toBe('POST');
    expect(view!.userId).toBe('u-42');
    expect(view!.tenantId).toBe('t-7');
  });

  it('ERROR dışı seviye → null (iz yalnız hatalar için açık)', () => {
    expect(buildErrorTraceView({ ...base, level: 'INFO', meta: { stack: RAW_STACK } })).toBeNull();
    expect(buildErrorTraceView({ ...base, level: 'WARN', meta: { stack: RAW_STACK } })).toBeNull();
  });

  it('kimlik alanı kimlik biçiminde değilse (ör. e-posta konmuşsa) gösterilmez', () => {
    const view = buildErrorTraceView({ ...base, level: 'ERROR', meta: { userId: EMAIL, tenantId: 'a b', method: 'rm -rf' } });
    expect(view!.userId).toBeNull();
    expect(view!.tenantId).toBeNull();
    expect(view!.method).toBeNull();
    expect(view!.stack).toBeNull();
  });

  it('meta yok / dizi / metin → alanlar null, çökme yok', () => {
    for (const meta of [null, [RAW_STACK], RAW_STACK]) {
      const view = buildErrorTraceView({ ...base, level: 'ERROR', meta });
      expect(view!.stack).toBeNull();
      expect(JSON.stringify(view)).not.toContain(EMAIL);
    }
  });
});

describe('DK-03 · globalErrorHandler — istemciye stack yok, günlüğe temiz stack', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  beforeAll(() => { consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined); });
  afterAll(() => { consoleLogSpy.mockRestore(); });
  beforeEach(() => { systemLogCreate.mockClear(); });

  it('NEGATİF: 500 yanıtında stack / dosya yolu / hata mesajı yok; SystemLog stack temizlenmiş', async () => {
    const err = new Error(`Unique constraint failed for ${EMAIL} token ${JWT}`);
    err.stack = RAW_STACK;
    const res = { statusCode: 200, body: undefined as unknown, headersSent: false } as {
      statusCode: number; body: unknown; headersSent: boolean;
      status: (c: number) => typeof res; json: (b: unknown) => typeof res;
    };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };

    globalErrorHandler(
      err,
      { originalUrl: '/api/meetings/abc', method: 'GET' } as unknown as Request,
      res as unknown as Response,
      (() => undefined) as NextFunction,
    );
    await new Promise((r) => setImmediate(r));

    expect(res.statusCode).toBe(500);
    const body = JSON.stringify(res.body);
    expect(res.body).toEqual({ error: 'INTERNAL', message: 'Beklenmedik bir sunucu hatası oluştu.' });
    expect(body).not.toContain('stack');
    expect(body).not.toContain('userService.js');
    expect(body).not.toContain('Unique constraint');

    const logged = (systemLogCreate.mock.calls[0][0] as { data: { meta: Record<string, unknown> } }).data.meta;
    expect(String(logged['stack'])).toContain('userService.js:42:17');
    assertClean(JSON.stringify(logged));
  });
});
