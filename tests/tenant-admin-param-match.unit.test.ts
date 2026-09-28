/**
 * AJ-44 (F-23 kalanı) — URL'deki kurum (`:id`) ile oturumdaki kurumun eşleşmesi TEK kapıda
 * (`authenticateTenantAdminForParam`, middleware/tenantAdminAuth.ts). DB'siz birim testi:
 * prisma + üyelik + kurum önbelleği sahte; gerçek JWT imzalanır.
 *
 * Negatif ölçüt: A kurumunun (geçerli, aktif) yöneticisi B kurumunun `:id`'siyle her
 * adminSettings ucunu çağırır → 403 YETKI_YOK + uca özel mesaj, ve HİÇBİR veritabanı
 * okuma/yazması olmaz (kaynak değişmez, başka kurum verisi okunmaz).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const tenantUpdate     = vi.fn();
const tenantFindUnique = vi.fn();
const userFindMany     = vi.fn();
const membershipFindMany = vi.fn();

vi.mock('../src/db.js', () => ({
  prisma: {
    tenant: {
      update:     (...a: unknown[]) => tenantUpdate(...a),
      findUnique: (...a: unknown[]) => tenantFindUnique(...a),
    },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
    // AJ-114: blockPair iki kişiyi kurum üyeliğinden doğrular.
    tenantMembership: { findMany: (...a: unknown[]) => membershipFindMany(...a) },
  },
}));

vi.mock('../src/middleware/membershipAccess.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/middleware/membershipAccess.js')>();
  return { ...actual, resolveMembershipAccess: vi.fn().mockResolvedValue({ ok: true, role: 'ADMIN' }) };
});

vi.mock('../src/services/tenantCache.js', () => ({
  getCachedTenant:  vi.fn().mockResolvedValue({ isActive: true, verificationStatus: 'APPROVED' }),
  invalidateTenant: vi.fn(),
}));

import { signToken } from '../src/middleware/jwtAuth.js';
import { authenticateTenantAdminForParam } from '../src/middleware/tenantAdminAuth.js';
import {
  updateTenantSettings,
  blockPair,
  listBlockedPairs,
  unblockPair,
} from '../src/controllers/adminSettingsController.js';

const OWN_TENANT   = 'tenant-own';
const OTHER_TENANT = 'tenant-other';

const adminToken = signToken({ sub: 'admin-1', tenantId: OWN_TENANT, role: 'ADMIN', fullName: 'Deneme Yönetici' });

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

function fakeReq(params: Record<string, string>, body: unknown = {}): Request {
  return {
    params,
    body,
    header: (name: string) => (name.toLowerCase() === 'authorization' ? `Bearer ${adminToken}` : undefined),
  } as unknown as Request;
}

type Handler = (req: Request, res: Response) => unknown;

const cases: Array<{ name: string; handler: Handler; params: Record<string, string>; body: unknown; message: string }> = [
  {
    name: 'PATCH /:id/settings',
    handler: updateTenantSettings,
    params: { id: OTHER_TENANT },
    body: { maxMeetingsPerWeek: 3 },
    message: 'Başka bir kurumun ayarlarını güncelleyemezsiniz.',
  },
  {
    name: 'POST /:id/block-pair',
    handler: blockPair,
    params: { id: OTHER_TENANT },
    body: { fromUserId: 'u-a', toUserId: 'u-b' },
    message: 'Başka bir kurumda kullanıcı engelleyemezsiniz.',
  },
  {
    name: 'GET /:id/block-pairs',
    handler: listBlockedPairs,
    params: { id: OTHER_TENANT },
    body: {},
    message: 'Başka bir kurumun engel listesini göremezsiniz.',
  },
  {
    name: 'DELETE /:id/block-pair/:pairId',
    handler: unblockPair,
    params: { id: OTHER_TENANT, pairId: 'u-a:u-b' },
    body: {},
    message: 'Başka bir kurumun engelini kaldıramazsınız.',
  },
];

describe('AJ-44 — adminSettings uçları: URL kurumu ≠ oturum kurumu → 403, veri dokunulmaz', () => {
  beforeEach(() => {
    tenantUpdate.mockReset();
    tenantFindUnique.mockReset();
    userFindMany.mockReset();
    membershipFindMany.mockReset();
  });

  for (const c of cases) {
    it(`${c.name}: başka kurumun :id'si → 403 YETKI_YOK, veritabanına hiç gidilmez`, async () => {
      const res = fakeRes();
      await c.handler(fakeReq(c.params, c.body), res as unknown as Response);

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'YETKI_YOK', message: c.message });
      expect(tenantUpdate).not.toHaveBeenCalled();
      expect(tenantFindUnique).not.toHaveBeenCalled();
      expect(userFindMany).not.toHaveBeenCalled();
      expect(membershipFindMany).not.toHaveBeenCalled();
    });
  }

  it('pozitif kontrol: kendi kurumunun :id\'si → eşleşme geçer, kurum kendi id\'siyle okunur', async () => {
    tenantFindUnique.mockResolvedValue({ id: OWN_TENANT, blockedPairs: [] });
    userFindMany.mockResolvedValue([]);
    const res = fakeRes();
    await listBlockedPairs(fakeReq({ id: OWN_TENANT }), res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ items: [], total: 0 });
    expect(tenantFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: OWN_TENANT } }));
  });
});

describe('authenticateTenantAdminForParam — yardımcının kendisi', () => {
  it('parametre adı verilebilir; eşleşince oturum kimliği + kurum döner', async () => {
    const res = fakeRes();
    const ctx = await authenticateTenantAdminForParam(fakeReq({ tenantId: OWN_TENANT }), res as unknown as Response, 'x', 'tenantId');
    expect(ctx?.tenantId).toBe(OWN_TENANT);
    expect(ctx?.payload.sub).toBe('admin-1');
    expect(res.body).toBeUndefined();
  });

  it('parametre yoksa (yanlış ad) eşleşme sayılmaz → 403', async () => {
    const res = fakeRes();
    const ctx = await authenticateTenantAdminForParam(fakeReq({ id: OWN_TENANT }), res as unknown as Response, 'uyari', 'tenantId');
    expect(ctx).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'YETKI_YOK', message: 'uyari' });
  });

  it('token yoksa eşleşmeye gelmeden 401 (kimlik kapısı önce)', async () => {
    const res = fakeRes();
    const req = { params: { id: OWN_TENANT }, header: () => undefined } as unknown as Request;
    const ctx = await authenticateTenantAdminForParam(req, res as unknown as Response, 'x');
    expect(ctx).toBeNull();
    expect(res.statusCode).toBe(401);
  });
});
