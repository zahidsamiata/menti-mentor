/**
 * AN-26 (KARAR-53 ④) — yanıtsız mentör hatırlatma + yönetici eskalasyonu cron'u.
 * Gerçek SMTP gönderimi mock'lanır; alıcılar + guard alanı yazımı doğrulanır.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';

const mocks = vi.hoisted(() => ({
  reminder: vi.fn(async () => true),
  escalation: vi.fn(async () => true),
}));

vi.mock('../src/services/emailService.js', async (orig) => ({
  ...(await orig<typeof import('../src/services/emailService.js')>()),
  sendMentorResponseReminderEmail: mocks.reminder,
  sendMentorNoResponseEscalationEmail: mocks.escalation,
}));

const { runMentorResponseReminderCron } = await import('../src/services/cronScheduler.js');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe('runMentorResponseReminderCron', () => {
  let tenantId: string;
  let mentor: Awaited<ReturnType<typeof createMentor>>;
  let menti: Awaited<ReturnType<typeof createMenti>>;
  let admin: Awaited<ReturnType<typeof createAdminUser>>;

  async function conversation(ageDays: number, data: Record<string, unknown> = {}) {
    const conv = await testPrisma.conversation.create({
      data: { tenantId, mentorUserId: mentor.id, mentiUserId: menti.id, createdAt: ago(ageDays), ...data },
    });
    await testPrisma.message.create({
      data: { conversationId: conv.id, senderUserId: menti.id, content: 'Merhaba', createdAt: ago(ageDays) },
    });
    return conv;
  }
  const getConv = (id: string) => testPrisma.conversation.findUniqueOrThrow({ where: { id } });

  beforeEach(async () => {
    await cleanDb();
    mocks.reminder.mockReset().mockResolvedValue(true);
    mocks.escalation.mockReset().mockResolvedValue(true);
    const tenant = await createTenant({ name: 'Test STK' });
    tenantId = tenant.id;
    admin = await createAdminUser(tenantId);
    mentor = await createMentor(tenantId);
    menti = await createMenti(tenantId);
  });

  it('3. gün: mentöre 1. hatırlatma gider, guard yazılır; ikinci çalıştırmada tekrar gitmez', async () => {
    const conv = await conversation(3.5);
    const r = await runMentorResponseReminderCron(NOW);
    expect(r.reminder1).toBe(1);
    expect(mocks.reminder).toHaveBeenCalledTimes(1);
    expect(mocks.reminder).toHaveBeenCalledWith(expect.objectContaining({
      toEmail: mentor.email, conversationId: conv.id, reminderNo: 1,
    }));
    expect(mocks.escalation).not.toHaveBeenCalled();
    expect((await getConv(conv.id)).mentorReminder1SentAt).not.toBeNull();

    await runMentorResponseReminderCron(NOW);
    expect(mocks.reminder).toHaveBeenCalledTimes(1);
  });

  it('7. gün: 2. hatırlatma gider', async () => {
    const conv = await conversation(7.5, { mentorReminder1SentAt: ago(4) });
    await runMentorResponseReminderCron(NOW);
    expect(mocks.reminder).toHaveBeenCalledWith(expect.objectContaining({ toEmail: mentor.email, reminderNo: 2 }));
    expect((await getConv(conv.id)).mentorReminder2SentAt).not.toBeNull();
  });

  it('mentör yanıt verdiyse hiçbir e-posta gitmez', async () => {
    const conv = await conversation(10.5);
    await testPrisma.message.create({ data: { conversationId: conv.id, senderUserId: mentor.id, content: 'Selam' } });
    await runMentorResponseReminderCron(NOW);
    expect(mocks.reminder).not.toHaveBeenCalled();
    expect(mocks.escalation).not.toHaveBeenCalled();
  });

  it('e-posta başarısızsa guard YAZILMAZ (sonraki çalıştırmada tekrar denenir)', async () => {
    mocks.reminder.mockResolvedValue(false);
    const conv = await conversation(3.5);
    const r = await runMentorResponseReminderCron(NOW);
    expect(r.failed).toBe(1);
    expect((await getConv(conv.id)).mentorReminder1SentAt).toBeNull();
  });

  it('10. gün: eskalasyon yalnız o kurumun aktif yöneticisine gider, mentöre değil', async () => {
    // Başka kurumun yöneticisi — eskalasyon ona GİTMEMELİ.
    const other = await createTenant({ name: 'Diğer STK' });
    const otherAdmin = await createAdminUser(other.id);
    // Bu kurumda pasif üyelikli yönetici — ona da GİTMEMELİ.
    const passiveAdmin = await createAdminUser(tenantId);
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: passiveAdmin.id, tenantId } },
      data: { isActive: false },
    });

    const conv = await conversation(10.5, { mentorReminder1SentAt: ago(7), mentorReminder2SentAt: ago(3) });
    const r = await runMentorResponseReminderCron(NOW);

    expect(r.escalated).toBe(1);
    expect(mocks.reminder).not.toHaveBeenCalled();
    const recipients = mocks.escalation.mock.calls.map((c) => (c as unknown as [{ toEmail: string }])[0].toEmail);
    expect(recipients).toEqual([admin.email]);
    expect(recipients).not.toContain(otherAdmin.email);
    expect(recipients).not.toContain(passiveAdmin.email);
    expect(mocks.escalation).toHaveBeenCalledWith(expect.objectContaining({ mentorName: mentor.fullName, daysWaiting: 10 }));
    expect((await getConv(conv.id)).adminEscalatedAt).not.toBeNull();

    await runMentorResponseReminderCron(NOW);
    expect(mocks.escalation).toHaveBeenCalledTimes(1);
  });

  it('kurumda aktif yönetici yoksa eskalasyon guard YAZILMAZ', async () => {
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: admin.id, tenantId } },
      data: { isActive: false },
    });
    const conv = await conversation(10.5);
    await runMentorResponseReminderCron(NOW);
    expect(mocks.escalation).not.toHaveBeenCalled();
    expect((await getConv(conv.id)).adminEscalatedAt).toBeNull();
  });

  it('atlanan günler: 8. günde yalnız 2. hatırlatma gider, 1. geriye dönük gitmez', async () => {
    const conv = await conversation(8.5);
    await runMentorResponseReminderCron(NOW);
    expect(mocks.reminder).toHaveBeenCalledTimes(1);
    expect(mocks.reminder).toHaveBeenCalledWith(expect.objectContaining({ reminderNo: 2 }));
    const after = await getConv(conv.id);
    expect(after.mentorReminder1SentAt).toBeNull();
    expect(after.mentorReminder2SentAt).not.toBeNull();
  });

  it('KARAR-53 ④ kapsamı: aktif müsaitlik bloğu olan mentöre hatırlatma/eskalasyon GİTMEZ', async () => {
    await testPrisma.availabilityBlock.create({
      data: { userId: mentor.id, tenantId, weekday: 'MON', startTime: '10:00', endTime: '12:00' },
    });
    await conversation(3.5);
    await conversation(10.5, {
      mentiUserId: (await createMenti(tenantId)).id,
    });
    await runMentorResponseReminderCron(NOW);
    expect(mocks.reminder).not.toHaveBeenCalled();
    expect(mocks.escalation).not.toHaveBeenCalled();
  });

  it('pasif müsaitlik bloğu kapsamı değiştirmez — hatırlatma gider', async () => {
    await testPrisma.availabilityBlock.create({
      data: { userId: mentor.id, tenantId, weekday: 'MON', startTime: '10:00', endTime: '12:00', isActive: false },
    });
    await conversation(3.5);
    await runMentorResponseReminderCron(NOW);
    expect(mocks.reminder).toHaveBeenCalledTimes(1);
  });

  it('menti hesabı pasifse hiçbir e-posta gitmez', async () => {
    await testPrisma.user.update({ where: { id: menti.id }, data: { isActive: false } });
    const conv = await conversation(10.5);
    await conversation(3.5, { mentiUserId: (await createMenti(tenantId)).id }).then(async (c) => {
      await testPrisma.user.update({ where: { id: c.mentiUserId }, data: { isActive: false } });
    });
    await runMentorResponseReminderCron(NOW);
    expect(mocks.reminder).not.toHaveBeenCalled();
    expect(mocks.escalation).not.toHaveBeenCalled();
    expect((await getConv(conv.id)).adminEscalatedAt).toBeNull();
  });

  it('mentörün kurum üyeliği pasifse hiçbir e-posta gitmez', async () => {
    await testPrisma.tenantMembership.update({
      where: { userId_tenantId: { userId: mentor.id, tenantId } },
      data: { isActive: false },
    });
    await conversation(3.5);
    await conversation(10.5, { mentiUserId: (await createMenti(tenantId)).id });
    await runMentorResponseReminderCron(NOW);
    expect(mocks.reminder).not.toHaveBeenCalled();
    expect(mocks.escalation).not.toHaveBeenCalled();
  });

  it('paylaşımlı havuz: mentör başka kurumdaysa hatırlatma gider ama 10. gün eskalasyonu GİTMEZ', async () => {
    const mentorTenant = await createTenant({ name: 'Mentör STK' });
    await createAdminUser(mentorTenant.id);
    const crossMentor = await createMentor(mentorTenant.id);

    const early = await testPrisma.conversation.create({
      data: { tenantId, mentorUserId: crossMentor.id, mentiUserId: menti.id, createdAt: ago(3.5) },
    });
    const otherMenti = await createMenti(tenantId);
    const late = await testPrisma.conversation.create({
      data: { tenantId, mentorUserId: crossMentor.id, mentiUserId: otherMenti.id, createdAt: ago(10.5) },
    });

    const r = await runMentorResponseReminderCron(NOW);
    expect(r.reminder1).toBe(1);
    expect(mocks.reminder).toHaveBeenCalledWith(expect.objectContaining({ toEmail: crossMentor.email, conversationId: early.id }));
    expect(mocks.escalation).not.toHaveBeenCalled();
    expect(r.escalated).toBe(0);
    expect((await getConv(late.id)).adminEscalatedAt).toBeNull();
  });

  it('14 günden eski konuşmaya dokunulmaz', async () => {
    await conversation(20);
    await runMentorResponseReminderCron(NOW);
    expect(mocks.reminder).not.toHaveBeenCalled();
    expect(mocks.escalation).not.toHaveBeenCalled();
  });
});
