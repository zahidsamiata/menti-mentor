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
});
