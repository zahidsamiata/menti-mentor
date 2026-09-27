/**
 * AJ-32 · V-02 — 500 hata kaydı ve süreç çöküşü kaydı (DB'siz birim testi).
 *
 * Neden: `errorHandler.ts`'teki 500 günlük meta alanları (url/method/userId/tenantId) ve
 * `server.ts`'teki `uncaughtException` / `unhandledRejection` işleyicileri testsizdi
 * (bitti-dogrulama-2026-09-27 · V-02 ⚠️) — silinse ya da meta alanı düşse hiçbir test kırılmazdı.
 *
 * Gerçek `logger` + `logSanitizer` zinciri kullanılır; yalnız prisma (SystemLog yazımı) sahtedir.
 * `server.ts` içe aktarılırken `app.listen` ve `process.on` sahtelenir: port açılmaz, cron
 * başlamaz, test sürecine gerçek işleyici eklenmez — kaydedilen işleyiciler yakalanıp çağrılır.
 * Üretim kodu değiştirilmedi.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';

const systemLogCreate = vi.fn().mockResolvedValue({});

vi.mock('../src/db.js', () => ({
  prisma: { systemLog: { create: (...a: unknown[]) => systemLogCreate(...a) } },
}));

import { globalErrorHandler } from '../src/middleware/errorHandler.js';

const RAW_EMAIL = 'kisi.adi@ornek-kurum.com';

type LoggedCall = { data: { level: string; category: string; message: string; meta?: Record<string, unknown> } };

function lastLogged(): LoggedCall['data'] {
  const calls = systemLogCreate.mock.calls;
  return (calls[calls.length - 1][0] as LoggedCall).data;
}

function fakeRes() {
  const res = { statusCode: 200, body: undefined as unknown, headersSent: false } as {
    statusCode: number; body: unknown; headersSent: boolean;
    status: (c: number) => typeof res; json: (b: unknown) => typeof res;
  };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}

// Mikro-görev sırasını boşalt: logger.error `void` ile çağrılıyor, create async zincirin sonunda.
const flush = () => new Promise((r) => setImmediate(r));

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterAll(() => {
  consoleLogSpy.mockRestore();
});
beforeEach(() => {
  systemLogCreate.mockClear();
});

describe('AJ-32 · V-02 — globalErrorHandler 500 kaydı', () => {
  it('meta: url + method + userId + tenantId VAR; e-posta ham YOK; istemciye iç detay dönmez', async () => {
    const req = {
      originalUrl: '/api/meetings/abc?x=1',
      method: 'POST',
      auth: { userId: 'u-42', tenantId: 't-7', email: RAW_EMAIL },
      tenant: { tenantId: 't-7' },
    } as unknown as Request;
    const res = fakeRes();

    globalErrorHandler(
      new Error(`Unique constraint failed for ${RAW_EMAIL} at /srv/app/db.ts`),
      req,
      res as unknown as Response,
      (() => undefined) as NextFunction,
    );
    await flush();

    expect(systemLogCreate).toHaveBeenCalledTimes(1);
    const logged = lastLogged();
    expect(logged.level).toBe('ERROR');
    expect(logged.category).toBe('HTTP');
    expect(logged.meta).toMatchObject({
      url: '/api/meetings/abc?x=1',
      method: 'POST',
      userId: 'u-42',
      tenantId: 't-7',
    });
    expect(JSON.stringify(logged)).not.toContain(RAW_EMAIL);

    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('Unique constraint');
    expect(JSON.stringify(res.body)).not.toContain(RAW_EMAIL);
  });
});

describe('AJ-32 · V-02 — server.ts süreç çöküşü işleyicileri', () => {
  const handlers = new Map<string, (arg: unknown) => void>();

  beforeAll(async () => {
    // Port açma / cron başlatma yok: listen sahte bir sunucu döndürür, geri çağrı çalışmaz.
    vi.spyOn(express.application, 'listen').mockImplementation(
      (() => ({ close: vi.fn() })) as unknown as typeof express.application.listen,
    );
    // Test sürecine gerçek işleyici ekleme — yalnız kaydedilenleri yakala.
    vi.spyOn(process, 'on').mockImplementation(((event: string, fn: (arg: unknown) => void) => {
      handlers.set(event, fn);
      return process;
    }) as unknown as typeof process.on);

    await import('../src/server.js');

    vi.mocked(process.on).mockRestore();
    vi.mocked(express.application.listen).mockRestore();
  }, 30_000);

  it('uncaughtException ve unhandledRejection işleyicileri kayıtlı', () => {
    expect(handlers.has('uncaughtException')).toBe(true);
    expect(handlers.has('unhandledRejection')).toBe(true);
  });

  it('uncaughtException → SYSTEM kategorisinde ERROR kaydı, e-posta maskeli', async () => {
    handlers.get('uncaughtException')!(new Error(`patladı: ${RAW_EMAIL}`));
    await flush();

    expect(systemLogCreate).toHaveBeenCalledTimes(1);
    const logged = lastLogged();
    expect(logged.level).toBe('ERROR');
    expect(logged.category).toBe('SYSTEM');
    expect(logged.message).toBe('uncaughtException');
    expect(String(logged.meta?.message)).toContain('patladı');
    expect(JSON.stringify(logged)).not.toContain(RAW_EMAIL);
  });

  it('unhandledRejection (Error olmayan sebep dahil) → SYSTEM kategorisinde ERROR kaydı', async () => {
    handlers.get('unhandledRejection')!('reddedildi-sebep');
    await flush();

    expect(systemLogCreate).toHaveBeenCalledTimes(1);
    const logged = lastLogged();
    expect(logged.category).toBe('SYSTEM');
    expect(logged.message).toBe('unhandledRejection');
    expect(logged.meta?.message).toBe('reddedildi-sebep');
  });
});
