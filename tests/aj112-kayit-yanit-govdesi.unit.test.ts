/**
 * AJ-112 — kayıt ucu (POST /api/auth/register) kayıtlı ve kayıtsız e-posta için AYNI yanıt
 * gövdesini döner. DB'siz birim testi: prisma + e-posta/bildirim servisleri sahte.
 *
 * Neden: eskiden kayıtsız dal oluşturulan kullanıcıyı (`user: {...}`), kayıtlı dal `user: null`
 * döndürüyordu. Kod (201) ve mesaj aynı olsa da gövde farkı "bu e-posta kayıtlı" bilgisini
 * sızdırıyordu (AJ-104 yalnız süre farkını kapatmıştı). Kaynak: 7b incelemesi #256 madde 7.
 *
 * Ölçüt: iki dalın yanıt kodu ve gövdesi `toEqual` ile birebir aynı; gövde kişiye özgü veri
 * (kimlik, e-posta, ad, onay durumu) taşımaz.
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
// AJ-105: yönetici alıcıları findTenantAdminUsers'tan (üyelik tablosu) — aynı sahte liste.
vi.mock('../src/services/membership.js', () => ({
  ensureMembershipSafe: vi.fn().mockResolvedValue(undefined),
  findTenantAdminUsers: (...a: unknown[]) => userFindMany(...a),
}));

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

describe('AJ-112 — kayıt ucu: kayıtlı/kayıtsız e-posta için aynı yanıt gövdesi', () => {
  beforeEach(() => {
    bcryptHash.mockReset().mockResolvedValue('ozet');
    tenantFindUnique.mockReset().mockResolvedValue({
      id: 'tenant-1', name: 'Deneme Kurum', displayName: null, verificationStatus: 'APPROVED', isActive: true,
    });
    userFindUnique.mockReset();
    userFindMany.mockReset().mockResolvedValue([]);
    userCreate.mockReset().mockResolvedValue({ id: 'user-1', role: 'MENTI', tenantId: 'tenant-1' });
  });

  it('kayıtlı ve kayıtsız dalın yanıt kodu ve gövdesi birebir aynı', async () => {
    userFindUnique.mockResolvedValue({ id: 'var-olan', fullName: 'Var Olan' });
    const kayitli = await callRegister();
    userFindUnique.mockResolvedValue(null);
    const kayitsiz = await callRegister();

    expect(userCreate).toHaveBeenCalledTimes(1); // kayıtsız dal gerçekten kullanıcı oluşturdu
    expect(kayitli.statusCode).toBe(201);
    expect(kayitsiz.statusCode).toBe(kayitli.statusCode);
    expect(kayitsiz.body).toEqual(kayitli.body);
  });

  it('gövde yalnız mesaj taşır — kişiye özgü veri yok', async () => {
    userFindUnique.mockResolvedValue(null);
    const res = await callRegister();

    expect(res.body).toEqual({
      message: 'Kaydınız alındı. Kurum yöneticiniz onayladıktan sonra giriş yapabilirsiniz.',
    });
    const serialized = JSON.stringify(res.body);
    for (const kisisel of ['user-1', BODY.email, BODY.fullName, 'tenant-1']) {
      expect(serialized).not.toContain(kisisel);
    }
  });
});
