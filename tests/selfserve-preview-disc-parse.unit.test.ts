/**
 * AJ-95 (AJ-94 7b eki) — kurum önizlemesi (`GET /api/tenants/:slug/preview`) yöneticinin DISC
 * vektörünü `parseDiscVector` ile DOĞRULAYARAK okur (DB'siz, prisma + kimlik sahte).
 *
 * Eskiden `admin.discVector as Record<string, number>` idi: bozuk kayıtta (metin/NaN) baskın boyut
 * sessizce "D" seçiliyor ve ham bozuk JSON yanıta konuyordu.
 * Ölçüt: bozuk/eksik vektör → 422 DISC_TESTI_EKSIK (vektörsüz yol); geçerli → baskın boyut doğru,
 * yanıttaki vektör yalnız doğrulanmış 5 anahtar.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const tenantFindUnique = vi.fn();
const userFindUnique = vi.fn();

vi.mock('../src/db.js', () => ({
  prisma: {
    tenant: { findUnique: (...a: unknown[]) => tenantFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
  },
}));

vi.mock('../src/middleware/tenantAdminAuth.js', () => ({
  authenticateTenantAdmin: vi.fn().mockResolvedValue({ sub: 'admin-1', tenantId: 't-1' }),
  authenticateTenantAdminForParam: vi.fn(),
}));

import { getTenantPreview } from '../src/controllers/selfServeController.js';

function fakeRes() {
  const res = { statusCode: 200, body: undefined as unknown } as {
    statusCode: number; body: unknown; status: (c: number) => typeof res; json: (b: unknown) => typeof res;
  };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}

async function preview(discVector: unknown) {
  userFindUnique.mockResolvedValue({ discVector, discType: 'S' });
  const res = fakeRes();
  await getTenantPreview({ params: { slug: 'kurum' } } as unknown as Request, res as unknown as Response);
  return res as { statusCode: number; body: Record<string, unknown> };
}

beforeEach(() => {
  tenantFindUnique.mockResolvedValue({ id: 't-1', name: 'Kurum', slug: 'kurum', plan: 'FREE', programTemplate: null });
  userFindUnique.mockReset();
});

describe('AJ-95 · kurum önizlemesi doğrulamalı DISC okuması', () => {
  it('geçerli vektör → 200, baskın boyut en yüksek bileşen, yanıtta yalnız 5 anahtar', async () => {
    const res = await preview({ D: 0.1, I: 0.2, S: 0.5, C: 0.2, confidence: 1, legacyExtra: 'x' });
    expect(res.statusCode).toBe(200);
    const adminProfile = res.body['adminProfile'] as { dominantDimension: string; discVector: object };
    expect(adminProfile.dominantDimension).toBe('S');
    expect(Object.keys(adminProfile.discVector).sort()).toEqual(['C', 'D', 'I', 'S', 'confidence']);
  });

  it.each([
    ['metin bileşen', { D: 'yüksek', I: 0.2, S: 0.5, C: 0.2, confidence: 1 }],
    ['eksik boyut', { I: 0.2, S: 0.5, C: 0.2, confidence: 1 }],
    ['dizi', [0.1, 0.2, 0.5, 0.2]],
    ['boş', null],
  ])('bozuk vektör (%s) → 422 DISC_TESTI_EKSIK, önizleme üretilmez', async (_label, vector) => {
    const res = await preview(vector);
    expect(res.statusCode).toBe(422);
    expect(res.body['error']).toBe('DISC_TESTI_EKSIK');
    expect(res.body['preview']).toBeUndefined();
  });
});
