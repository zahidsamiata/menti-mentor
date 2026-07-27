/**
 * Mentör sertifika — YÖNETİCİ BİLDİRİMİ cron'u (mentöre mail YOK — maliyet).
 * Geride kalan mentör için STK yöneticisine uygulama-içi bildirim (notificationService).
 * Gerçek gönderim yapılmaz (mock); yalnızca tetik + DB durumu doğrulanır.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createAdminUser } from './helpers/factories.js';
import { CERT_CONFIG } from '../src/services/certification.service.js';

const mocks = vi.hoisted(() => ({ notifyAdmins: vi.fn() }));

// Yalnızca kullanılan fonksiyonu mock'la; diğer export'lar gerçek kalır (partial mock).
vi.mock('../src/services/notificationService.js', async (orig) => ({
  ...(await orig<typeof import('../src/services/notificationService.js')>()),
  notifyAdminsMentorCertLapsed: mocks.notifyAdmins,
}));

const { runMentorCertAdminNotifyCron } = await import('../src/services/cronScheduler.js');

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

describe('runMentorCertAdminNotifyCron', () => {
  let tenantId: string;
  let mentorId: string;

  const setM = (data: Record<string, unknown>) =>
    testPrisma.tenantMembership.update({ where: { userId_tenantId: { userId: mentorId, tenantId } }, data });
  const getM = () =>
    testPrisma.tenantMembership.findUnique({ where: { userId_tenantId: { userId: mentorId, tenantId } } });

  beforeEach(async () => {
    await cleanDb();
    mocks.notifyAdmins.mockClear();
    const tenant = await createTenant({ name: 'Test STK' });
    tenantId = tenant.id;
    await createAdminUser(tenantId);
    const mentor = await createMentor(tenantId);
    mentorId = mentor.id;
  });

  it('hiç başlamamış + eski mentör için yöneticiye bildirir (mentöre mail yok)', async () => {
    await setM({ createdAt: daysAgo(4) }); // certAttempts=0, adminNotifyAfterDays=3 aşıldı

    const res = await runMentorCertAdminNotifyCron();

    expect(res.adminNotified).toBe(1);
    expect(mocks.notifyAdmins).toHaveBeenCalledTimes(1);
    expect(mocks.notifyAdmins).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, mentorName: expect.any(String) }),
    );
    expect((await getM())!.certAdminNotifiedAt).not.toBeNull();
  });

  it('haklarını tüketip geçememiş mentör için de bildirir', async () => {
    await setM({ createdAt: daysAgo(5), certAttempts: CERT_CONFIG.attemptsBeforeCooldown });
    const res = await runMentorCertAdminNotifyCron();
    expect(res.adminNotified).toBe(1);
    expect(mocks.notifyAdmins).toHaveBeenCalledTimes(1);
  });

  it('bildirim bir kez yapılır (tekrar tetiklenmez)', async () => {
    await setM({ createdAt: daysAgo(5), certAdminNotifiedAt: daysAgo(1) });
    const res = await runMentorCertAdminNotifyCron();
    expect(res.adminNotified).toBe(0);
    expect(mocks.notifyAdmins).not.toHaveBeenCalled();
  });

  it('aktif deneme sürecindeki (1 hak kullanmış, henüz tükenmemiş) mentör bildirilmez', async () => {
    await setM({ createdAt: daysAgo(5), certAttempts: 1 }); // 1 < attemptsBeforeCooldown(2)
    const res = await runMentorCertAdminNotifyCron();
    expect(res.adminNotified).toBe(0);
    expect(mocks.notifyAdmins).not.toHaveBeenCalled();
  });

  it('sertifikalı mentör bildirilmez', async () => {
    await setM({ createdAt: daysAgo(5), isCertified: true });
    const res = await runMentorCertAdminNotifyCron();
    expect(res.adminNotified).toBe(0);
  });

  it('yeni üyelik (eşik gününe ulaşmamış) bildirilmez', async () => {
    await setM({ createdAt: new Date() });
    const res = await runMentorCertAdminNotifyCron();
    expect(res.adminNotified).toBe(0);
  });
});
