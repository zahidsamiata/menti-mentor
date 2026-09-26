/**
 * /health DB canlılık kontrolü (W §4#8).
 *
 * getHealthStatus() DB'ye HAFİF bir SELECT 1 atar:
 *  - DB erişilebilir → ok:true, db:'up' (uç 200 döner)
 *  - DB erişilemez   → ok:false, db:'down' (uç 503 döner) ve uygulama ÇÖKMEZ
 * Böylece Docker healthcheck yalancı "healthy" veremez.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// prisma'yı mock'la — gerçek DB gerekmez (503 yolu DB'siz test edilebilir).
vi.mock('../src/db.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    systemLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import { getHealthStatus } from '../src/services/health.js';
import { getSmtpStatus, verifyTransporter } from '../src/services/emailService.js';
import { isCronEnabled } from '../src/services/cronScheduler.js';
import { prisma } from '../src/db.js';

const queryRaw = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;

describe('getHealthStatus — DB canlılık kontrolü', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DB erişilebilirken ok:true / db:up', async () => {
    queryRaw.mockResolvedValueOnce([{ ok: 1 }]);
    const s = await getHealthStatus();
    expect(s.ok).toBe(true);
    expect(s.db).toBe('up');
  });

  it('DB erişilemezken ok:false / db:down — çökmeden döner', async () => {
    queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const s = await getHealthStatus();
    expect(s.ok).toBe(false);
    expect(s.db).toBe('down');
  });

  // V-01 / V-11: /health artık SMTP ve cron durumunu da taşır.
  it('smtp ve cron alanlarını içerir', async () => {
    queryRaw.mockResolvedValueOnce([{ ok: 1 }]);
    const s = await getHealthStatus();
    expect(['verified', 'failed', 'unconfigured', 'unknown']).toContain(s.smtp);
    expect(['enabled', 'disabled']).toContain(s.cron);
  });

  // V-16: version sabit "0.1.0" canlıdaki gerçek kodu göstermiyordu; commit alanı
  // Dockerfile'ın GIT_SHA build-arg'ından gelir, wire edilmemişse 'unknown' döner.
  it('V-16: GIT_SHA env yoksa commit "unknown" döner', async () => {
    queryRaw.mockResolvedValueOnce([{ ok: 1 }]);
    const prev = process.env.GIT_SHA;
    delete process.env.GIT_SHA;
    const s = await getHealthStatus();
    expect(s.commit).toBe('unknown');
    if (prev !== undefined) process.env.GIT_SHA = prev;
  });

  it('V-16: GIT_SHA env varsa commit onu yansıtır', async () => {
    queryRaw.mockResolvedValueOnce([{ ok: 1 }]);
    const prev = process.env.GIT_SHA;
    process.env.GIT_SHA = 'a1b2c3d';
    const s = await getHealthStatus();
    expect(s.commit).toBe('a1b2c3d');
    if (prev === undefined) delete process.env.GIT_SHA; else process.env.GIT_SHA = prev;
  });
});

// V-01 / F-25: SMTP durum göstergesi — test ortamında SMTP yapılandırılmamış.
describe('SMTP durum göstergesi (V-01/F-25)', () => {
  it('yapılandırma yoksa getSmtpStatus "unconfigured" döner', () => {
    expect(getSmtpStatus()).toBe('unconfigured');
  });

  it('yapılandırma yoksa verifyTransporter false döner (handshake denenmez)', async () => {
    expect(await verifyTransporter()).toBe(false);
  });
});

// V-11: cron göstergesi — test ortamında (NODE_ENV=test) cron devre dışı.
describe('isCronEnabled (V-11)', () => {
  it('test ortamında false', () => {
    expect(isCronEnabled()).toBe(false);
  });
});
