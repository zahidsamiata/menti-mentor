/**
 * AJ-32 · GV-07 — `logger` katmanı PII süzgecine BAĞLI mı (DB'siz birim testi).
 *
 * Neden: `log-sanitizer.unit.test.ts` süzgecin kendisini, `platform-login-log-pii.unit.test.ts`
 * tek bir çağrı yerini ölçüyor. `logger.ts`'te mesaj/meta'yı süzgeçten geçiren iki satır
 * (`scrubText` / `sanitizeLogMeta`) kaldırılsa hiçbir test kırılmıyordu
 * (bitti-dogrulama-2026-09-27 · GV-07 ⚠️) → başka bir çağrı yeri ham e-posta yazarsa kalıcı
 * `SystemLog`'a inerdi. Bu test, `logger` üzerinden DB'ye giden veriyi yakalar.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const systemLogCreate = vi.fn().mockResolvedValue({});

vi.mock('../src/db.js', () => ({
  prisma: { systemLog: { create: (...a: unknown[]) => systemLogCreate(...a) } },
}));

import { logger } from '../src/services/logger.js';

const RAW_EMAIL = 'ayse.yilmaz@ornek-kurum.com';

describe('AJ-32 · GV-07 — logger kalıcı kayda ham PII yazmaz', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    systemLogCreate.mockClear();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('mesajdaki e-posta SystemLog ve konsola maskeli iner', async () => {
    await logger.error('EMAIL', `SMTP reddetti: ${RAW_EMAIL} teslim edilemedi`);

    expect(systemLogCreate).toHaveBeenCalledTimes(1);
    const written = JSON.stringify(systemLogCreate.mock.calls[0][0]);
    expect(written).not.toContain(RAW_EMAIL);
    expect(written).toContain('ornek-kurum.com'); // maske iz bırakır (alan adı)

    const consoleLine = String(consoleSpy.mock.calls[0][0]);
    expect(consoleLine).not.toContain(RAW_EMAIL);
  });

  it('meta içindeki e-posta / ad / psikometrik alanlar maskelenir, userId ve tenantId aynen kalır', async () => {
    await logger.warn('AUTH', 'başarısız giriş', {
      email: RAW_EMAIL,
      fullName: 'Ayşe Yılmaz',
      discVector: { D: 80, I: 10, S: 5, C: 5 },
      detail: `kullanıcı ${RAW_EMAIL} kilitlendi`,
      userId: 'u-123',
      tenantId: 't-9',
    });

    const data = systemLogCreate.mock.calls[0][0].data as { meta: Record<string, unknown> };
    const written = JSON.stringify(data);
    expect(written).not.toContain(RAW_EMAIL);
    expect(written).not.toContain('Ayşe Yılmaz');
    expect(data.meta.discVector).not.toEqual({ D: 80, I: 10, S: 5, C: 5 });
    expect(data.meta.userId).toBe('u-123');
    expect(data.meta.tenantId).toBe('t-9');
  });
});
