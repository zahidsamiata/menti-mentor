/**
 * AJ-104 — kayıt ucunda (POST /api/auth/register) şifre özeti (bcrypt) kayıtlı/kayıtsız e-posta
 * için AYNI maliyetli yolu izler. DB'siz birim testi: prisma + e-posta/bildirim servisleri sahte.
 *
 * Neden: özet yalnız kayıtsız dalda hesaplanırsa kayıtlı e-postanın yanıtı belirgin kısalır ve
 * "bu e-posta kayıtlı" bilgisi yanıt süresinden okunabilir (komşu uç selfServeController.register
 * özeti e-posta dalından önce hesaplar).
 *
 * Ölçüt: her iki dalda bcrypt.hash tam bir kez çağrılır; yanıt kodu ve gövde iki dalda aynıdır.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const bcryptHash       = vi.fn();
const tenantFindUnique = vi.fn();
const userFindUnique   = vi.fn();
const userFindMany     = vi.fn();
const userCreate       = vi.fn();

vi.mock('bcryptjs', () => ({
  default: {
    hash:    (...a: unknown[]) => bcryptHash(...a),
    compare: vi.fn(),
  },
}));

vi.mock('../src/db.js', () => ({
  prisma: {
    tenant: { findUnique: (...a: unknown[]) => tenantFindUnique(...a) },
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      findMany:   (...a: unknown[]) => userFindMany(...a),
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ user: { create: (...a: unknown[]) => userCreate(...a) } }),
  },
}));

vi.mock('../src/services/emailService.js', () => ({
  sendAdminNewUserNotification: vi.fn(),
  sendPasswordResetEmail:       vi.fn(),
  sendAlreadyRegisteredEmail:   vi.fn(),
}));
vi.mock('../src/services/notificationService.js', () => ({ notifyAdminsPendingUser: vi.fn() }));
vi.mock('../src/services/consentService.js', () => ({
  recordSignupConsent:     vi.fn().mockResolvedValue(undefined),
  hasCurrentSignupConsent: vi.fn(),
}));
vi.mock('../src/services/userProfile.service.js', () => ({ ensureUserProfile: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/services/membership.js', () => ({ ensureMembershipSafe: vi.fn().mockResolvedValue(undefined) }));

import { register } from '../src/controllers/authController.js';

interface FakeRes {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}

function fakeRes(): FakeRes {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body)   { this.body = body; return this; },
  };
}

const BODY = {
  email:       'deneme@example.com',
  password:    'GizliSifre123',
  fullName:    'Deneme Kullanıcı',
  role:        'MENTI',
  tenantSlug:  'deneme-kurum',
  kvkkConsent: true,
};

async function callRegister(): Promise<FakeRes> {
  const res = fakeRes();
  await register({ body: { ...BODY } } as unknown as Request, res as unknown as Response);
  return res;
}

describe('AJ-104 — kayıt ucu: şifre özeti kayıtlı/kayıtsız e-posta için aynı maliyetli yol', () => {
  beforeEach(() => {
    bcryptHash.mockReset().mockResolvedValue('ozet');
    tenantFindUnique.mockReset().mockResolvedValue({
      id: 'tenant-1', name: 'Deneme Kurum', displayName: null, verificationStatus: 'APPROVED', isActive: true,
    });
    userFindUnique.mockReset();
    userFindMany.mockReset().mockResolvedValue([]);
    userCreate.mockReset().mockResolvedValue({
      id: 'user-1', email: BODY.email, fullName: BODY.fullName, role: 'MENTI', tenantId: 'tenant-1', approvalStatus: 'PENDING',
    });
  });

  it('kayıtlı e-posta dalında da bcrypt.hash bir kez çağrılır (erken dönüş özeti atlamaz)', async () => {
    userFindUnique.mockResolvedValue({ id: 'var-olan', fullName: 'Var Olan' });
    const res = await callRegister();

    expect(res.statusCode).toBe(201);
    expect(bcryptHash).toHaveBeenCalledTimes(1);
    expect(bcryptHash).toHaveBeenCalledWith(BODY.password, 12);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('kayıtsız e-posta dalında bcrypt.hash bir kez çağrılır ve kullanıcı oluşturulur', async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await callRegister();

    expect(res.statusCode).toBe(201);
    expect(bcryptHash).toHaveBeenCalledTimes(1);
    expect(bcryptHash).toHaveBeenCalledWith(BODY.password, 12);
    expect(userCreate).toHaveBeenCalledTimes(1);
  });

  it('iki dal aynı yanıt kodunu ve mesajı döner (davranış değişmedi)', async () => {
    userFindUnique.mockResolvedValue({ id: 'var-olan', fullName: 'Var Olan' });
    const kayitli = await callRegister();
    userFindUnique.mockResolvedValue(null);
    const kayitsiz = await callRegister();

    expect(kayitli.statusCode).toBe(kayitsiz.statusCode);
    expect((kayitli.body as { message: string }).message).toBe((kayitsiz.body as { message: string }).message);
    expect(bcryptHash).toHaveBeenCalledTimes(2);
  });
});
