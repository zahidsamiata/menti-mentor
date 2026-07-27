/**
 * Push Bildirim Servisi (Sprint 7 — Stub Arayüzü)
 *
 * Şu an: Bildirimler SystemLog'a yazılır ve konsola yazdırılır.
 * Production geçişi için:
 *   - Expo Push API: expo-server-sdk paketi + User.pushToken alanı (schema)
 *   - FCM: firebase-admin paketi + User.fcmToken alanı
 *   - Taşıyıcıyı değiştirmek için sadece sendPushNotification() implementasyonu güncellenir.
 *
 * Compliance Note: Bildirim içeriği PII içermemeli.
 * userId log'a yazılır ancak tam isim veya email yazılmaz.
 */

import { logger } from './logger.js';

// ─── Tip tanımları ────────────────────────────────────────────────────────────

export type NotificationChannel = 'push' | 'email' | 'in_app';

export type NotificationPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;  // deep-link veya action parametresi
};

export type NotificationResult = {
  userId: string;
  channel: NotificationChannel;
  sent: boolean;
  reason?: string;   // başarısızlık nedeni
};

// ─── Temel gönderim fonksiyonu (stub) ────────────────────────────────────────

/**
 * Stub implementasyon — gerçek push provider entegre edilene kadar log'a yazar.
 * Compliance: userId dışında PII loglanmaz.
 */
async function sendPushNotification(
  userId: string,
  payload: NotificationPayload,
): Promise<NotificationResult> {
  void logger.info('SYSTEM', `[PUSH-STUB] Bildirim kuyruğa eklendi`, {
    userId,
    title: payload.title,
    hasData: Boolean(payload.data),
  });

  // TODO: Gerçek implementasyon için:
  // const pushToken = await getUserPushToken(userId);
  // if (!pushToken) return { userId, channel: 'push', sent: false, reason: 'Token yok' };
  // await expoPush.sendPushNotificationsAsync([{ to: pushToken, ...payload }]);

  return { userId, channel: 'push', sent: true };
}

// ─── Uygulama olayları ────────────────────────────────────────────────────────

/** Menti, mentor tarafından onaylandığında gönderilir (Akış A veya B). */
export async function notifyVisibilityApproved(
  mentiId: string,
  tenantId: string,
): Promise<NotificationResult> {
  return sendPushNotification(mentiId, {
    title: 'Mentorünüz Sizi Onayladı',
    body: 'Profiliniz mentor tarafından onaylandı. Artık eşleşme isteği gönderebilirsiniz.',
    data: { action: 'OPEN_MATCHES', tenantId },
  });
}

/** Mentor, menti'nin görünürlük talebini aldığında gönderilir (Akış B). */
export async function notifyPendingVisibilityRequest(
  mentorId: string,
  tenantId: string,
): Promise<NotificationResult> {
  return sendPushNotification(mentorId, {
    title: 'Yeni Görünürlük Talebi',
    body: 'Bir menti profilinizi görmek için talepte bulundu. İncelemenizi bekliyor.',
    data: { action: 'OPEN_PENDING_REQUESTS', tenantId },
  });
}

/** MatchRequest oluşturulduğunda mentora bildirim gönderilir. */
export async function notifyMatchRequestReceived(
  mentorId: string,
  tenantId: string,
): Promise<NotificationResult> {
  return sendPushNotification(mentorId, {
    title: 'Yeni Eşleşme İsteği',
    body: 'Bir menti sizinle eşleşmek istiyor.',
    data: { action: 'OPEN_MATCH_REQUESTS', tenantId },
  });
}

/** Yeni PENDING kullanıcı oluşturulduğunda tenant admin'lerine toplu bildirim gönderilir. */
export async function notifyAdminsPendingUser(args: {
  tenantId: string;
  newUserFullName: string;
  newUserRole: string;
}): Promise<void> {
  await sendPushNotification(`ADMINS:${args.tenantId}`, {
    title: 'Onay Bekleyen Yeni Kayıt',
    body: `${args.newUserFullName} (${args.newUserRole}) sisteme katıldı. Onayınızı bekliyor.`,
    data: { action: 'OPEN_PENDING_USERS', tenantId: args.tenantId },
  });
}

/**
 * Mentör sertifika hazırlığında geciktiğinde STK yöneticilerine SESSİZ uygulama-içi
 * bildirim (mail DEĞİL — sıfır maliyet). Yönetici mentörü kişisel olarak hatırlatır.
 * Mentör bu bildirimin gönderildiğini BİLMEZ.
 */
export async function notifyAdminsMentorCertLapsed(args: {
  tenantId: string;
  mentorName: string;
}): Promise<NotificationResult> {
  return sendPushNotification(`ADMINS:${args.tenantId}`, {
    title: 'Bir mentör sertifika hazırlığına başlamadı',
    body: `${args.mentorName} mentör sertifika hazırlığını henüz tamamlamadı. Uygun bir anda kişisel olarak hatırlatmanız yardımcı olabilir.`,
    data: { action: 'OPEN_MENTOR_LIST', tenantId: args.tenantId },
  });
}

/** Rematch talebi oluşturulduğunda mentora bildirim gönderilir. */
export async function notifyRematchRequested(
  targetId: string,
  tenantId: string,
): Promise<NotificationResult> {
  return sendPushNotification(targetId, {
    title: 'Yeniden Eşleşme Talebi',
    body: 'Bir kullanıcı yeniden eşleşme talep etti.',
    data: { action: 'OPEN_REMATCH_REQUESTS', tenantId },
  });
}
