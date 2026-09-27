/**
 * AJ-32 · V-11 — `CRON_ENABLED` anahtarı ve `/health` cron göstergesi (DB'siz birim testi).
 *
 * Neden: `health.test.ts` yalnız "test ortamında false" ve "cron alanı enabled|disabled'dan biri"
 * diyor — `CRON_ENABLED='false'` dalı ve /health eşlemesi gerçekten ölçülmüyordu
 * (bitti-dogrulama-2026-09-27 · V-11 ⚠️). Operatör cron'u kapattığında /health bunu
 * göstermezse haftalık KVKK temizliğinin (purgeExpiredData) durduğu fark edilmez.
 *
 * `cronScheduler.ts` anahtarı modül yüklenirken okur → her senaryo `vi.resetModules()` +
 * ortam değişkeni + dinamik içe aktarma ile ayrı yüklenir. NODE_ENV 'development' seçilir
 * ('production' config.ts'in üretim sır denetimini tetikler, konu dışı).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/db.js', () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
    systemLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON = process.env.CRON_ENABLED;

async function loadWith(nodeEnv: string, cronEnabled: string | undefined) {
  process.env.NODE_ENV = nodeEnv;
  if (cronEnabled === undefined) delete process.env.CRON_ENABLED;
  else process.env.CRON_ENABLED = cronEnabled;
  vi.resetModules();
  const { isCronEnabled } = await import('../src/services/cronScheduler.js');
  const { getHealthStatus } = await import('../src/services/health.js');
  return { isCronEnabled, getHealthStatus };
}

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_CRON === undefined) delete process.env.CRON_ENABLED;
  else process.env.CRON_ENABLED = ORIGINAL_CRON;
  vi.resetModules();
});

describe('AJ-32 · V-11 — CRON_ENABLED ve /health cron alanı', () => {
  it('CRON_ENABLED tanımsız (geliştirme) → cron açık, /health "enabled"', async () => {
    const { isCronEnabled, getHealthStatus } = await loadWith('development', undefined);
    expect(isCronEnabled()).toBe(true);
    expect((await getHealthStatus()).cron).toBe('enabled');
  });

  it('CRON_ENABLED="false" → cron kapalı, /health "disabled"', async () => {
    const { isCronEnabled, getHealthStatus } = await loadWith('development', 'false');
    expect(isCronEnabled()).toBe(false);
    expect((await getHealthStatus()).cron).toBe('disabled');
  });

  it('yalnız TAM "false" kapatır — "true" / "0" / "FALSE" cron\'u kapatmaz', async () => {
    for (const value of ['true', '0', 'FALSE']) {
      const { isCronEnabled, getHealthStatus } = await loadWith('development', value);
      expect(isCronEnabled(), `CRON_ENABLED=${value}`).toBe(true);
      expect((await getHealthStatus()).cron, `CRON_ENABLED=${value}`).toBe('enabled');
    }
  });

  it('NODE_ENV="test" → CRON_ENABLED ne olursa olsun kapalı, /health "disabled"', async () => {
    const { isCronEnabled, getHealthStatus } = await loadWith('test', 'true');
    expect(isCronEnabled()).toBe(false);
    expect((await getHealthStatus()).cron).toBe('disabled');
  });
});
