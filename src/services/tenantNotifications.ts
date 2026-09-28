/**
 * Kurum (STK) başvuru bildirimleri — #37 (onay / red / düzeltme-iste).
 *
 * ⚠️ GÖNDERİM BAYRAK ARKASINDA KAPALI (config.email.tenantNotificationsEnabled, varsayılan false).
 * Bayrak kapalıyken GERÇEK MAİL GİTMEZ — yalnızca "şu kuruma şu bildirim gidecekti" log'lanır.
 * Sebep: `destek@` adresi + prod SMTP env henüz kurulmadı; ürün sahibi kurunca env'i `true`
 * yapıp açacak. Canlıya istenmeyen mail gitmesi geri alınamaz → bilinçli opt-in.
 *
 * Dil: Türkçe, destekleyici (özellikle red ve düzeltme "reddedildiniz" hissi vermez —
 * "bilgilerinizi güncelleyin" tonu). Kurum yöneticisinin e-postası tenant'ın ADMIN üyesinden
 * bulunur (tenant-scoped). KVKK: e-posta adresi log'a YAZILMAZ, yalnız tenantId + durum.
 */

import { prisma } from '../db.js';
import { config } from '../config.js';
import { logger } from './logger.js';
import { USER_CONTACT_SELECT } from '../utils/userSelect.js';
import { send as sendEmail } from './emailService.js';
import { escapeHtml } from './htmlEscape.js';
import { findTenantAdminUsers } from './membership.js';

export type TenantNotificationKind = 'APPROVED' | 'REJECTED' | 'CORRECTION_REQUESTED';

/**
 * KARAR-23 (PO, 2026-09-21): kuruma yalnız ONAY ve DÜZELTME e-postası gider; RET e-postası GÖNDERİLMEZ
 * ("ret maili kırıcı olabilir" — reddedilen kurum durumu yalnız uygulama içinde görür, U-04).
 * REJECTED şablonu (buildTenantNotification) silinmedi: karar değişirse bu kümeye eklemek yeter.
 */
const EMAILED_TENANT_NOTIFICATION_KINDS: ReadonlySet<TenantNotificationKind> = new Set([
  'APPROVED',
  'CORRECTION_REQUESTED',
]);

/** Bu bildirim türü kuruma e-postayla gider mi? (KARAR-23) Saf fonksiyon — test edilebilir. */
export function isTenantNotificationEmailed(kind: TenantNotificationKind): boolean {
  return EMAILED_TENANT_NOTIFICATION_KINDS.has(kind);
}

interface TenantNotificationArgs {
  tenantId: string;
  kind: TenantNotificationKind;
  /** Red gerekçesi veya düzeltme notu (varsa) — kuruma destekleyici tonla iletilir. */
  note?: string;
}

/** Bildirim türüne göre Türkçe e-posta konusu + gövdesi. Saf fonksiyon — test edilebilir. */
export function buildTenantNotification(args: {
  kind: TenantNotificationKind;
  tenantName: string;
  adminName: string;
  note?: string;
}): { subject: string; html: string } {
  const { kind, tenantName, adminName, note } = args;
  // GV-15: konu düz metin (ham ad); HTML gövdesine giren kurum/yönetici adı ve not kaçırılır.
  const safeTenantName = escapeHtml(tenantName);
  const greeting = `<p>Merhaba ${escapeHtml(adminName)},</p>`;

  if (kind === 'APPROVED') {
    return {
      subject: `[${tenantName}] Başvurunuz Onaylandı`,
      html:
        greeting +
        `<p><strong>${safeTenantName}</strong> kurum başvurunuz onaylandı. Artık platformu kullanmaya başlayabilir, ` +
        `mentör ve menti davetleri gönderebilirsiniz.</p>` +
        `<p>Aramıza hoş geldiniz!</p>`,
    };
  }

  if (kind === 'CORRECTION_REQUESTED') {
    const noteBlock = note ? `<p><strong>Güncellenmesi istenenler:</strong> ${escapeHtml(note)}</p>` : '';
    return {
      subject: `[${tenantName}] Başvurunuz Hakkında — Bilgi Güncellemesi`,
      html:
        greeting +
        `<p><strong>${safeTenantName}</strong> kurum başvurunuzu inceledik. Başvurunuzu tamamlayabilmemiz için ` +
        `bazı bilgileri güncellemenizi rica ediyoruz — <strong>başvurunuz reddedilmedi</strong>, yalnızca ` +
        `küçük bir düzenleme gerekiyor.</p>` +
        noteBlock +
        `<p>Panelinize giriş yapıp bilgilerinizi güncelledikten sonra başvurunuz yeniden incelemeye alınacaktır. ` +
        `Daha önce girdiğiniz bilgiler korunur, baştan doldurmanız gerekmez.</p>` +
        `<p>İlginiz için teşekkür ederiz.</p>`,
    };
  }

  // REJECTED — destekleyici dil
  const noteBlock = note ? `<p><strong>Değerlendirme notu:</strong> ${escapeHtml(note)}</p>` : '';
  return {
    subject: `[${tenantName}] Başvurunuz Hakkında`,
    html:
      greeting +
      `<p><strong>${safeTenantName}</strong> kurum başvurunuz şu aşamada onaylanamadı.</p>` +
      noteBlock +
      `<p>Sorularınız veya itirazınız için bizimle iletişime geçebilirsiniz. İlginiz için teşekkür ederiz.</p>`,
  };
}

/**
 * Kuruma başvuru bildirimi gönderir — ANCAK gönderim bayrağı (tenantNotificationsEnabled)
 * kapalıysa GERÇEK MAİL GİTMEZ, yalnız log'lanır. Non-fatal: hata ana akışı bozmaz.
 */
export async function notifyTenantVerification(args: TenantNotificationArgs): Promise<void> {
  // KARAR-23: ret e-postası gönderilmez — bayrak açık olsa bile. Yalnız log (KVKK: adres yok).
  if (!isTenantNotificationEmailed(args.kind)) {
    void logger.info('EMAIL', 'Kurum bildirimi e-postayla gönderilmez (KARAR-23).', {
      tenantId: args.tenantId,
      kind: args.kind,
    });
    return;
  }
  try {
    // Kurum yöneticisini (ADMIN) + kurum adını bul — tenant-scoped, minimum alan.
    // AJ-105: ilk yönetici = bu kurumun en eski AKTİF ADMIN üyesi (User.role + ana kurum değil).
    const [tenant, [admin]] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: args.tenantId },
        select: { name: true, displayName: true },
      }),
      findTenantAdminUsers(args.tenantId, USER_CONTACT_SELECT),
    ]);
    if (!tenant || !admin) {
      void logger.warn('EMAIL', 'Kurum bildirimi: yönetici bulunamadı — atlandı.', {
        tenantId: args.tenantId,
        kind: args.kind,
      });
      return;
    }

    const tenantName = tenant.displayName ?? tenant.name;
    const { subject, html } = buildTenantNotification({
      kind: args.kind,
      tenantName,
      adminName: admin.fullName,
      note: args.note,
    });

    // 🚦 GÖNDERİM BAYRAĞI — kapalıyken gerçek mail YOK, yalnız log (KVKK: e-posta adresi loglanmaz).
    if (!config.email.tenantNotificationsEnabled) {
      void logger.info('EMAIL', 'Kurum bildirimi hazır ama gönderim KAPALI (log-only).', {
        tenantId: args.tenantId,
        kind: args.kind,
        subject,
      });
      return;
    }

    await sendEmail(admin.email, subject, html);
    void logger.info('EMAIL', 'Kurum bildirimi gönderildi.', { tenantId: args.tenantId, kind: args.kind });
  } catch (err) {
    // Non-fatal: bildirim ana onay/red/düzeltme akışını bozmaz.
    const reason = err instanceof Error ? err.message : String(err);
    void logger.error('EMAIL', `Kurum bildirimi başarısız: ${reason}`, { tenantId: args.tenantId, kind: args.kind });
  }
}
