/**
 * AJ-20 — rankMentorsHandler onay kapısı, DB'siz birim.
 * prisma sahte: çağıranın approvalStatus'ü değişir, profil/mentör verisi hep hazır. Kapı yoksa
 * PENDING çağıran sıralamayı (results) alırdı; kapı varken 403 ONAY_BEKLENIYOR ve sıralama sorgusu hiç koşmaz.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { RequestWithTenant } from '../src/types.js';

let callerStatus: string | null = 'APPROVED';
const userFindFirst = vi.fn(async () => (callerStatus ? { approvalStatus: callerStatus } : null));
const profileFindFirst = vi.fn(async () => ({
  id: 'p-menti', userId: 'u-menti', archetype: 'EXPLORER', archetypeRole: 'MENTI', goalTags: [], skillTags: [],
}));
const profileFindMany = vi.fn(async () => [
  { id: 'p-mentor', userId: 'u-mentor', archetype: 'ARCHITECT', archetypeRole: 'MENTOR', goalTags: [], skillTags: [] },
]);
const membershipFindMany = vi.fn(async () => [{ userId: 'u-mentor', isCertified: true, qualityMultiplier: 1 }]);

vi.mock('../src/db.js', () => ({
  prisma: {
    user:             { findFirst: () => userFindFirst() },
    userProfile:      { findFirst: () => profileFindFirst(), findMany: () => profileFindMany() },
    tenantMembership: { findMany: () => membershipFindMany() },
  },
}));

const { rankMentorsHandler } = await import('../src/controllers/sjtScoringController.js');
const { rejectIfCallerNotApproved } = await import('../src/middleware/approvalGate.js');

function fakeRes() {
  const res = { statusCode: 200, body: undefined as unknown };
  const r = res as unknown as Response & typeof res;
  (r as unknown as { status: (c: number) => unknown }).status = (c: number) => { res.statusCode = c; return r; };
  (r as unknown as { json: (b: unknown) => unknown }).json = (b: unknown) => { res.body = b; return r; };
  return r;
}

function req(role: string): RequestWithTenant {
  return {
    body: { mentiId: 'p-menti' },
    auth: { userId: 'u-menti', role },
    tenant: { tenantId: 't1' },
  } as unknown as RequestWithTenant;
}

describe('AJ-20: rankMentorsHandler onay kapısı (birim)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callerStatus = 'APPROVED';
  });

  it('onaylı menti sıralamayı alır (200, results dolu)', async () => {
    const res = fakeRes();
    await rankMentorsHandler(req('MENTI'), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { results: unknown[] }).results).toHaveLength(1);
  });

  it.each(['PENDING', 'REJECTED'])('negatif: %s menti 403 ONAY_BEKLENIYOR alır, sıralama sorgusu koşmaz', async (status) => {
    callerStatus = status;
    const res = fakeRes();
    await rankMentorsHandler(req('MENTI'), res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: 'ONAY_BEKLENIYOR',
      message: 'Eşleşme önerilerini görmek için yönetici onayı gerekli.',
    });
    expect(profileFindMany).not.toHaveBeenCalled();
  });

  it('negatif: bu kurumda kullanıcı kaydı yoksa da kapı kapalı (403)', async () => {
    callerStatus = null;
    const res = fakeRes();
    await rankMentorsHandler(req('MENTI'), res);
    expect(res.statusCode).toBe(403);
  });

  it('ADMIN kapıya takılmaz, onay durumu sorgulanmaz', async () => {
    callerStatus = 'PENDING';
    const res = fakeRes();
    await rankMentorsHandler(req('ADMIN'), res);
    expect(res.statusCode).toBe(200);
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  it('ortak yardımcı: onaylıda false döner ve yanıt yazmaz', async () => {
    const res = fakeRes();
    await expect(rejectIfCallerNotApproved(req('MENTOR'), res)).resolves.toBe(false);
    expect(res.body).toBeUndefined();
  });
});
