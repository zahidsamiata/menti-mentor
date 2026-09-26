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
import type { Checkpoint } from '@prisma/client';
import { prisma } from '../db.js';
import { tuneScoringWeights } from './algorithmTuner.js';
import { findMatchesDueForCheckpoint } from './feedback.service.js';
import { purgeExpiredData } from './gdprService.js';
import {
  sendDraftTenantReminderEmail,
  sendFeedbackReminderEmail,
  sendMentorNoResponseEscalationEmail,
  sendMentorResponseReminderEmail,
} from './emailService.js';
import { notifyAdminsMentorCertLapsed } from './notificationService.js';
import { CERT_CONFIG } from './certification.service.js';
import { logger } from './logger.js';

/**
 * Cron etkinleştirme koşulları (AND mantığı):
 *  1. NODE_ENV !== 'test'   → test ortamında cron asla çalışmaz; Vitest izolasyonu korunur
 *  2. CRON_ENABLED !== 'false' → geliştirici ortamında manuel kapatma imkânı
 */
const CRON_ENABLED =
  process.env.NODE_ENV !== 'test' &&
  process.env.CRON_ENABLED !== 'false';

/** V-11: zamanlanmış görevler açık mı — /health göstergesi için. */
export function isCronEnabled(): boolean {
  return CRON_ENABLED;
}

// ─── Görev: Algoritma Ağırlık Ayarlaması ─────────────────────────────────────

/**
 * Kurumun rapor sıklığına göre bu Pazar ağırlık ayarı çalışmalı mı?
 * WEEKLY: her Pazar · BIWEEKLY: ayın 1. ve 3. Pazarı · MONTHLY: ayın 1. Pazarı.
 * Bilinmeyen/boş değer şema varsayılanı gibi WEEKLY sayılır.
 */
export function shouldRunTuningThisWeek(reportingFrequency: string | null | undefined, now: Date): boolean {
  const weekOfMonth = Math.ceil(now.getUTCDate() / 7); // 1-5 (cron UTC'de çalışır)
  switch (reportingFrequency) {
    case 'BIWEEKLY': return weekOfMonth === 1 || weekOfMonth === 3;
    case 'MONTHLY':  return weekOfMonth === 1;
    default:         return true;
  }
}

/** Her tenant'ın reportingFrequency ayarına göre yalnız sırası gelenler için tuning çalıştırır. */
async function runWeeklyTuning(): Promise<void> {
  void logger.info('SYSTEM', 'Cron: Algoritma ağırlık ayarlaması başladı');
  try {
    const now = new Date();

    // KR-21: reportingFrequency önceden SEÇİLMİYORDU (tip dönüşümüyle gizleniyordu) → her kurum haftalık çalışıyordu.
    const tenants = await prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true, name: true, reportingFrequency: true },
    });

    let processed = 0;
    let skipped = 0;

    for (const tenant of tenants) {
      if (!shouldRunTuningThisWeek(tenant.reportingFrequency, now)) { skipped++; continue; }

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
      feedbackLogsDeleted: result.feedbackLogsDeleted,
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
        // U-16: mail GERÇEKTEN gitmediyse reminderEmailSentAt YAZILMAZ — tek-atımlık
        // hatırlatma boşa yakılmasın; SMTP düzelince sonraki cron'da tekrar denenir.
        const ok = await sendDraftTenantReminderEmail({
          toEmail:          admin.email,
          adminName:        admin.fullName,
          tenantName:       tenant.displayName ?? tenant.name,
          unsubscribeToken: tenant.unsubscribeToken,
        });
        if (!ok) {
          void logger.warn('EMAIL', `Taslak kurtarma e-postası gönderilemedi — atlandı, işaretlenmedi: ${tenant.id}`);
          continue;
        }
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
async function runDraftTenantCleanup(): Promise<{ deleted: number; skipped: number }> {
  void logger.info('SYSTEM', 'Cron: Taslak tenant temizliği başladı');
  try {
    const cutoff = new Date(Date.now() - DRAFT_CLEANUP_HOURS * 60 * 60 * 1000);

    const stale = await prisma.tenant.findMany({
      where: {
        onboardingStep: { in: DRAFT_STEPS },
        createdAt:      { lt: cutoff },
        isActive:       true,
      },
      // Anlaşma sayısı: anlaşması olan tenant TERK EDİLMİŞ değil KULLANILMIŞ demektir → silinmez.
      select: { id: true, name: true, _count: { select: { agreements: true } } },
    });

    let deleted = 0;
    let skipped = 0;
    for (const t of stale) {
      // Anlaşması olan taslak tenant KULLANILMIŞ → silme (onboarding'i bitmemiş olsa da). Görünmez
      // birikmesin diye atlama SystemLog'a yazılır (PII yok: yalnız tenantId + anlaşma sayısı).
      if (t._count.agreements > 0) {
        void logger.info('SYSTEM', 'Taslak tenant atlandı: anlaşması var', {
          tenantId: t.id,
          agreementCount: t._count.agreements,
        });
        skipped++;
        continue;
      }
      try {
        // Kullanıcıları sil (cascade yeterli değilse manuel)
        await prisma.user.deleteMany({ where: { tenantId: t.id } });
        await prisma.tenant.delete({ where: { id: t.id } });
        deleted++;
      } catch (err) {
        void logger.error('SYSTEM', `Taslak tenant silinemedi: ${t.id}`, { error: String(err) });
      }
    }

    void logger.info('SYSTEM', 'Cron: Taslak tenant temizliği tamamlandı', { deleted, skipped });
    return { deleted, skipped };
  } catch (err) {
    void logger.error('SYSTEM', 'Cron: Taslak tenant temizliği hatası', { error: String(err) });
    return { deleted: 0, skipped: 0 };
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

// ─── Görev: Otomatik Toplantı Tamamlama (U-01, ÇIKIŞ BLOKERİ) ────────────────
//
// KARAR-80/M11 (2026-09-26): kimse tıklamadan, bitiş saati (endsAt) geçmiş SCHEDULED
// toplantılar otomatik COMPLETED olur. Bu olmadan check-in + feedback akışı (ikisi de
// status==='COMPLETED' şartına bakıyor — meetingCheckInController.ts, feedbackController.ts)
// HİÇBİR toplantı için açılmıyordu; ana ürün döngüsü tamamen ölüydü.
//
// Mentör yanlış otomatik-tamamlamayı sonradan düzeltebilir: POST /:meetingId/mark-not-happened
// ("gerçekleşmedi") → CANCELLED (meetingController.ts). Yeni bir NO_SHOW enum değeri EKLENMEDİ:
// CANCELLED zaten "bu toplantı sayılmaz" anlamına geliyor (bkz. rejectMeetingByMentor, aynı
// enum'u PENDING→CANCELLED için kullanıyor) ve downstream hiçbir akış COMPLETED dışında
// açılmadığı için CANCELLED'a dönmek check-in/feedback'i güvenle kapatır — migration gerekmez.
export async function runAutoCompleteMeetingsCron(): Promise<{ completed: number }> {
  void logger.info('SYSTEM', 'Cron: Otomatik toplantı tamamlama başladı');
  try {
    const now = new Date();
    const result = await prisma.meeting.updateMany({
      where: { status: 'SCHEDULED', endsAt: { lt: now } },
      data:  { status: 'COMPLETED' },
    });
    void logger.info('SYSTEM', 'Cron: Otomatik toplantı tamamlama tamamlandı', { completed: result.count });
    return { completed: result.count };
  } catch (err) {
    void logger.error('SYSTEM', 'Cron: Otomatik toplantı tamamlama başarısız', { error: String(err) });
    return { completed: 0 };
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

// ─── Görev: Mentör Sertifika — Yönetici Bildirimi ────────────────────────────
//
// Sertifika hazırlığında geride kalan mentör için STK yöneticisine BİR kez
// uygulama-içi bildirim gönderir (mail DEĞİL — sıfır maliyet). Yönetici mentörü
// kişisel olarak hatırlatır; mentör bu bildirimin gittiğini BİLMEZ.
//
// Tetik (CERT_CONFIG.adminNotifyAfterDays gün açılıştan sonra, henüz bildirilmemiş):
//   - Hiç başlamamış (certAttempts = 0), VEYA
//   - Verilen hakları tüketmiş (certAttempts >= attemptsBeforeCooldown) ama geçememiş.

export async function runMentorCertAdminNotifyCron(): Promise<{ adminNotified: number }> {
  void logger.info('SYSTEM', 'Cron: Mentör sertifika yönetici bildirimi başladı');
  try {
    const cutoff = new Date(Date.now() - CERT_CONFIG.adminNotifyAfterDays * 24 * 60 * 60 * 1000);

    const laggards = await prisma.tenantMembership.findMany({
      where: {
        role:                'MENTOR',
        isActive:            true,
        isCertified:         false,
        certAdminNotifiedAt: null,
        createdAt:           { lt: cutoff },
        OR: [
          { certAttempts: 0 },
          { certAttempts: { gte: CERT_CONFIG.attemptsBeforeCooldown } },
        ],
      },
      select: {
        id: true, tenantId: true,
        user: { select: { fullName: true, isActive: true } },
      },
    });

    let adminNotified = 0;
    for (const m of laggards) {
      if (!m.user?.isActive) continue;
      try {
        await notifyAdminsMentorCertLapsed({ tenantId: m.tenantId, mentorName: m.user.fullName });
      } catch (err) {
        void logger.error('SYSTEM', `STK yönetici bildirimi başarısız: ${m.id}`, { error: String(err) });
      }
      // Bildirim denendiyse tekrar denememek için işaretle (bir kez).
      await prisma.tenantMembership.update({
        where: { id: m.id },
        data:  { certAdminNotifiedAt: new Date() },
      });
      adminNotified++;
    }

    void logger.info('SYSTEM', 'Cron: Mentör sertifika yönetici bildirimi tamamlandı', { adminNotified });
    return { adminNotified };
  } catch (err) {
    void logger.error('SYSTEM', 'Cron: Mentör sertifika yönetici bildirimi başarısız', { error: String(err) });
    return { adminNotified: 0 };
  }
}

// ─── Görev: Periyodik Değerlendirme Checkpoint Hatırlatması (#7 Aşama 1) ──────
//
// DAY_3/14/30 değerlendirme noktası dolan (ilgili checkpoint feedback'i henüz gelmemiş)
// ACTIVE eşleşmeleri bulur → ölü `findMatchesDueForCheckpoint`'i cron'a bağlar.
//
// ⚠️ AŞAMA 1 = LOG-ONLY (yalnız görünürlük): gerçek mail/bildirim GÖNDERMEZ. Gerekçe:
//   1) Canlıya istenmeyen mail geri-ALINAMAZ → PO onayı gerekir (mail mı, uygulama-içi mi?).
//   2) Sağlam "tekrar-bildirme" guard'ı (ör. checkpointNotifiedAt) ŞEMA alanı ister = migration
//      = Aşama 2. Mevcut dedup yalnızca 1-günlük pencere + feedbacks:{none:{checkpoint}} ile
//      DOĞALDIR; günlük cron'da bir eşleşme her checkpoint için ~bir kez tetiklenir, ancak cron
//      restart/iki-kez-çalışma senaryosunda garanti DEĞİLDİR.
// AŞAMA 2'de: guard alanı eklenir + gerçek bildirim (mevcut sendFeedbackReminderEmail /
// notificationService deseni) aktifleştirilir.
export async function runCheckpointFeedbackReminderCron(): Promise<{
  due: Record<Checkpoint, number>;
  total: number;
}> {
  void logger.info('SYSTEM', 'Cron: Periyodik değerlendirme checkpoint kontrolü başladı');
  const checkpoints: Checkpoint[] = ['DAY_3', 'DAY_14', 'DAY_30'];
  const due: Record<Checkpoint, number> = { DAY_3: 0, DAY_14: 0, DAY_30: 0 };
  try {
    for (const cp of checkpoints) {
      const matches = await findMatchesDueForCheckpoint(cp);
      due[cp] = matches.length;
      if (matches.length > 0) {
        // LOG-ONLY: gerçek bildirim Aşama 2. Yönetici/geliştirici log'dan vadesi dolanları görür.
        void logger.info('SYSTEM', `Checkpoint ${cp}: değerlendirme vadesi dolan eşleşme`, {
          checkpoint: cp,
          dueCount: matches.length,
        });
      }
    }
    const total = due.DAY_3 + due.DAY_14 + due.DAY_30;
    void logger.info('SYSTEM', 'Cron: Periyodik değerlendirme checkpoint kontrolü tamamlandı', {
      total, ...due,
    });
    return { due, total };
  } catch (err) {
    void logger.error('SYSTEM', 'Cron: Periyodik değerlendirme checkpoint kontrolü başarısız', {
      error: String(err),
    });
    return { due, total: 0 };
  }
}

// ─── Görev: Yanıtsız Mentör Hatırlatma + Yönetici Eskalasyonu (AN-26) ─────────
//
// KARAR-53 ④: menti konuşma başlattı, mentör hiç yanıt vermedi →
//   3. gün mentöre 1. hatırlatma · 7. gün 2. hatırlatma · 10. gün kurum yöneticisine eskalasyon.
// Menti tarafına mesaj/alternatif mentör önerisi YOK (KARAR-22 B).
// "Yanıt vermedi" = konuşmada mentörün gönderdiği hiç mesaj yok.

export const MENTOR_REMINDER_CONFIG = {
  reminder1AfterDays: 3,
  reminder2AfterDays: 7,
  escalateAfterDays:  10,
  // Bu yaştan eski konuşmalara bakılmaz: yayın anında eski yanıtsız konuşmalara toplu e-posta
  // gitmesin; eskalasyon için 10-14. gün arası yeniden deneme penceresi kalır (SMTP/yönetici yoksa).
  maxAgeDays:         14,
} as const;

export type MentorReminderStage = 'none' | 'reminder1' | 'reminder2' | 'escalate';

export interface MentorReminderState {
  createdAt: Date;
  mentorHasReplied: boolean;
  mentorReminder1SentAt: Date | null;
  mentorReminder2SentAt: Date | null;
  adminEscalatedAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bu konuşma için bugün hangi aşama gönderilmeli? Saf fonksiyon.
 * Kural: yalnız VADESİ GELMİŞ EN GEÇ aşama düşünülür. Cron bir/birkaç gün çalışmadıysa atlanan
 * erken aşama sonradan gönderilmez (ör. 8. günde 1. hatırlatma artık anlamsız → yalnız 2.).
 * Daha geç bir aşama zaten gönderildiyse erken aşama da gönderilmez.
 */
export function computeMentorReminderStage(state: MentorReminderState, now: Date): MentorReminderStage {
  if (state.mentorHasReplied) return 'none';
  const ageDays = (now.getTime() - state.createdAt.getTime()) / DAY_MS;
  const cfg = MENTOR_REMINDER_CONFIG;
  if (ageDays > cfg.maxAgeDays) return 'none';

  if (ageDays >= cfg.escalateAfterDays) {
    return state.adminEscalatedAt ? 'none' : 'escalate';
  }
  if (ageDays >= cfg.reminder2AfterDays) {
    return state.mentorReminder2SentAt || state.adminEscalatedAt ? 'none' : 'reminder2';
  }
  if (ageDays >= cfg.reminder1AfterDays) {
    return state.mentorReminder1SentAt || state.mentorReminder2SentAt || state.adminEscalatedAt
      ? 'none'
      : 'reminder1';
  }
  return 'none';
}

export async function runMentorResponseReminderCron(now: Date = new Date()): Promise<{
  reminder1: number;
  reminder2: number;
  escalated: number;
  failed: number;
}> {
  void logger.info('SYSTEM', 'Cron: Yanıtsız mentör hatırlatması başladı');
  const result = { reminder1: 0, reminder2: 0, escalated: 0, failed: 0 };
  try {
    const cfg = MENTOR_REMINDER_CONFIG;
    const oldest = new Date(now.getTime() - cfg.maxAgeDays * DAY_MS);
    const youngest = new Date(now.getTime() - cfg.reminder1AfterDays * DAY_MS);

    // 1) Aday konuşmalar (tek sorgu). Son aşama zaten yazılmış olanlar baştan elenir.
    const candidates = await prisma.conversation.findMany({
      where: {
        createdAt:        { gte: oldest, lte: youngest },
        adminEscalatedAt: null,
        tenant:           { isActive: true },
      },
      select: {
        id: true, tenantId: true, mentorUserId: true, createdAt: true,
        mentorReminder1SentAt: true, mentorReminder2SentAt: true, adminEscalatedAt: true,
        mentor: { select: { email: true, fullName: true, isActive: true } },
      },
    });
    if (candidates.length === 0) {
      void logger.info('SYSTEM', 'Cron: Yanıtsız mentör hatırlatması tamamlandı', result);
      return result;
    }

    // 2) Mentör yanıt vermiş mi — N+1 yerine tek gruplu sorgu (konuşma × gönderen).
    const senders = await prisma.message.groupBy({
      by:    ['conversationId', 'senderUserId'],
      where: { conversationId: { in: candidates.map((c) => c.id) } },
    });
    const repliedKeys = new Set(senders.map((s) => `${s.conversationId}:${s.senderUserId}`));

    const planned = candidates
      .map((c) => ({
        conv: c,
        stage: computeMentorReminderStage({
          createdAt:             c.createdAt,
          mentorHasReplied:      repliedKeys.has(`${c.id}:${c.mentorUserId}`),
          mentorReminder1SentAt: c.mentorReminder1SentAt,
          mentorReminder2SentAt: c.mentorReminder2SentAt,
          adminEscalatedAt:      c.adminEscalatedAt,
        }, now),
      }))
      .filter((p) => p.stage !== 'none');

    // 3) Eskalasyon alıcıları — kurum-içi rol TenantMembership'ten (User.role DEĞİL); tek sorgu.
    const escalationTenantIds = [...new Set(planned.filter((p) => p.stage === 'escalate').map((p) => p.conv.tenantId))];
    const adminsByTenant = new Map<string, { email: string; fullName: string }[]>();
    if (escalationTenantIds.length > 0) {
      const adminMemberships = await prisma.tenantMembership.findMany({
        where:  { tenantId: { in: escalationTenantIds }, role: 'ADMIN', isActive: true, user: { isActive: true } },
        select: { tenantId: true, user: { select: { email: true, fullName: true } } },
      });
      for (const m of adminMemberships) {
        const list = adminsByTenant.get(m.tenantId) ?? [];
        list.push(m.user);
        adminsByTenant.set(m.tenantId, list);
      }
    }

    // 4) Gönder — guard alanı YALNIZ e-posta gerçekten gittiyse yazılır (U-16).
    // Log'a yalnız konuşma/kurum kimliği yazılır; e-posta, isim, mesaj içeriği YAZILMAZ.
    for (const { conv, stage } of planned) {
      try {
        if (stage === 'reminder1' || stage === 'reminder2') {
          if (!conv.mentor.isActive) continue;
          const ok = await sendMentorResponseReminderEmail({
            toEmail:        conv.mentor.email,
            mentorName:     conv.mentor.fullName,
            conversationId: conv.id,
            reminderNo:     stage === 'reminder1' ? 1 : 2,
          });
          if (!ok) {
            result.failed++;
            void logger.warn('EMAIL', 'Mentör hatırlatması gönderilemedi — işaretlenmedi', { conversationId: conv.id, stage });
            continue;
          }
          await prisma.conversation.update({
            where: { id: conv.id },
            data:  stage === 'reminder1' ? { mentorReminder1SentAt: now } : { mentorReminder2SentAt: now },
          });
          result[stage]++;
          continue;
        }

        // stage === 'escalate'
        const admins = adminsByTenant.get(conv.tenantId) ?? [];
        if (admins.length === 0) {
          void logger.warn('SYSTEM', 'Eskalasyon: kurumda aktif yönetici yok — işaretlenmedi', {
            conversationId: conv.id, tenantId: conv.tenantId,
          });
          continue;
        }
        const daysWaiting = Math.floor((now.getTime() - conv.createdAt.getTime()) / DAY_MS);
        let anySent = false;
        for (const admin of admins) {
          const ok = await sendMentorNoResponseEscalationEmail({
            toEmail:    admin.email,
            adminName:  admin.fullName,
            mentorName: conv.mentor.fullName,
            daysWaiting,
          });
          if (ok) anySent = true;
        }
        if (!anySent) {
          result.failed++;
          void logger.warn('EMAIL', 'Eskalasyon e-postası gönderilemedi — işaretlenmedi', { conversationId: conv.id });
          continue;
        }
        await prisma.conversation.update({ where: { id: conv.id }, data: { adminEscalatedAt: now } });
        result.escalated++;
      } catch (err) {
        result.failed++;
        void logger.error('SYSTEM', 'Yanıtsız mentör hatırlatması başarısız', { conversationId: conv.id, error: String(err) });
      }
    }

    void logger.info('SYSTEM', 'Cron: Yanıtsız mentör hatırlatması tamamlandı', result);
    return result;
  } catch (err) {
    void logger.error('SYSTEM', 'Cron: Yanıtsız mentör hatırlatması başarısız', { error: String(err) });
    return result;
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

  // Her 15 dakikada bir — Otomatik toplantı tamamlama (U-01, ÇIKIŞ BLOKERİ).
  // Sık aralık bilinçli: check-in/feedback toplantı biter bitmez açılmalı, günlük/haftalık
  // cron'lar (feedback hatırlatıcısı zaten en az 1 saat bekliyor) burada yetersiz kalırdı.
  cron.schedule('*/15 * * * *', () => {
    void runAutoCompleteMeetingsCron();
  }, { timezone: 'UTC' });

  // Her 6 saatte bir — Taslak tenant kurtarma e-postası (Faz 3)
  cron.schedule('0 */6 * * *', () => {
    void runDraftTenantReminder();
  }, { timezone: 'UTC' });

  // Her gün 04:00 UTC — Taslak tenant temizliği (Faz 3)
  cron.schedule('0 4 * * *', () => {
    void runDraftTenantCleanup();
  }, { timezone: 'UTC' });

  // Her gün 08:00 UTC — Periyodik değerlendirme checkpoint kontrolü (#7 Aşama 1, LOG-ONLY)
  cron.schedule('0 8 * * *', () => {
    void runCheckpointFeedbackReminderCron();
  }, { timezone: 'UTC' });

  // Her gün 09:00 UTC — Feedback hatırlatıcısı (feedbackPrompted=false koruması)
  cron.schedule('0 9 * * *', () => {
    void runFeedbackReminderCron();
  }, { timezone: 'UTC' });

  // Her gün 10:00 UTC — Anlaşma yenileme kontrolü (7 gün önceden bildirim)
  cron.schedule('0 10 * * *', () => {
    void runAgreementRenewalCron();
  }, { timezone: 'UTC' });

  // Her gün 11:00 UTC — Mentör sertifika yönetici bildirimi (geride kalan mentörler)
  cron.schedule('0 11 * * *', () => {
    void runMentorCertAdminNotifyCron();
  }, { timezone: 'UTC' });

  // Her gün 12:00 UTC (15:00 TR) — Yanıtsız mentör hatırlatma + yönetici eskalasyonu (AN-26).
  // 10:00 UTC anlaşma yenilemeyle çakışmasın diye ayrı saat; iş saatinde gelen e-posta daha görünür.
  cron.schedule('0 12 * * *', () => {
    void runMentorResponseReminderCron();
  }, { timezone: 'UTC' });

  console.log('[CRON] Haftalık görevler zamanlandı: Pazar 02:00 (tuning) + 03:00 (purge) UTC');
  console.log('[CRON] Faz 3 cron\'ları aktif: Her 6h (taslak reminder) + Her gün 04:00 (taslak temizlik) + 09:00 (feedback hatırlatıcı) UTC');
  console.log('[CRON] U-01: Her 15dk otomatik toplantı tamamlama aktif.');
}

// ─── Manuel tetikleme (admin endpoint'inden çağrılır) ────────────────────────

export { runWeeklyTuning, runWeeklyPurge, runDraftTenantReminder, runDraftTenantCleanup };
