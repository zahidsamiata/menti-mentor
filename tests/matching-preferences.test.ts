/**
 * PATCH /api/users/me/matching-preferences — üç soru (S1/S2/S3, tasarım §10.2).
 * Kanıtlananlar:
 *  - Geçerli menti/mentör gönderimi → 200, dört alan yazılır.
 *  - "≤2 seçim" zorlanır (3 → 400 VALIDATION).
 *  - Geçersiz enum → 400.
 *  - Rol uyumu: menti mentorStrengths / mentör mentiNeeds gönderemez → 403.
 *  - EK2: S1 (mentiNeeds/mentorStrengths) BOŞ bırakılabilir (S2/S3 ile 200).
 *  - Self-write: yalnız kendi kaydına yazar (id token'dan).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

const URL = '/api/users/me/matching-preferences';

describe('matching-preferences (üç soru)', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let mentiId: string;
  let mentiTok: string;
  let mentorId: string;
  let mentorTok: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const menti = await createUser({ tenantId: tenant.id, role: 'MENTI', approvalStatus: 'APPROVED' });
    mentiId = menti.id;
    mentiTok = (await loginAs(http, menti.email, menti.rawPassword)).accessToken;
    const mentor = await createUser({ tenantId: tenant.id, role: 'MENTOR', approvalStatus: 'APPROVED' });
    mentorId = mentor.id;
    mentorTok = (await loginAs(http, mentor.email, mentor.rawPassword)).accessToken;
  });

  it('geçerli menti gönderimi (S1 ≤2 + S2 + S3) → 200, alanlar yazılır', async () => {
    await http.patch(URL).set(tenantHeaders(tenant.id, mentiTok)).send({
      mentiNeeds: ['KARAR_VEREMIYORUM', 'GUVENMIYORUM'],
      supportApproach: 'BIRLIKTE_DUSUNME',
      priorityValue: 'LEARNING',
    }).expect(200);

    const u = await testPrisma.user.findUnique({ where: { id: mentiId } });
    expect(u!.mentiNeeds).toEqual(['KARAR_VEREMIYORUM', 'GUVENMIYORUM']);
    expect(u!.supportApproach).toBe('BIRLIKTE_DUSUNME');
    expect(u!.priorityValue).toBe('LEARNING');
    expect(u!.mentorStrengths).toEqual([]); // menti tarafı dokunulmadı
  });

  it('geçerli mentör gönderimi (S1 ≤2 + S2 + S3) → 200', async () => {
    await http.patch(URL).set(tenantHeaders(tenant.id, mentorTok)).send({
      mentorStrengths: ['YON_BULMA', 'AG_KURMA'],
      supportApproach: 'YOL_GOSTERME',
      priorityValue: 'RESULT',
    }).expect(200);

    const u = await testPrisma.user.findUnique({ where: { id: mentorId } });
    expect(u!.mentorStrengths).toEqual(['YON_BULMA', 'AG_KURMA']);
    expect(u!.supportApproach).toBe('YOL_GOSTERME');
    expect(u!.priorityValue).toBe('RESULT');
  });

  it('3 seçim (≤2 ihlali) → 400 VALIDATION', async () => {
    await http.patch(URL).set(tenantHeaders(tenant.id, mentiTok)).send({
      mentiNeeds: ['KARAR_VEREMIYORUM', 'GUVENMIYORUM', 'KONUSACAK_BIRI'],
    }).expect(400);
  });

  it('geçersiz enum → 400', async () => {
    await http.patch(URL).set(tenantHeaders(tenant.id, mentiTok)).send({
      priorityValue: 'GEcERSIZ',
    }).expect(400);
  });

  it('rol uyumsuz: menti mentorStrengths gönderemez → 403', async () => {
    await http.patch(URL).set(tenantHeaders(tenant.id, mentiTok)).send({
      mentorStrengths: ['YON_BULMA'],
    }).expect(403);
  });

  it('rol uyumsuz: mentör mentiNeeds gönderemez → 403', async () => {
    await http.patch(URL).set(tenantHeaders(tenant.id, mentorTok)).send({
      mentiNeeds: ['KARAR_VEREMIYORUM'],
    }).expect(403);
  });

  it('EK2: S1 boş bırakılabilir (yalnız S2 + S3) → 200', async () => {
    await http.patch(URL).set(tenantHeaders(tenant.id, mentiTok)).send({
      supportApproach: 'DINLEME',
      priorityValue: 'UNDERSTOOD',
    }).expect(200);

    const u = await testPrisma.user.findUnique({ where: { id: mentiId } });
    expect(u!.mentiNeeds).toEqual([]);          // S1 boş kaldı — meşru
    expect(u!.supportApproach).toBe('DINLEME');
    expect(u!.priorityValue).toBe('UNDERSTOOD');
  });

  it('self-write: gönderim yalnız kendi kaydına yazar, diğerini etkilemez', async () => {
    await http.patch(URL).set(tenantHeaders(tenant.id, mentiTok)).send({
      priorityValue: 'PERSPECTIVE',
    }).expect(200);

    const other = await testPrisma.user.findUnique({ where: { id: mentorId } });
    expect(other!.priorityValue).toBeNull(); // mentör kaydı etkilenmedi
  });
});
