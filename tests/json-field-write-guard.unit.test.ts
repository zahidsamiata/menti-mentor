/**
 * AJ-95a (madde 170) — psikometrik `Json` yazım noktalarında şema kapısı (DB'siz, prisma sahte).
 *
 * Ölçüt: bozuk yapı → prisma yazımı HİÇ çağrılmaz.
 *  - Sunucu-hesaplı yol (`submitTemperamentTest`): hesaplayıcı bozuk sonuç üretirse fırlatır
 *    (global hata işleyici → 500 + günlük), `user.update` çağrılmaz.
 *  - Yönetici girdisi yolu (`updateUser` / `createUser`): bozuk `temperamentJson` → 400 VALIDATION,
 *    yazım çağrılmaz. Geçerli yapıda davranış aynı (yazım yapılır).
 *  - Onboarding DISC gönderimi: geçerli akışta iki alan doğrulanıp yazılır (davranış aynı).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { RequestWithTenant } from '../src/types.js';

const userUpdate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'u-1', ...args.data }));
const userCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'u-new', ...args.data }));
const userFindFirst = vi.fn(async () => ({ id: 'u-1' }));

vi.mock('../src/db.js', () => ({
  prisma: {
    user: {
      update: (args: { data: Record<string, unknown> }) => userUpdate(args),
      create: (args: { data: Record<string, unknown> }) => userCreate(args),
      findFirst: () => userFindFirst(),
    },
    refreshToken: { deleteMany: vi.fn() },
  },
}));

vi.mock('../src/services/membership.js', () => ({ ensureMembershipSafe: vi.fn() }));
vi.mock('../src/services/emailService.js', () => ({ sendAdminNewUserNotification: vi.fn() }));
vi.mock('../src/services/notificationService.js', () => ({ notifyAdminsPendingUser: vi.fn() }));

const analyzeTemperament = vi.fn();
vi.mock('../src/services/temperamentAnalysis.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/temperamentAnalysis.js')>();
  return { ...actual, analyzeTemperament: (...a: Parameters<typeof actual.analyzeTemperament>) => analyzeTemperament(...a) };
});

import { submitTemperamentTest } from '../src/controllers/temperamentController.js';
import { updateUser, createUser } from '../src/controllers/userController.js';
import { submitDiscTest } from '../src/controllers/onboardingController.js';
import { JsonFieldValidationError } from '../src/services/jsonFieldSchemas.js';

function fakeRes() {
  const res = { statusCode: 200, body: undefined as unknown } as {
    statusCode: number; body: unknown; status: (c: number) => typeof res; json: (b: unknown) => typeof res;
  };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}

const validTemperament = {
  dominantDisc: 'D',
  scores: { D: 4, I: 1, S: 1, C: 1 },
  percentages: { D: 57.1, I: 14.3, S: 14.3, C: 14.3 },
  enneagramWing: null,
  confidence: 'HIGH',
};

const sevenAnswers = Array.from({ length: 7 }, (_, i) => ({ questionId: i + 1, selectedDisc: 'D' }));

function adminReq(body: unknown, params: Record<string, string> = {}) {
  return {
    auth: { userId: 'admin-1', role: 'ADMIN', tenantId: 't-1' },
    tenant: { tenantId: 't-1' },
    params,
    body,
  } as unknown as RequestWithTenant;
}

beforeEach(() => {
  userUpdate.mockClear();
  userCreate.mockClear();
  analyzeTemperament.mockReset();
});

describe('AJ-95a · submitTemperamentTest — sunucu-hesaplı temperamentJson', () => {
  it('bozuk hesap sonucu (fazla alan + NaN) → fırlatır, user.update ÇAĞRILMAZ', async () => {
    analyzeTemperament.mockReturnValue({
      ...validTemperament,
      percentages: { D: Number.NaN, I: 0, S: 0, C: 0 },
      debug: 'fazla alan',
    });
    const req = { ...adminReq({ answers: sevenAnswers }, { id: 'u-1' }), auth: { userId: 'u-1', role: 'MENTI' } } as unknown as RequestWithTenant;
    await expect(submitTemperamentTest(req, fakeRes() as unknown as Response)).rejects.toBeInstanceOf(JsonFieldValidationError);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('geçerli akış (gerçek hesaplayıcı) → yazım yapılır, yazılan değer hesap sonucuyla aynı', async () => {
    const actual = await vi.importActual<typeof import('../src/services/temperamentAnalysis.js')>(
      '../src/services/temperamentAnalysis.js',
    );
    analyzeTemperament.mockImplementation(actual.analyzeTemperament);
    const req = { ...adminReq({ answers: sevenAnswers }, { id: 'u-1' }), auth: { userId: 'u-1', role: 'MENTI' } } as unknown as RequestWithTenant;
    const res = fakeRes();
    await submitTemperamentTest(req, res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    const written = userUpdate.mock.calls[0][0].data.temperamentJson;
    expect(written).toEqual((res.body as { analysis: unknown }).analysis);
  });
});

describe('AJ-95a · updateUser / createUser — yönetici girdisi temperamentJson', () => {
  it('updateUser: serbest nesne → 400 VALIDATION, user.update ÇAĞRILMAZ', async () => {
    const res = fakeRes();
    await updateUser(adminReq({ temperamentJson: { anything: true } }, { id: 'u-1' }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toBe('VALIDATION');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('updateUser: geçerli mizaç sonucu → yazım yapılır (davranış aynı)', async () => {
    const res = fakeRes();
    await updateUser(adminReq({ temperamentJson: validTemperament }, { id: 'u-1' }), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate.mock.calls[0][0].data.temperamentJson).toEqual(validTemperament);
  });

  it('createUser: fazla alanlı mizaç sonucu → 400 VALIDATION, user.create ÇAĞRILMAZ', async () => {
    const res = fakeRes();
    await createUser(
      adminReq({
        role: 'MENTI',
        email: 'yeni.uye@example.test',
        fullName: 'Yeni Üye',
        temperamentJson: { ...validTemperament, extra: 1 },
      }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(400);
    expect(userCreate).not.toHaveBeenCalled();
  });
});

describe('AJ-95a · submitDiscTest — discVector + discResultCard doğrulanarak yazılır', () => {
  it('geçerli akış: yazılan vektör 5 anahtarlı, kartta ham vektör/puan yok', async () => {
    const answers = Array.from({ length: 8 }, (_, i) => ({ questionId: i + 1, selectedOption: 'A' }));
    const req = { auth: { userId: 'u-1', tenantId: 't-1' }, body: { answers } } as unknown as RequestWithTenant;
    const res = fakeRes();
    await submitDiscTest(req, res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    const data = userUpdate.mock.calls[0][0].data;
    expect(Object.keys(data.discVector as object).sort()).toEqual(['C', 'D', 'I', 'S', 'confidence']);
    expect(data.discResultCard).not.toHaveProperty('discVector');
    expect(data.discResultCard).not.toHaveProperty('rawScores');
  });
});
