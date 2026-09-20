/**
 * PLATFORM_ADMIN_EMAIL konfigürasyon birim testleri — saf env okuma, DB gerektirmez.
 *
 * Kapsam:
 *  1. Ortam değişkeni set edildiğinde config o değeri alır.
 *  2. Set edilmediğinde tahmin edilebilir varsayılana düşer (mevcut davranışın kaydı).
 *  3. production + varsayılan → UYARI loglanır ama THROW EDİLMEZ. Bu bilinçli bir
 *     karardır: canlıda throw, değişken unutulduğunda tüm siteyi kapatır.
 *     PLATFORM_ADMIN_KEY'deki throw ise yerindedir ve bu testin konusu değildir.
 *
 * config, modül yüklenirken değerlendirilir → her senaryo vi.resetModules() sonrası
 * yeniden import edilir.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

// config.ts açılışta backend/.env okur. Geliştiricinin lokalinde bu dosya
// PLATFORM_ADMIN_EMAIL taşıyorsa "set edilmemiş" senaryosu kirlenirdi → dotenv no-op.
vi.mock('dotenv', () => ({ config: () => ({ parsed: {} }) }));

const ENV_KEY = 'PLATFORM_ADMIN_EMAIL';
const DEFAULT_EMAIL = 'admin@platform.local';

/** config modülünü taze process.env ile yeniden yükler. */
async function loadConfig() {
  vi.resetModules();
  const mod = await import('../src/config.js');
  return mod.config;
}

/** undefined ise anahtarı siler, değilse geri yazar (env'i testler arası temiz tutar). */
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('config.platformAdminEmail — PLATFORM_ADMIN_EMAIL ortam değişkeni', () => {
  const originalEmail = process.env[ENV_KEY];
  const originalNodeEnv = process.env['NODE_ENV'];
  const originalTenantId = process.env['DEFAULT_TENANT_ID'];

  afterEach(() => {
    restoreEnv(ENV_KEY, originalEmail);
    restoreEnv('NODE_ENV', originalNodeEnv);
    restoreEnv('DEFAULT_TENANT_ID', originalTenantId);
    vi.restoreAllMocks();
  });

  it('env set edildiğinde config o değeri alır', async () => {
    process.env[ENV_KEY] = 'kurum-admin@ornek-domain.test';

    const config = await loadConfig();

    expect(config.platformAdminEmail).toBe('kurum-admin@ornek-domain.test');
  });

  it('env set edilmediğinde varsayılana düşer', async () => {
    delete process.env[ENV_KEY];

    const config = await loadConfig();

    expect(config.platformAdminEmail).toBe(DEFAULT_EMAIL);
  });

  it('production + varsayılan değer: uyarı loglar, hata FIRLATMAZ (site kapanmaz)', async () => {
    delete process.env[ENV_KEY];
    // DEFAULT_TENANT_ID production'da ayrı bir throw tetikler — bu testin konusu değil.
    delete process.env['DEFAULT_TENANT_ID'];
    process.env['NODE_ENV'] = 'production';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = await loadConfig();

    expect(config.platformAdminEmail).toBe(DEFAULT_EMAIL);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(ENV_KEY);
  });

  it('production + env set edildiğinde uyarı loglanmaz', async () => {
    process.env[ENV_KEY] = 'kurum-admin@ornek-domain.test';
    delete process.env['DEFAULT_TENANT_ID'];
    process.env['NODE_ENV'] = 'production';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = await loadConfig();

    expect(config.platformAdminEmail).toBe('kurum-admin@ornek-domain.test');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
