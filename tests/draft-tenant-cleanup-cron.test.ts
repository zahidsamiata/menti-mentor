/**
 * runDraftTenantCleanup — regresyon: anlaşması olan taslak tenant SİLİNMEZ.
 * KARAR 2 (2026-08-30): anlaşması olan tenant TERK EDİLMİŞ değil KULLANILMIŞ demektir.
 * Gerçek gönderim/mail yok; yalnız DB durumu + dönüş sayıları doğrulanır.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti } from './helpers/factories.js';

const { runDraftTenantCleanup } = await import('../src/services/cronScheduler.js');

const hoursAgo = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000);

// Tenant'ı cron'un silme koşuluna sok: TEMPLATE (DRAFT_STEPS) + 96h'ten eski + aktif.
async function makeDraft(tenantId: string) {
  await testPrisma.tenant.update({
    where: { id: tenantId },
    data: { onboardingStep: 'TEMPLATE', createdAt: hoursAgo(120), isActive: true },
  });
}

async function makeAgreement(tenantId: string, mentorId: string, mentiId: string) {
  return testPrisma.mentorshipAgreement.create({
    data: {
      tenantId,
      mentorId,
      mentiId,
      meetingFrequency: 'WEEKLY',
      communicationChannel: 'ONLINE',
      durationWeeks: 12,
      targetMeetings: 12,
      mentiGoal: 'regresyon testi hedefi',
    },
  });
}

describe('runDraftTenantCleanup', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  it('anlaşması OLAN taslak (TEMPLATE) tenant SİLİNMEZ, atlanır', async () => {
    const tenant = await createTenant({ name: 'Kullanılmış STK' });
    const mentor = await createMentor(tenant.id);
    const menti = await createMenti(tenant.id);
    await makeDraft(tenant.id);
    await makeAgreement(tenant.id, mentor.id, menti.id);

    const res = await runDraftTenantCleanup();

    expect(res.skipped).toBe(1);
    expect(res.deleted).toBe(0);
    // Tenant + kullanıcıları hâlâ duruyor.
    expect(await testPrisma.tenant.findUnique({ where: { id: tenant.id } })).not.toBeNull();
    expect(await testPrisma.user.count({ where: { tenantId: tenant.id } })).toBeGreaterThan(0);
  });

  it('anlaşması OLMAYAN taslak (TEMPLATE) tenant SİLİNİR (düzeltme fazla kapsayıcı değil)', async () => {
    const tenant = await createTenant({ name: 'Terk Edilmiş STK' });
    await makeDraft(tenant.id);

    const res = await runDraftTenantCleanup();

    expect(res.deleted).toBe(1);
    expect(res.skipped).toBe(0);
    expect(await testPrisma.tenant.findUnique({ where: { id: tenant.id } })).toBeNull();
  });
});
