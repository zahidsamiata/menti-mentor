/**
 * V-06 — koda gömülü yedek JWT anahtarı yok: JWT_SECRET verilmezse config yüklenmez.
 * Boş dize kullanılır: dotenv var olan anahtarı ezmez, böylece yerel .env testi etkilemez.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

describe('V-06: JWT_SECRET zorunlu', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('negatif: JWT_SECRET boşsa config yüklenmez (gömülü yedek kullanılmaz)', async () => {
    vi.stubEnv('JWT_SECRET', '');
    vi.resetModules();
    await expect(import('../src/config.js')).rejects.toThrow(/JWT_SECRET tanımlı değil/);
  });

  it('negatif: production ortamında eski herkese açık değer reddedilir', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'dev-secret-change-in-production-min-32-chars!!');
    vi.stubEnv('PLATFORM_ADMIN_KEY', 'test-platform-key-yeterince-uzun');
    vi.stubEnv('DEFAULT_TENANT_ID', '');
    vi.resetModules();
    await expect(import('../src/config.js')).rejects.toThrow(/varsayılan değerle/);
  });

  it('JWT_SECRET verilmişse config yüklenir ve o değeri kullanır', async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret-min-32-chars-for-testing-only!!');
    vi.resetModules();
    const mod = await import('../src/config.js');
    expect(mod.config.jwt.secret).toBe('test-secret-min-32-chars-for-testing-only!!');
  });
});
