/**
 * Mentör sertifika hatırlatma cron'u — zamanlama/tetikleme mantığı.
 * Gerçek e-posta gönderilmez (emailService mock'lanır); yalnızca tetik + DB durumu doğrulanır.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createAdminUser } from './helpers/factories.js';
import { CERT_CONFIG } from '../src/services/certification.service.js';

const mocks = vi.hoisted(() => ({
  reminder: vi.fn(),
  adminLapsed: vi.fn(),
}));

vi.mock('../src/services/emailService.js', () => ({
  sendDraftTenantReminderEmail: vi.fn(),
  sendFeedbackReminderEmail: vi.fn(),
  sendMentorCertReminderEmail: mocks.reminder,
  sendAdminMentorCertLapsedEmail: mocks.adminLapsed,
}));

// Mock'tan SONRA import (vitest vi.mock'u hoist eder).
const { runMentorCertReminderCron } = await import('../src/services/cronScheduler.js');

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

describe('runMentorCertReminderCron', () => {
  let tenantId: string;
  let mentorId: string;

  async function setMembership(data: Record<string, unknown>) {
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: mentorId, tenantId } },
      data,
    });
  }
  async function getMembership() {
    return testPrisma.tenantMembership.findUnique({ where: { userId_tenantId: { userId: mentorId, tenantId } } });
  }

  beforeEach(async () => {
    await cleanDb();
    mocks.reminder.mockClear();
    mocks.adminLapsed.mockClear();
    const tenant = await createTenant({ name: 'Test STK' });
    tenantId = tenant.id;
    await createAdminUser(tenantId);
    const mentor = await createMentor(tenantId);
    mentorId = mentor.id;
  });

  it('başlamamış + eski mentöre hatırlatma gönderir, sayacı artırır', async () => {
    await setMembership({ createdAt: daysAgo(4) }); // reminderStartDays=3 aşıldı, certAttempts=0

    const res = await runMentorCertReminderCron();

    expect(res.reminded).toBe(1);
    expect(mocks.reminder).toHaveBeenCalledTimes(1);
    expect(mocks.adminLapsed).not.toHaveBeenCalled();
    const m = await getMembership();
    expect(m!.certReminderCount).toBe(1);
    expect(m!.certLastReminderAt).not.toBeNull();
  });

  it('hatırlatma sınırı dolunca STK yöneticisine bir kez bildirir', async () => {
    await setMembership({
      createdAt: daysAgo(6),
      certReminderCount: CERT_CONFIG.reminderMaxCount, // sınır doldu
      certLastReminderAt: daysAgo(1),
    });

    const res = await runMentorCertReminderCron();

    expect(res.adminNotified).toBe(1);
    expect(mocks.adminLapsed).toHaveBeenCalledTimes(1);
    expect(mocks.reminder).not.toHaveBeenCalled();
    const m = await getMembership();
    expect(m!.certAdminNotifiedAt).not.toBeNull();
  });

  it('admin zaten bildirildi ise tekrar bildirmez', async () => {
    await setMembership({
      createdAt: daysAgo(6),
      certReminderCount: CERT_CONFIG.reminderMaxCount,
      certAdminNotifiedAt: daysAgo(1),
    });
    const res = await runMentorCertReminderCron();
    expect(res.reminded).toBe(0);
    expect(res.adminNotified).toBe(0);
    expect(mocks.adminLapsed).not.toHaveBeenCalled();
  });

  it('sertifikaya başlamış (certAttempts>0) mentöre hatırlatma gitmez', async () => {
    await setMembership({ createdAt: daysAgo(5), certAttempts: 1 });
    const res = await runMentorCertReminderCron();
    expect(res.reminded).toBe(0);
    expect(mocks.reminder).not.toHaveBeenCalled();
  });

  it('yeni üyelik (eşik gününe ulaşmamış) hatırlatma almaz', async () => {
    await setMembership({ createdAt: new Date() }); // bugün → 3 günü doldurmadı
    const res = await runMentorCertReminderCron();
    expect(res.reminded).toBe(0);
  });

  it('günde 1 koruması: son hatırlatma çok yeni ise atlar', async () => {
    await setMembership({ createdAt: daysAgo(5), certReminderCount: 1, certLastReminderAt: new Date() });
    const res = await runMentorCertReminderCron();
    expect(res.reminded).toBe(0);
    expect(mocks.reminder).not.toHaveBeenCalled();
  });
});
