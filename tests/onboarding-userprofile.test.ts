/**
 * Aşama 1 — Onboarding → UserProfile veri beslemesi testleri.
 *
 * Kanıtlananlar:
 *  - MEVCUT onboarding BOZULMADI: User.sectorTags / User.skills olduğu gibi yazılır, 200 döner.
 *  - EK olarak UserProfile skorlama alanları doldurulur (skillTags, goalTags, industryCode,
 *    yearsExp, schools/companies/communities).
 *  - Etiket sanitizasyonu çalışır (poison girdi elenir).
 *  - Opsiyonel alanlar boş bırakılınca hata olmaz.
 *  - Registration her kullanıcı için bir UserProfile satırı oluşturur (ensureUserProfile).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import type { Tenant } from '@prisma/client';

describe('Onboarding → UserProfile (Aşama 1)', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let userId: string;
  let token: string;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    const user = await createUser({
      tenantId: tenant.id,
      role: 'MENTI',
      approvalStatus: 'APPROVED',
      sectorTags: ['mevcut-etiket'],
    });
    userId = user.id;
    const tokens = await loginAs(http, user.email, user.rawPassword);
    token = tokens.accessToken;
  });

  it('mevcut User.* yazımını bozmaz: sectorTags birleştirilir, skills korunur, 200 döner', async () => {
    const res = await http
      .post('/api/users/profile/complete')
      .set(tenantHeaders(tenant.id, token))
      .send({
        sector: 'Teknoloji',
        skills: ['React', 'Node.js'],
        experienceYears: 5,
      })
      .expect(200);

    // Onboarding kontratı korunuyor
    const user = await testPrisma.user.findUnique({ where: { id: userId } });
    expect(user!.sectorTags).toContain('mevcut-etiket'); // eski etiket silinmedi
    expect(user!.sectorTags).toContain('teknoloji');     // yeni sektör eklendi
    expect(user!.skills).toEqual(['React', 'Node.js']);  // skills olduğu gibi
    expect(res.body).toBeTruthy();
  });

  it('UserProfile skorlama alanlarını doldurur (sektör→industryCode dahil)', async () => {
    await http
      .post('/api/users/profile/complete')
      .set(tenantHeaders(tenant.id, token))
      .send({
        sector: 'Teknoloji',
        skills: ['React'],
        experienceYears: 5,
        goals: ['Backend'],
        schools: ['Boğaziçi Üniversitesi'],
        companies: ['Trendyol'],
        communities: ['AIESEC'],
      })
      .expect(200);

    const profile = await testPrisma.userProfile.findUnique({ where: { userId } });
    expect(profile).not.toBeNull();
    expect(profile!.skillTags).toContain('react');
    expect(profile!.goalTags).toContain('backend');
    expect(profile!.industryCode).toBe('TEK');         // 'Teknoloji' → 'TEK'
    expect(profile!.yearsExp).toBe(5);
    expect(profile!.schools).toContain('boğaziçi üniversitesi');
    expect(profile!.companies).toContain('trendyol');
    expect(profile!.communities).toContain('aiesec');
  });

  it('poison etiketleri sanitizasyonla eler (skillTags / schools)', async () => {
    await http
      .post('/api/users/profile/complete')
      .set(tenantHeaders(tenant.id, token))
      .send({
        sector: 'Finans',
        skills: ['<script>alert(1)</script>', 'Geçerli Beceri'],
        experienceYears: 3,
        schools: ['<img src=x>', 'ODTÜ'],
      })
      .expect(200);

    const profile = await testPrisma.userProfile.findUnique({ where: { userId } });
    expect(profile!.skillTags).not.toContain('<script>alert(1)</script>');
    expect(profile!.skillTags).toContain('geçerli beceri');
    expect(profile!.schools.some((s) => s.includes('<'))).toBe(false);
    expect(profile!.schools).toContain('odtü');
    expect(profile!.industryCode).toBe('FIN');
  });

  it('opsiyonel alanlar gönderilmezse hata olmaz, diziler boş kalır', async () => {
    await http
      .post('/api/users/profile/complete')
      .set(tenantHeaders(tenant.id, token))
      .send({
        sector: 'Diğer',   // eşlenmeyen sektör → industryCode null
        skills: [],
        experienceYears: 0,
      })
      .expect(200);

    const profile = await testPrisma.userProfile.findUnique({ where: { userId } });
    expect(profile).not.toBeNull();
    expect(profile!.goalTags).toEqual([]);
    expect(profile!.schools).toEqual([]);
    expect(profile!.companies).toEqual([]);
    expect(profile!.communities).toEqual([]);
    expect(profile!.industryCode).toBeNull();
    expect(profile!.yearsExp).toBe(0);
  });

  it('registration her kullanıcı için bir UserProfile satırı oluşturur', async () => {
    await http
      .post('/api/auth/register')
      .send({
        email: 'yeni-profil@test.local',
        password: 'Test1234!',
        fullName: 'Profil Testi',
        role: 'MENTI',
        tenantSlug: tenant.slug,
        kvkkConsent: true,
        ageConsent: true,
      })
      .expect(201);

    const created = await testPrisma.user.findFirst({
      where: { email: 'yeni-profil@test.local' },
      select: { id: true },
    });
    const profile = await testPrisma.userProfile.findUnique({ where: { userId: created!.id } });
    expect(profile).not.toBeNull();
  });
});
