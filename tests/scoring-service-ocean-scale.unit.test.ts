/**
 * AJ-32 · PS-A1 — `computeAndStoreProfile` ÇAĞRI NOKTASI 0-1 → 0-100 ölçek dönüşümünü yapıyor mu
 * (DB'siz birim testi).
 *
 * Neden: `disc-to-ocean.unit.test.ts` adaptörün kendisini ölçüyor; `scoring.service.ts`'te
 * `discToOcean(toOceanScale(...))` çağrısı eski hâline (`discToOcean({ d: discD, ... })`)
 * getirilse 24/24 test yeşil kalıyordu (bitti-dogrulama-2026-09-27 · PS-A1 ⚠️). Eski hâlde OCEAN
 * değerleri [49.75, 50.30]'a sıkışır, arketip eşikleri (60/55/45) hiç aşılmaz ve herkes varsayılan
 * M1/m1 arketipine düşer — eşleştirme karakter skoru anlamsızlaşır.
 *
 * Beklenen değerler `scoring.config.ts` DISC_TO_OCEAN_WEIGHTS'ten ELLE hesaplandı
 * (ocean = 50 + 50·Σ(w·disc%)/100), adaptör çağrılarak değil — totoloji yok.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type ProfileRow = { id: string; discD: number; discI: number; discS: number; discC: number };

let currentProfile: ProfileRow | null = null;
const profileUpdate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ ...args.data }));

vi.mock('../src/db.js', () => ({
  prisma: {
    userProfile: {
      findFirst: vi.fn(async () => currentProfile),
      update: (args: { data: Record<string, unknown> }) => profileUpdate(args),
    },
  },
}));

import { computeAndStoreProfile } from '../src/services/scoring.service.js';

describe('AJ-32 · PS-A1 — computeAndStoreProfile ölçek dönüşümü (çağrı noktası)', () => {
  beforeEach(() => {
    profileUpdate.mockClear();
  });

  it('saf S mentör (discS=1.0, oran) → oceanA 75, arketip M3 (varsayılan M1 DEĞİL)', async () => {
    currentProfile = { id: 'p1', discD: 0, discI: 0, discS: 1, discC: 0 };
    await computeAndStoreProfile('u1', 'MENTOR', 't1');

    const data = profileUpdate.mock.calls[0][0].data;
    // a = 50 + 50·(0.5·100)/100 = 75
    expect(data.oceanA).toBeCloseTo(75, 5);
    // n = 50 + 50·(-0.4·100)/100 = 30
    expect(data.oceanN).toBeCloseTo(30, 5);
    expect(data.archetype).toBe('M3');
  });

  it('saf D menti (discD=1.0, oran) → oceanE 70 / oceanA 25, arketip m4 (varsayılan m1 DEĞİL)', async () => {
    currentProfile = { id: 'p2', discD: 1, discI: 0, discS: 0, discC: 0 };
    await computeAndStoreProfile('u2', 'MENTI', 't1');

    const data = profileUpdate.mock.calls[0][0].data;
    // e = 50 + 50·(0.4·100)/100 = 70 · a = 50 + 50·(-0.5·100)/100 = 25
    expect(data.oceanE).toBeCloseTo(70, 5);
    expect(data.oceanA).toBeCloseTo(25, 5);
    expect(data.archetype).toBe('m4');
  });
});
