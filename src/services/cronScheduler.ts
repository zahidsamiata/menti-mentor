/**
 * Cron Scheduler
 *
 * Haftalık otomasyon görevleri:
 *   1. algorithmTuner.runGlobalTuning() — Her Pazar 02:00 UTC
 *      NPS verilerine göre 60/40 sektör/DISC ağırlıklarını tenant bazında ayarlar.
 *   2. gdprService.purgeExpiredData()   — Her Pazar 03:00 UTC
 *      90 günden eski SystemLog kayıtlarını temizler (KVKK Md.7).
 *
 * Env: CRON_ENABLED=false ile tüm cron'lar devre dışı bırakılır (test/dev ortamları).
 */

import cron from 'node-cron';
import { prisma } from '../db.js';
import { tuneScoringWeights } from './algorithmTuner.js';
import { purgeExpiredData } from './gdprService.js';
import { sendDraftTenantReminderEmail, sendFeedbackReminderEmail } from './emailService.js';
import { logger } from './logger.js';

/**
 * Cron etkinleştirme koşulları (AND mantığı):
 *  1. NODE_ENV !== 'test'   → test ortamında cron asla çalışmaz; Vitest izolasyonu korunur
 *  2. CRON_ENABLED !== 'false' → geliştirici ortamında manuel kapatma imkânı
 */
const CRON_ENABLED =
  process.env.NODE_ENV !== 'test' &&
  process.env.CRON_ENABLED !== 'false';

// ─── Görev: Algoritma Ağırlık Ayarlaması ─────────────────────────────────────

/**
 * Her tenant'ın reportingFrequency ayarını kontrol ederek sadece
 * uygun olanlar için tuning çalıştırır.
 * WEEKLY: her Pazar çalışır
 * BIWEEKLY: 1. ve 3. Pazar çalışır
 * MONTHLY: sadece ayın 1. Pazar'ı çalışır
 */
async function runWeeklyTuning(): Promise<void> {
  void logger.info('SYSTEM', 'Cron: Algoritma ağırlık ayarlaması başladı');
  try {
    const now = new Date();
    const weekOfMonth = Math.ceil(now.getDate() / 7); // 1-5

    const tenants = (await prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    })) as Array<{ id: string; name: string; reportingFrequency?: string }>;

    let processed = 0;
    let skipped = 0;

    for (const tenant of tenants) {
      const freq = tenant.reportingFrequency ?? 'WEEKLY';
      const shouldRun =
        freq === 'WEEKLY' ||
        (freq === 'BIWEEKLY' && (weekOfMonth === 1 || weekOfMonth === 3)) ||
        (freq === 'MONTHLY'  && weekOfMonth === 1);

      if (!shouldRun) { skipped++; continue; }

      try {
        await tuneScoringWeights(tenant.id);
        processed++;
      } catch (err) {
        void logger.error('ML', `Tenant ${tenant.id} tuning başarısız`, { error: String(err) });
      }
    }

    void logger.info('SYSTEM', 'Cron: Ağırlık ayarlaması tamamlandı', { processed, skipped });
  } catch (err) {
    void logger.error('SYSTEM', 'Cron: Ağırlık ayarlaması başarısız', { error: String(err) });
  }
}

// ─── Görev: Süresi Dolan Veri Temizliği ──────────────────────────────────────

async function runWeeklyPurge(): Promise<void> {
  void logger.info('SYSTEM', 'Cron: KVKK veri temizliği başladı');
  try {
    const result = await purgeExpiredData();
    void logger.info('SYSTEM', `Cron: KVKK temizliği tamamlandı`, {
      systemLogsDeleted: result.systemLogsDeleted,
    });
  } catch (err) {
    void logger.error('SYSTEM', 'Cron: KVKK veri temizliği başarısız', { error: String(err) });
  }
}

// ─── Görev: Taslak Tenant Kurtarma E-postası (Faz 3) ─────────────────────────

const DRAFT_STEPS: string[] = ['TEMPLATE', 'LOGO', 'PREVIEW'];
const DRAFT_REMINDER_HOURS = 72;
const DRAFT_CLEANUP_HOURS  = 96; // 24h sonra temizle (reminder sonrası)

/**
 * Her 6 saatte bir çalışır.
 * Hedef: onboardingStep in ['TEMPLATE','LOGO','PREVIEW'], createdAt < 72h önce,
 * unsubscribedAt null, reminderEmailSentAt null olan tenant adminleri.
 * KVKK: Step4 geçilmiş = e-posta + KVKK onayı alınmıştır.
 * Unsubscribe linki e-posta şablonunda ZORUNLU (emailService'te mevcut).
 */
async function runDraftTenantReminder(): Promise<void> {
  void logger.info('SYSTEM', 'Cron: Taslak tenant kurtarma e-postası kontrolü');
  try {
    const cutoff = new Date(Date.now() - DRAFT_REMINDER_HOURS * 60 * 60 * 1000);

    const drafts = await prisma.tenant.findMany({
      where: {
        onboardingStep:      { in: DRAFT_STEPS },
        createdAt:           { lt: cutoff },
        reminderEmailSentAt: null,
        unsubscribedAt:      null,
        isActive:            true,
        unsubscribeToken:    { not: null },
      },
      select: {
        id: true, name: true, displayName: true, unsubscribeToken: true,
      },
    });

    // Admin e-postalarını ayrı çek (Prisma select ile nested relation include karışık değil)
    const draftsWithAdmins = await Promise.all(
      drafts.map(async (t) => {
        const admin = await prisma.user.findFirst({
          where:  { tenantId: t.id, role: 'ADMIN', isActive: true },
          select: { email: true, fullName: true },
        });
        return { ...t, admin };
      }),
    );

    let sent = 0;
    for (const tenant of draftsWithAdmins) {
      const { admin } = tenant;
      if (!admin || !tenant.unsubscribeToken) continue;

      try {
        await sendDraftTenantReminderEmail({
          toEmail:          admin.email,
          adminName:        admin.fullName,
          tenantName:       tenant.displayName ?? tenant.name,
          unsubscribeToken: tenant.unsubscribeToken,
        });
        await prisma.tenant.update({
          where: { id: tenant.id },
          data:  { reminderEmailSentAt: new Date() },
        });
        sent++;
      } catch (err) {
        void logger.error('EMAIL', `Taslak kurtarma e-postası başarısız: ${tenant.id}`, { error: String(err) });
      }
    }

    void logger.info('SYSTEM', 'Cron: Taslak kurtarma e-postaları gönderildi', { sent });
  } catch (err) {
    void logger.error('SYSTEM', 'Cron: Taslak kurtarma e-postası hatası', { error: String(err) });
  }
}

/**
 * Her gün 04:00 UTC çalışır.
 * 96 saati geçmiş ve hâlâ taslak olan tenant'ları siler (GDPR/KVKK veri minimizasyonu).
 * Cascade: users + memberships + refreshTokens otomatik silinir.
 */
async function runDraftTenantCleanup(): Promise<void> {
  void logger.info('SYSTEM', 'Cron: Taslak tenant temizliği başladı');
  try {
    const cutoff = new Date(Date.now() - DRAFT_CLEANUP_HOURS * 60 * 60 * 1000);

    const stale = await prisma.tenant.findMany({
      where: {
        onboardingStep: { in: DRAFT_STEPS },
        createdAt:      { lt: cutoff },
        isActive:       true,
      },
      select: { id: true, name: true },
    });

    let deleted = 0;
    for (const t of stale) {
      try {
        // Kullanıcıları sil (cascade yeterli değilse manuel)
        await prisma.user.deleteMany({ where: { tenantId: t.id } });
        await prisma.tenant.delete({ where: { id: t.id } });
        deleted++;
      } catch (err) {
        void logger.error('SYSTEM', `Taslak tenant silinemedi: ${t.id}`, { error: String(err) });
      }
    }

    void logger.info('SYSTEM', 'Cron: Taslak tenant temizliği tamamlandı', { deleted });
  } catch (err) {
    void logger.error('SYSTEM', 'Cron: Taslak tenant temizliği hatası', { error: String(err) });
  }
}

// ─── Görev: Feedback Hatırlatıcısı ───────────────────────────────────────────

const FEEDBACK_REMINDER_HOURS_MIN = 1;   // En az 1 saat geçsin (toplantı biter bitmez gönderme)
const FEEDBACK_REMINDER_DAYS_MAX  = 7;   // 7 günden eski toplantıları atla

export async function runFeedbackReminderCron(): Promise<{ sent: number }> {
  void logger.info('SYSTEM', 'Cron: Feedback hatırlatıcısı başladı');
  try {
    const now = new Date();
    const minAgo = new Date(now.getTime() - FEEDBACK_REMINDER_HOURS_MIN * 60 * 60 * 1000);
    const maxAgo = new Date(now.getTime() - FEEDBACK_REMINDER_DAYS_MAX  * 24 * 60 * 60 * 1000);

    const pendingMeetings = await prisma.meeting.findMany({
      where: {
        status: 'COMPLETED',
        hasFeedback: false,
        feedbackPrompted: false,
        endsAt: { lt: minAgo, gt: maxAgo },
      },
      include: {
        mentor: { select: { fullName: true, email: true } },
        menti:  { select: { fullName: true, email: true } },
      },
    });

    let sent = 0;
    for (const m of pendingMeetings) {
      await sendFeedbackReminderEmail({ toEmail: m.mentor.email, recipientName: m.mentor.fullName, meetingId: m.id, scheduledAt: m.startsAt }).catch(() => null);
      await sendFeedbackReminderEmail({ toEmail: m.menti.email,  recipientName: m.menti.fullName,  meetingId: m.id, scheduledAt: m.startsAt }).catch(() => null);
      await prisma.meeting.update({ where: { id: m.id }, data: { feedbackPrompted: true } });
      sent++;
    }

    void logger.info('SYSTEM', 'Cron: Feedback hatırlatıcısı tamamlandı', { sent });
    return { sent };
  } catch (err) {
    void logger.error('SYSTEM', 'Cron: Feedback hatırlatıcısı başarısız', { error: String(err) });
    return { sent: 0 };
  }
}

// ─── Görev: Anlaşma Yenileme Kontrolü ────────────────────────────────────────

const RENEWAL_WARN_DAYS = 7; // Bitmeden 7 gün önce bildir

export async function runAgreementRenewalCron(): Promise<{ prompted: number }> {
  void logger.info('SYSTEM', 'Cron: Anlaşma yenileme kontrolü başladı');
  try {
    const warnThreshold = new Date(Date.now() + RENEWAL_WARN_DAYS * 24 * 60 * 60 * 1000);

    const expiring = await prisma.mentorshipAgreement.findMany({
      where: {
        status: 'ACTIVE',
        renewalAskedAt: null,
        expiresAt: { not: null, lte: warnThreshold },
      },
      include: {
        mentor: { select: { email: true, fullName: true } },
        menti:  { select: { email: true, fullName: true } },
      },
    });

    let prompted = 0;
    for (const agreement of expiring) {
      await prisma.mentorshipAgreement.update({
        where: { id: agreement.id },
        data:  { status: 'RENEWAL_PENDING', renewalAskedAt: new Date() },
      });
      prompted++;
    }

    void logger.info('SYSTEM', 'Cron: Anlaşma yenileme kontrolü tamamlandı', { prompted });
    return { prompted };
  } catch (err) {
    void logger.error('SYSTEM', 'Cron: Anlaşma yenileme kontrolü başarısız', { error: String(err) });
    return { prompted: 0 };
  }
}

// ─── Scheduler başlatma ───────────────────────────────────────────────────────

export function startCronScheduler(): void {
  if (!CRON_ENABLED) {
    console.log('[CRON] CRON_ENABLED=false — tüm zamanlanmış görevler devre dışı.');
    return;
  }

  // Her Pazar 02:00 UTC — Algoritma ayarlaması
  cron.schedule('0 2 * * 0', () => {
    void runWeeklyTuning();
  }, { timezone: 'UTC' });

  // Her Pazar 03:00 UTC — KVKK veri temizliği
  cron.schedule('0 3 * * 0', () => {
    void runWeeklyPurge();
  }, { timezone: 'UTC' });

  // Her 6 saatte bir — Taslak tenant kurtarma e-postası (Faz 3)
  cron.schedule('0 */6 * * *', () => {
    void runDraftTenantReminder();
  }, { timezone: 'UTC' });

  // Her gün 04:00 UTC — Taslak tenant temizliği (Faz 3)
  cron.schedule('0 4 * * *', () => {
    void runDraftTenantCleanup();
  }, { timezone: 'UTC' });

  // Her gün 09:00 UTC — Feedback hatırlatıcısı (feedbackPrompted=false koruması)
  cron.schedule('0 9 * * *', () => {
    void runFeedbackReminderCron();
  }, { timezone: 'UTC' });

  // Her gün 10:00 UTC — Anlaşma yenileme kontrolü (7 gün önceden bildirim)
  cron.schedule('0 10 * * *', () => {
    void runAgreementRenewalCron();
  }, { timezone: 'UTC' });

  console.log('[CRON] Haftalık görevler zamanlandı: Pazar 02:00 (tuning) + 03:00 (purge) UTC');
  console.log('[CRON] Faz 3 cron\'ları aktif: Her 6h (taslak reminder) + Her gün 04:00 (taslak temizlik) + 09:00 (feedback hatırlatıcı) UTC');
}

// ─── Manuel tetikleme (admin endpoint'inden çağrılır) ────────────────────────

export { runWeeklyTuning, runWeeklyPurge, runDraftTenantReminder, runDraftTenantCleanup };
