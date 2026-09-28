/**
 * AN-36 / G1-12 — Kurum yasal kimlik bilgileri (KVKK Veri İşleyen Sözleşmesi için).
 * GET/PATCH /api/tenants/:id/legal-info — gerçek DB entegrasyonu.
 *
 * Kanıtlanan:
 *  - kurumun aktif ADMIN'i okur/yazar; yanıt yalnız yasal alanlar (explicit select);
 *  - NEGATİF: oturumsuz 401 · mentör/menti 403 · başka kurumun yöneticisi 403 — ve DB DEĞİŞMEZ;
 *  - Zod: geçersiz MERSİS / KEP / VKN → 400, DB değişmez; bilinmeyen alan (ör. `plan`) → 400
 *    (mass-assignment kapalı); boş dize alanı temizler (null).
 * DB'siz birim eşi (doğrulama kuralları): tests/tenant-legal-info.unit.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser, createMentor, createMenti } from './helpers/factories.js';
import { signToken } from '../src/middleware/jwtAuth.js';
import type { User } from '@prisma/client';

function tokenFor(u: Pick<User, 'id' | 'tenantId' | 'role' | 'fullName'>): string {
  return signToken({ sub: u.id, tenantId: u.tenantId, role: u.role, fullName: u.fullName });
}

const VALID = {
  legalName:    'Örnek Gençlik Derneği',
  legalAddress: 'Örnek Mah. Deneme Sok. No:1 Çankaya/Ankara',
  kepAddress:   'ornekdernek@hs01.kep.tr',
  mersisNo:     '0123456789012345',
  taxOffice:    'Çankaya',
  taxNumber:    '1234567890',
};

const LEGAL_KEYS = [
  'legalName', 'legalAddress', 'kepAddress', 'mersisNo', 'taxOffice', 'taxNumber', 'legalInfoUpdatedAt',
].sort();

describe('AN-36 — kurum yasal bilgileri (GET/PATCH /api/tenants/:id/legal-info)', () => {
  let http: TestAgent;
  let tenantAId: string;
  let adminAToken: string;
  let mentorAToken: string;
  let mentiAToken: string;
  let foreignAdminToken: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    const tenantA = await createTenant();
    tenantAId = tenantA.id;
    adminAToken = tokenFor(await createAdminUser(tenantAId));
    mentorAToken = tokenFor(await createMentor(tenantAId));
    mentiAToken = tokenFor(await createMenti(tenantAId));
    const tenantB = await createTenant();
    foreignAdminToken = tokenFor(await createAdminUser(tenantB.id));
  });

  async function snapshotA() {
    return testPrisma.tenant.findUniqueOrThrow({
      where:  { id: tenantAId },
      select: {
        legalName: true, legalAddress: true, kepAddress: true, mersisNo: true,
        taxOffice: true, taxNumber: true, legalInfoUpdatedAt: true, updatedAt: true,
      },
    });
  }

  it('yönetici yazar ve okur; yanıt yalnız yasal alanları içerir', async () => {
    const patch = await http
      .patch(`/api/tenants/${tenantAId}/legal-info`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send(VALID);
    expect(patch.status).toBe(200);
    expect(patch.body.legalInfo).toMatchObject(VALID);
    expect(patch.body.legalInfo.legalInfoUpdatedAt).toBeTruthy();

    const get = await http
      .get(`/api/tenants/${tenantAId}/legal-info`)
      .set('Authorization', `Bearer ${adminAToken}`);
    expect(get.status).toBe(200);
    expect(Object.keys(get.body.legalInfo).sort()).toEqual(LEGAL_KEYS);
    expect(get.body.legalInfo).toMatchObject(VALID);

    const db = await snapshotA();
    expect(db).toMatchObject(VALID);
  });

  it('boş dize alanı temizler (null), gönderilmeyen alan dokunulmaz kalır', async () => {
    await http.patch(`/api/tenants/${tenantAId}/legal-info`)
      .set('Authorization', `Bearer ${adminAToken}`).send(VALID).expect(200);

    const res = await http
      .patch(`/api/tenants/${tenantAId}/legal-info`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ kepAddress: '' });
    expect(res.status).toBe(200);
    const db = await snapshotA();
    expect(db.kepAddress).toBeNull();
    expect(db.legalName).toBe(VALID.legalName);
    expect(db.mersisNo).toBe(VALID.mersisNo);
  });

  describe('NEGATİF — yetkisiz çağıran reddedilir, DB değişmez', () => {
    it('oturumsuz → 401', async () => {
      const before = await snapshotA();
      expect((await http.get(`/api/tenants/${tenantAId}/legal-info`)).status).toBe(401);
      expect((await http.patch(`/api/tenants/${tenantAId}/legal-info`).send(VALID)).status).toBe(401);
      expect(await snapshotA()).toEqual(before);
    });

    it('mentör ve menti → 403 (okuma ve yazma), DB değişmez', async () => {
      const before = await snapshotA();
      for (const token of [mentorAToken, mentiAToken]) {
        const get = await http.get(`/api/tenants/${tenantAId}/legal-info`).set('Authorization', `Bearer ${token}`);
        expect(get.status).toBe(403);
        expect(get.body.legalInfo).toBeUndefined();
        const patch = await http.patch(`/api/tenants/${tenantAId}/legal-info`)
          .set('Authorization', `Bearer ${token}`).send(VALID);
        expect(patch.status).toBe(403);
      }
      expect(await snapshotA()).toEqual(before);
    });

    it('başka kurumun yöneticisi → 403 (okuma ve yazma), veri dönmez, DB değişmez', async () => {
      await http.patch(`/api/tenants/${tenantAId}/legal-info`)
        .set('Authorization', `Bearer ${adminAToken}`).send(VALID).expect(200);
      const before = await snapshotA();

      const get = await http.get(`/api/tenants/${tenantAId}/legal-info`)
        .set('Authorization', `Bearer ${foreignAdminToken}`);
      expect(get.status).toBe(403);
      expect(get.body).toEqual({ error: 'YETKI_YOK', message: 'Başka bir kurumun yasal bilgilerini göremezsiniz.' });
      expect(JSON.stringify(get.body)).not.toContain(VALID.mersisNo);

      const patch = await http.patch(`/api/tenants/${tenantAId}/legal-info`)
        .set('Authorization', `Bearer ${foreignAdminToken}`).send({ legalName: 'Ele Geçirilmiş Unvan' });
      expect(patch.status).toBe(403);
      expect(patch.body).toEqual({ error: 'YETKI_YOK', message: 'Başka bir kurumun yasal bilgilerini güncelleyemezsiniz.' });

      expect(await snapshotA()).toEqual(before);
    });
  });

  describe('Zod — geçersiz girdi 400, DB değişmez', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['MERSİS 15 hane',          { mersisNo: '012345678901234' }],
      ['MERSİS harf içeriyor',    { mersisNo: '01234567890123AB' }],
      ['KEP e-posta değil',       { kepAddress: 'kep-adresi-degil' }],
      ['KEP kep.tr değil',        { kepAddress: 'kurum@gmail.com' }],
      ['VKN 9 hane',              { taxNumber: '123456789' }],
      ['bilinmeyen alan (plan)',  { legalName: 'X', plan: 'ENTERPRISE' }],
      ['boş gövde',               {}],
    ];
    for (const [label, body] of cases) {
      it(label, async () => {
        const before = await snapshotA();
        const res = await http.patch(`/api/tenants/${tenantAId}/legal-info`)
          .set('Authorization', `Bearer ${adminAToken}`).send(body);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('VALIDATION');
        expect(await snapshotA()).toEqual(before);
      });
    }
  });
});
