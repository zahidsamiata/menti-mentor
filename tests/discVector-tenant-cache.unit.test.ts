/**
 * PS-06 — DISC güven paydası sorgusu kurum filtreli ve cache kurum-bazlı (DB'siz birim).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const count = vi.fn();

vi.mock('../src/db.js', () => ({
  prisma: {
    question: { count: (...args: unknown[]) => count(...args) },
    userResponse: { findMany: vi.fn().mockResolvedValue([]) },
    user: { update: vi.fn().mockResolvedValue({}) },
    userProfile: { upsert: vi.fn().mockResolvedValue({}) },
  },
}));

import {
  recalcDiscVector,
  invalidateDimensionalCountCache,
} from '../src/services/discVectorService.js';

describe('getDimensionalQuestionCount — kurum izolasyonu (PS-06)', () => {
  beforeEach(() => {
    count.mockReset();
    invalidateDimensionalCountCache();
  });

  it('sayım sorgusu global + istek kurumu ile sınırlıdır', async () => {
    count.mockResolvedValue(4);
    await recalcDiscVector('u1', 'tenant-a');

    expect(count).toHaveBeenCalledTimes(1);
    expect(count.mock.calls[0]![0]).toEqual({
      where: {
        isActive: true,
        discDimension: { not: 'GENERAL' },
        OR: [{ tenantId: null }, { tenantId: 'tenant-a' }],
      },
    });
  });

  it('cache kurum-bazlıdır: A için alınan sayı B için kullanılmaz', async () => {
    count.mockResolvedValueOnce(10).mockResolvedValueOnce(20);

    await recalcDiscVector('u1', 'tenant-a');
    await recalcDiscVector('u2', 'tenant-b');
    // A tekrar → cache hit, yeni sorgu yok
    await recalcDiscVector('u1', 'tenant-a');

    expect(count).toHaveBeenCalledTimes(2);
    const tenants = count.mock.calls.map(
      (c) => (c[0] as { where: { OR: Array<{ tenantId: string | null }> } }).where.OR[1]!.tenantId,
    );
    expect(tenants).toEqual(['tenant-a', 'tenant-b']);
  });

  it('invalidate tüm kurumların girdisini temizler', async () => {
    count.mockResolvedValue(3);
    await recalcDiscVector('u1', 'tenant-a');
    await recalcDiscVector('u2', 'tenant-b');
    invalidateDimensionalCountCache();
    await recalcDiscVector('u1', 'tenant-a');
    await recalcDiscVector('u2', 'tenant-b');
    expect(count).toHaveBeenCalledTimes(4);
  });
});
