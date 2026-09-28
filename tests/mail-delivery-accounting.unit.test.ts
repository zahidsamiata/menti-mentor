/**
 * U-16 (AJ-45) — mail gitmezse "gönderildi" yalanı yok, tek-atımlık hatırlatma yakılmaz.
 *
 * emailService.test.ts yalnız send()'in teslim edilemez alıcıda false döndüğünü ölçüyordu;
 * iddianın esas parçaları testsizdi. Bu dosya (DB'siz, sahte prisma + sahte SMTP):
 * 1. send(): SMTP gönderimi patlarsa false, başarırsa true döner.
 * 2. Elle hatırlatma ucu (sendPendingFeedbackReminders): `delivered` yalnız en az bir tarafa
 *    GERÇEKTEN giden görüşmeleri sayar; mesaj gönderilemeyenleri ayrıca söyler.
 * 3. Taslak kurum hatırlatma cron'u (runDraftTenantReminder): mail gitmezse
 *    `reminderEmailSentAt` YAZILMAZ; giderse yazılır.
 * 4. Otomatik geri bildirim hatırlatma cron'u (runFeedbackReminderCron, AJ-58): iki tarafa da
 *    mail gitmezse `feedbackPrompted` YAZILMAZ ve sayılmaz; en az biri giderse yazılır.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { Response } from 'express';
import type { RequestWithTenant } from '../src/types.js';

const { sendMailMock, feedbackReminderMock, draftReminderMock, prismaMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(),
  feedbackReminderMock: vi.fn(),
  draftReminderMock: vi.fn(),
  prismaMock: {
    systemLog: { create: vi.fn().mockResolvedValue({}) },
    meeting: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    tenant: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    user: { findFirst: vi.fn() },
  },
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ verify: vi.fn(), sendMail: sendMailMock }) },
}));
vi.mock('../src/db.js', () => ({ prisma: prismaMock }));
vi.mock('../src/services/emailService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/emailService.js')>();
  return {
    ...actual,
    sendFeedbackReminderEmail: feedbackReminderMock,
    sendDraftTenantReminderEmail: draftReminderMock,
  };
});

import { config } from '../src/config.js';
import { send } from '../src/services/emailService.js';
import {
  sendPendingFeedbackReminders,
  resetFeedbackReminderCooldown,
} from '../src/controllers/feedbackController.js';
import { runDraftTenantReminder, runFeedbackReminderCron } from '../src/services/cronScheduler.js';

const originalEmail = { ...config.email };

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
}

function meeting(id: string) {
  return {
    id,
    startsAt: new Date('2026-09-01T10:00:00Z'),
    mentor: { id: `${id}-mentor`, fullName: 'Test Mentor', email: `${id}-mentor@example.com` },
    menti: { id: `${id}-menti`, fullName: 'Test Menti', email: `${id}-menti@example.com` },
  };
}

describe('send() — SMTP sonucu çağırana doğru bildirilir (U-16)', () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    config.email.smtpHost = 'smtp.example.test';
    config.email.smtpUser = 'smtp-kullanici';
    config.email.smtpPass = 'smtp-parola';
  });
  afterAll(() => {
    Object.assign(config.email, originalEmail);
  });

  it('SMTP gönderimi patlarsa false döner (hata fırlatmaz)', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('535 Authentication failed'));
    await expect(send('alici@example.com', 'Konu', '<p>x</p>')).resolves.toBe(false);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('SMTP gönderimi başarırsa true döner', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'm1' });
    await expect(send('alici@example.com', 'Konu', '<p>x</p>')).resolves.toBe(true);
  });
});

describe('Elle geri bildirim hatırlatması — delivered sayımı (U-16)', () => {
  beforeEach(() => {
    resetFeedbackReminderCooldown();
    feedbackReminderMock.mockReset();
    prismaMock.meeting.findMany.mockReset();
  });

  it('hiçbir tarafa gitmeyen görüşme "gönderildi" sayılmaz; gönderilemeyen ayrıca bildirilir', async () => {
    prismaMock.meeting.findMany.mockResolvedValueOnce([meeting('mA'), meeting('mB'), meeting('mC')]);
    // mA: iki taraf da başarılı · mB: iki taraf da başarısız · mC: yalnız menti başarılı.
    feedbackReminderMock.mockImplementation(async (args: { toEmail: string }) => {
      if (args.toEmail.startsWith('mA-')) return true;
      if (args.toEmail.startsWith('mB-')) return false;
      return args.toEmail === 'mC-menti@example.com';
    });

    const res = fakeRes();
    await sendPendingFeedbackReminders(
      { tenant: { tenantId: 't1' } } as unknown as RequestWithTenant,
      res as unknown as Response,
    );

    const body = res.body as { count: number; delivered: number; message: string };
    expect(body.count).toBe(3);
    expect(body.delivered).toBe(2);
    expect(body.message).toBe('2 görüşme için hatırlatma e-postası gönderildi (1 görüşmeye gönderilemedi).');
  });

  it('gönderim fırlatırsa da teslim sayılmaz', async () => {
    prismaMock.meeting.findMany.mockResolvedValueOnce([meeting('mD')]);
    feedbackReminderMock.mockRejectedValue(new Error('SMTP down'));

    const res = fakeRes();
    await sendPendingFeedbackReminders(
      { tenant: { tenantId: 't1' } } as unknown as RequestWithTenant,
      res as unknown as Response,
    );
    const body = res.body as { count: number; delivered: number; message: string };
    expect(body.count).toBe(1);
    expect(body.delivered).toBe(0);
    expect(body.message).toContain('0 görüşme için');
  });
});

describe('Taslak kurum hatırlatma cron — bayrak yakılmaz (U-16)', () => {
  beforeEach(() => {
    draftReminderMock.mockReset();
    prismaMock.tenant.findMany.mockReset();
    prismaMock.tenant.update.mockClear();
    prismaMock.user.findFirst.mockReset();
    prismaMock.tenant.findMany.mockResolvedValue([
      { id: 'tn1', name: 'deneme', displayName: 'Deneme Kurumu', unsubscribeToken: 'unsub-1' },
    ]);
    prismaMock.user.findFirst.mockResolvedValue({ id: 'adm1', fullName: 'Kurum Yöneticisi', email: 'yonetici@example.com' });
  });

  it('mail gitmezse reminderEmailSentAt YAZILMAZ (sonraki cron tekrar dener)', async () => {
    draftReminderMock.mockResolvedValueOnce(false);
    await runDraftTenantReminder();
    expect(draftReminderMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.tenant.update).not.toHaveBeenCalled();
  });

  it('mail giderse reminderEmailSentAt yazılır', async () => {
    draftReminderMock.mockResolvedValueOnce(true);
    await runDraftTenantReminder();
    expect(prismaMock.tenant.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tn1' },
      data: { reminderEmailSentAt: expect.any(Date) },
    });
  });
});

describe('Otomatik geri bildirim hatırlatma cron — başarısız mail bayrağı yakmaz (AJ-58)', () => {
  beforeEach(() => {
    feedbackReminderMock.mockReset();
    prismaMock.meeting.findMany.mockReset();
    prismaMock.meeting.update.mockClear();
    prismaMock.meeting.findMany.mockResolvedValue([{ ...meeting('mF'), endsAt: new Date() }]);
  });

  it('iki tarafa da mail gitmezse feedbackPrompted YAZILMAZ ve sayılmaz', async () => {
    feedbackReminderMock.mockResolvedValue(false);
    await expect(runFeedbackReminderCron()).resolves.toEqual({ sent: 0 });
    expect(feedbackReminderMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.meeting.update).not.toHaveBeenCalled();
  });

  it('gönderimler fırlatırsa da feedbackPrompted YAZILMAZ', async () => {
    feedbackReminderMock.mockRejectedValue(new Error('SMTP down'));
    await expect(runFeedbackReminderCron()).resolves.toEqual({ sent: 0 });
    expect(prismaMock.meeting.update).not.toHaveBeenCalled();
  });

  it('yalnız bir tarafa gittiyse feedbackPrompted yazılır ve sayılır', async () => {
    feedbackReminderMock.mockImplementation(async (args: { toEmail: string }) => args.toEmail === 'mF-menti@example.com');
    await expect(runFeedbackReminderCron()).resolves.toEqual({ sent: 1 });
    expect(prismaMock.meeting.update).toHaveBeenCalledWith({ where: { id: 'mF' }, data: { feedbackPrompted: true } });
  });

  it('iki tarafa da gittiyse feedbackPrompted yazılır ve sayılır', async () => {
    feedbackReminderMock.mockResolvedValue(true);
    await expect(runFeedbackReminderCron()).resolves.toEqual({ sent: 1 });
    expect(prismaMock.meeting.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.meeting.update).toHaveBeenCalledWith({ where: { id: 'mF' }, data: { feedbackPrompted: true } });
  });
});
