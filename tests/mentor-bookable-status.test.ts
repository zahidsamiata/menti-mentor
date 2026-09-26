/**
 * AN-28 · Menti'nin gördüğü mentör kartında "GERÇEKTEN randevu alınabilir mi" (entegrasyon).
 *
 * KARAR-80/M7: meşgul (müsaitlik bloğu yok) VEYA profili eksik mentör kart'ta SOLUK görünür,
 * HİÇBİR ZAMAN gizlenmez (liste boyu değişmez). KARAR-32 revizyonu: mentorVisibilityEnabled=false
 * → havuzdan ÇIKMAZ, soluk görünür, yalnız mesaj — randevu ALINAMAZ.
 *
 * rankMentorsForMenti (service) doğrudan çağrılır — buildMentiFacingMentorItem (controller DTO)
 * yalnızca isFaded/isBookable'ı dışa yansıtır; ara-sebep bayrakları (isVisibilityFaded/
 * isProfileFaded) burada servis düzeyinde doğrulanır (bkz. matching.ts RankedMentor).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createUserProfile } from './helpers/factories.js';
import { rankMentorsForMenti } from '../src/services/matching.js';
import type { Tenant } from '@prisma/client';

describe('AN-28 · rankMentorsForMenti — isVisibilityFaded / isProfileFaded / isBookable / isFaded', () => {
  let tenant: Tenant;

  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
    // Kurum barajı adayları düşürmesin — bu testler eşiği değil bookable/faded bayraklarını doğrular.
    await testPrisma.tenant.update({ where: { id: tenant.id }, data: { minMatchScoreThreshold: 0 } });
  });

  async function addActiveBlock(mentorId: string): Promise<void> {
    await testPrisma.availabilityBlock.create({
      data: {
        tenantId: tenant.id,
        userId: mentorId,
        weekday: 'MON',
        startTime: '08:00',
        endTime: '18:00',
        timezone: 'Europe/Istanbul',
        isActive: true,
      },
    });
  }

  it('mentorVisibilityEnabled=false → isVisibilityFaded:true, isBookable:false (bloğu olsa bile)', async () => {
    const menti = await createMenti(tenant.id);
    const mentor = await createMentor(tenant.id, { mentorVisibilityEnabled: false });
    await createUserProfile(mentor.id, { archetype: 'Kaşif', industryCode: 'TECH', skillTags: ['react'] });
    await addActiveBlock(mentor.id);

    const { items } = await rankMentorsForMenti({ mentiId: menti.id, mentiTenantId: tenant.id });
    const item = items.find((m) => m.mentorId === mentor.id);
    expect(item).toBeDefined();
    expect(item!.isVisibilityFaded).toBe(true);
    expect(item!.isBookable).toBe(false);
    expect(item!.isFaded).toBe(true);
  });

  it('hiç aktif AvailabilityBlock\'u olmayan mentör → isBookable:false, isFaded:true', async () => {
    const menti = await createMenti(tenant.id);
    const mentor = await createMentor(tenant.id);
    await createUserProfile(mentor.id, { archetype: 'Kaşif', industryCode: 'TECH', skillTags: ['react'] });
    // Kasıtlı: hiç blok eklenmedi.

    const { items } = await rankMentorsForMenti({ mentiId: menti.id, mentiTenantId: tenant.id });
    const item = items.find((m) => m.mentorId === mentor.id);
    expect(item).toBeDefined();
    expect(item!.isVisibilityFaded).toBe(false);
    expect(item!.isBookable).toBe(false);
    expect(item!.isFaded).toBe(true);
  });

  it('en az 1 aktif blok + görünürlük açık + profil tam → isFaded:false, isBookable:true', async () => {
    const menti = await createMenti(tenant.id);
    const mentor = await createMentor(tenant.id);
    await createUserProfile(mentor.id, { archetype: 'Kaşif', industryCode: 'TECH', skillTags: ['react'] });
    await addActiveBlock(mentor.id);

    const { items } = await rankMentorsForMenti({ mentiId: menti.id, mentiTenantId: tenant.id });
    const item = items.find((m) => m.mentorId === mentor.id);
    expect(item).toBeDefined();
    expect(item!.isVisibilityFaded).toBe(false);
    expect(item!.isProfileFaded).toBe(false);
    expect(item!.isBookable).toBe(true);
    expect(item!.isFaded).toBe(false);
  });

  it('UserProfile YOK olan mentörde istek ÇÖKMEZ — güvenli varsayılan isProfileFaded:true', async () => {
    const menti = await createMenti(tenant.id);
    const mentor = await createMentor(tenant.id);
    await addActiveBlock(mentor.id);
    // Kasıtlı: createUserProfile ÇAĞRILMADI — computeProfileCompleteness normalde throw eder.

    const { items } = await rankMentorsForMenti({ mentiId: menti.id, mentiTenantId: tenant.id });
    const item = items.find((m) => m.mentorId === mentor.id);
    expect(item, 'profili eksik mentör listeden DÜŞMEMELİ (KARAR-80/M7 — gizlenmez, soluk gösterilir)').toBeDefined();
    expect(item!.isProfileFaded).toBe(true);
    expect(item!.isFaded).toBe(true);
  });

  it('profili eksik mentör LİSTEDEN ÇIKARILMAZ — kart sayısı değişmez (KARAR-80/M7)', async () => {
    const menti = await createMenti(tenant.id);
    const complete = await createMentor(tenant.id);
    await createUserProfile(complete.id, { archetype: 'Kaşif', industryCode: 'TECH', skillTags: ['react'] });
    await addActiveBlock(complete.id);

    const incomplete = await createMentor(tenant.id);
    // UserProfile yok → isProfileFaded:true ama kart KALIR.

    const { items } = await rankMentorsForMenti({ mentiId: menti.id, mentiTenantId: tenant.id });
    const ids = items.map((m) => m.mentorId);
    expect(ids).toContain(complete.id);
    expect(ids).toContain(incomplete.id);
  });
});
