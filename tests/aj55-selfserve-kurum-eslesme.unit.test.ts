/**
 * AJ-55 — self-serve kurum-yönetici uçlarında URL `:id` ↔ oturum kurumu eşleşmesi TEK kapıda
 * (`authenticateTenantAdminForParam`, middleware/tenantAdminAuth.ts). DB'siz birim testi:
 * prisma + üyelik + kurum önbelleği sahte; gerçek JWT imzalanır.
 *
 * Ölçüt (her dört uç için):
 *  - A kurumunun yöneticisi B kurumunun `:id`'siyle → 403 YETKI_YOK + uca özel mesaj, veritabanına HİÇ gidilmez;
 *  - kendi kurumunun `:id`'si → eşleşme geçer, işlem kendi kurum kimliğiyle yapılır;
 *  - kurumda yönetici olmayan üye (üyelik rolü MENTOR) → 403 UYELIK_BULUNAMADI, veritabanına gidilmez
 *    (AJ-118: ret artık anahtardaki role claim'inden YETKI_YOK değil, üyelik rolünden UYELIK_BULUNAMADI).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const tenantUpdate         = vi.fn();
const tenantFindUnique     = vi.fn();
const templateFindMany     = vi.fn();
const templateUpsert       = vi.fn();

vi.mock('../src/db.js', () => ({
  prisma: {
    tenant: {
      update:     (...a: unknown[]) => tenantUpdate(...a),
      findUnique: (...a: unknown[]) => tenantFindUnique(...a),
    },
    invitationTemplate: {
      findMany: (...a: unknown[]) => templateFindMany(...a),
      upsert:   (...a: unknown[]) => templateUpsert(...a),
    },
  },
}));

vi.mock('../src/middleware/membershipAccess.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/middleware/membershipAccess.js')>();
  // AJ-118: yöneticilik kararı üyelik rolünden verilir (anahtardaki role claim'inden değil) — bu yüzden
  // sahte üyelik kişiye göre döner: 'mentor-1' kurumda MENTOR üyedir, diğerleri ADMIN.
  return {
    ...actual,
    resolveMembershipAccess: vi.fn(async (userId: string) =>
      (userId === 'mentor-1' ? { ok: true, role: 'MENTOR' } : { ok: true, role: 'ADMIN' })),
  };
});

vi.mock('../src/services/tenantCache.js', () => ({
  getCachedTenant:  vi.fn().mockResolvedValue({ isActive: true, verificationStatus: 'APPROVED' }),
  invalidateTenant: vi.fn(),
}));

import { signToken } from '../src/middleware/jwtAuth.js';
import {
  updateOnboarding,
  createInvitation,
  getInvitationTemplates,
  saveInvitationTemplate,
} from '../src/controllers/selfServeController.js';

const OWN_TENANT   = 'tenant-own';
const OTHER_TENANT = 'tenant-other';

const adminToken  = signToken({ sub: 'admin-1',  tenantId: OWN_TENANT, role: 'ADMIN',  fullName: 'Deneme Yönetici' });
const mentorToken = signToken({ sub: 'mentor-1', tenantId: OWN_TENANT, role: 'MENTOR', fullName: 'Deneme Mentör' });

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

function fakeReq(params: Record<string, string>, body: unknown, token: string): Request {
  return {
    params,
    body,
    header: (name: string) => (name.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined),
  } as unknown as Request;
}

type Handler = (req: Request, res: Response) => unknown;

const cases: Array<{
  name: string;
  handler: Handler;
  body: unknown;
  message: string;
  /** Kendi kurumunda başarılı yol için sahte DB yanıtları + beklenen durum ve DB çağrısı. */
  arrangeOwn: () => void;
  ownStatus: number;
  ownDbCall: () => ReturnType<typeof vi.fn>;
}> = [
  {
    name: 'PATCH /:id/onboarding',
    handler: updateOnboarding,
    body: { onboardingStep: 'LOGO' },
    message: 'Başka bir kurumun onboarding adımını güncelleyemezsiniz.',
    arrangeOwn: () => { tenantUpdate.mockResolvedValue({ id: OWN_TENANT }); },
    ownStatus: 200,
    ownDbCall: () => tenantUpdate,
  },
  {
    name: 'POST /:id/invitations',
    handler: createInvitation,
    body: { role: 'MENTI' },
    message: 'Başka bir kurumun davet linkini oluşturamazsınız.',
    arrangeOwn: () => {
      tenantFindUnique.mockResolvedValue({
        id: OWN_TENANT, name: 'Deneme Kurum', displayName: null, slug: 'deneme', verificationStatus: 'APPROVED',
      });
    },
    ownStatus: 201,
    ownDbCall: () => tenantFindUnique,
  },
  {
    name: 'GET /:id/invitation-templates',
    handler: getInvitationTemplates,
    body: {},
    message: 'Başka bir kurumun davet şablonlarını göremezsiniz.',
    arrangeOwn: () => { templateFindMany.mockResolvedValue([]); },
    ownStatus: 200,
    ownDbCall: () => templateFindMany,
  },
  {
    name: 'PUT /:id/invitation-templates',
    handler: saveInvitationTemplate,
    body: { role: 'MENTOR', format: 'EMAIL', content: 'Merhaba, programımıza davetlisiniz.' },
    message: 'Başka bir kurumun davet şablonunu kaydedemezsiniz.',
    arrangeOwn: () => { templateUpsert.mockResolvedValue({ id: 't-1' }); },
    ownStatus: 200,
    ownDbCall: () => templateUpsert,
  },
];

function expectNoDbCall() {
  expect(tenantUpdate).not.toHaveBeenCalled();
  expect(tenantFindUnique).not.toHaveBeenCalled();
  expect(templateFindMany).not.toHaveBeenCalled();
  expect(templateUpsert).not.toHaveBeenCalled();
}

describe('AJ-55 — self-serve kurum-yönetici uçları: URL kurumu = oturum kurumu tek kapıda', () => {
  beforeEach(() => {
    tenantUpdate.mockReset();
    tenantFindUnique.mockReset();
    templateFindMany.mockReset();
    templateUpsert.mockReset();
  });

  for (const c of cases) {
    it(`${c.name}: başka kurumun :id'si → 403 YETKI_YOK, veritabanına hiç gidilmez`, async () => {
      const res = fakeRes();
      await c.handler(fakeReq({ id: OTHER_TENANT }, c.body, adminToken), res as unknown as Response);

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'YETKI_YOK', message: c.message });
      expectNoDbCall();
    });

    it(`${c.name}: kendi kurumunun :id'si → geçer, işlem kendi kurum kimliğiyle yapılır`, async () => {
      c.arrangeOwn();
      const res = fakeRes();
      await c.handler(fakeReq({ id: OWN_TENANT }, c.body, adminToken), res as unknown as Response);

      expect(res.statusCode).toBe(c.ownStatus);
      const dbCall = c.ownDbCall();
      expect(dbCall).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(dbCall.mock.calls[0])).toContain(OWN_TENANT);
      expect(JSON.stringify(dbCall.mock.calls[0])).not.toContain(OTHER_TENANT);
    });

    it(`${c.name}: kurumda yönetici olmayan üye (üyelik MENTOR) → 403, veritabanına hiç gidilmez`, async () => {
      const res = fakeRes();
      await c.handler(fakeReq({ id: OWN_TENANT }, c.body, mentorToken), res as unknown as Response);

      expect(res.statusCode).toBe(403);
      expect((res.body as { error: string }).error).toBe('UYELIK_BULUNAMADI');
      expectNoDbCall();
    });
  }
});
