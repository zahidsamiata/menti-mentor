import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from './logger.js';
import { escapeHtml, sanitizeHeaderText } from './htmlEscape.js';

// Generic SMTP relay (Resend/Brevo vb.). service:'gmail' KALDIRILDI: Gmail App
// Password kırılgan (Google periyodik iptal ediyor) ve gmail.com'dan sunucu gönderimi
// deliverability düşük. Sağlayıcı değişimi artık yalnızca env değişikliğidir.
const transporter = nodemailer.createTransport({
  host: config.email.smtpHost,
  port: config.email.smtpPort,
  secure: config.email.smtpSecure,
  // V-01/F-25: SMTP erişilemezse verify()/gönderim hızlı başarısız olsun (health/probe asılı kalmasın).
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

// ── SMTP durum görünürlüğü (V-01 / F-25) ────────────────────────────────────
// send() zaten sessiz başarısızlığı engelliyor; burada operatöre "mail çalışıyor mu"
// göstergesi için gerçek SMTP el sıkışması (verify) sonucu tutulur.
let smtpVerified: boolean | null = null; // null = henüz denenmedi

export type SmtpStatus = 'verified' | 'failed' | 'unconfigured' | 'unknown';

/**
 * Canlı SMTP el sıkışması (verify) yapar, sonucu önbelleğe alır. Hata FIRLATMAZ.
 * Başlangıçta bir kez (server.ts) ve platform sağlık ucunda (F-25) çağrılır.
 */
export async function verifyTransporter(): Promise<boolean> {
  if (!config.email.smtpHost || !config.email.smtpUser || !config.email.smtpPass) {
    smtpVerified = false;
    return false;
  }
  try {
    await transporter.verify();
    smtpVerified = true;
  } catch (err) {
    void logger.error('EMAIL', `SMTP verify başarısız: ${err instanceof Error ? err.message : String(err)}`);
    smtpVerified = false;
  }
  return smtpVerified;
}

/** Son verify sonucunu döndürür (önbellekli — /health'i yavaşlatmaz). */
export function getSmtpStatus(): SmtpStatus {
  if (!config.email.smtpHost || !config.email.smtpUser || !config.email.smtpPass) return 'unconfigured';
  if (smtpVerified === null) return 'unknown';
  return smtpVerified ? 'verified' : 'failed';
}

// Teslim edilemeyen (sahte/test) domainler — bunlara gönderim kaçınılmaz bounce üretir.
// Test/dev'de üretilen @test.local adresleri gerçek gönderen kutusunu bounce'la doldurur.
const UNDELIVERABLE_TLDS = ['.local', '.test', '.invalid', '.example'];

/** Alıcı adresi teslim edilemez bir domaine mi ait? Saf fonksiyon — birim testi kolay. */
export function isUndeliverableRecipient(to: string): boolean {
  const at = to.lastIndexOf('@');
  if (at === -1) return true; // '@' yoksa geçersiz adres
  const domain = to.slice(at + 1).trim().toLowerCase();
  if (!domain) return true;
  return UNDELIVERABLE_TLDS.some((tld) => domain.endsWith(tld));
}

/**
 * E-posta gönderir. Dönüş: gerçekten GÖNDERİLDİYSE true, atlandı/başarısızsa false (U-16).
 * Çağıranlar bu değere bakarak "gönderildi" yalanı üretmeyebilir ve tek-atımlık
 * hatırlatma bayrağını (reminderEmailSentAt) boşa yakmayabilir. Hata FIRLATMAZ.
 */
// GV-15: `html` parametresi HAZIR HTML'dir — çağıran, içine koyduğu kullanıcı/kurum
// kaynaklı her değeri `escapeHtml` (htmlEscape.ts) ile kaçırmakla yükümlüdür.
export async function send(to: string, subject: string, html: string): Promise<boolean> {
  // Sahte/teslim edilemez alıcıya gönderme — bounce üretmesin (her ortamda).
  // KVKK/log kuralı: e-posta adresi loglanmaz, yalnızca durum yazılır.
  if (isUndeliverableRecipient(to)) {
    void logger.info('EMAIL', 'Teslim edilemez/sahte alıcı — gönderim atlandı.');
    return false;
  }
  if (!config.email.smtpHost || !config.email.smtpUser || !config.email.smtpPass) {
    void logger.warn('EMAIL', 'SMTP yapılandırması eksik — e-posta gönderilmedi.');
    return false;
  }
  // Sessiz başarısızlığı önle: SMTP/auth hataları (ör. 535) görünür olmalı.
  try {
    // GV-15: konu düz metindir — satır sonu temizliği (başlık enjeksiyonu savunması).
    await transporter.sendMail({ from: config.email.from, to, subject: sanitizeHeaderText(subject), html });
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    void logger.error('EMAIL', `E-posta gönderilemedi: ${reason}`);
    return false;
  }
}

export async function sendMeetingRequestEmail(args: {
  toEmail: string;
  mentorName: string;
  mentiName: string;
  scheduledAt: Date;
}): Promise<void> {
  const tarih = escapeHtml(args.scheduledAt.toLocaleString('tr-TR'));
  await send(
    args.toEmail,
    'Yeni Görüşme Talebi',
    `<p>Merhaba ${escapeHtml(args.mentorName)},</p>
     <p><strong>${escapeHtml(args.mentiName)}</strong> sizinle <strong>${tarih}</strong> tarihinde bir görüşme talep etti.</p>
     <p>Lütfen sisteme giriş yaparak talebi onaylayın veya reddedin.</p>`,
  );
}

export async function sendMeetingApprovalEmail(args: {
  toEmail: string;
  mentiName: string;
  mentorName: string;
  scheduledAt: Date;
}): Promise<void> {
  const tarih = escapeHtml(args.scheduledAt.toLocaleString('tr-TR'));
  await send(
    args.toEmail,
    'Görüşme Talebiniz Onaylandı',
    `<p>Merhaba ${escapeHtml(args.mentiName)},</p>
     <p><strong>${escapeHtml(args.mentorName)}</strong>, <strong>${tarih}</strong> tarihli görüşme talebinizi onayladı.</p>
     <p>Görüşmeye hazırlıklı gelmeyi unutmayın!</p>`,
  );
}

export async function sendNewChatMessageEmail(args: {
  toEmail: string;
  recipientName: string;
  senderName: string;
}): Promise<void> {
  // Okundu-bazlı bildirim (alıcının okunmamışı yokken ilk yeni mesajda) tarafından çağrılır.
  // PII: mesaj METNİ e-postaya KONMAZ — yalnızca "yeni mesaj var" + gönderen adı.
  await send(
    args.toEmail,
    'Yeni mesajınız var',
    `<p>Merhaba ${escapeHtml(args.recipientName)},</p>
     <p><strong>${escapeHtml(args.senderName)}</strong> size yeni bir mesaj gönderdi.</p>
     <p>Mesajı okumak için sisteme giriş yapıp Mesajlar bölümüne gidin.</p>`,
  );
}

// IC-03: e-postada ham rol kodu (MENTOR/MENTI/ADMIN) yerine Türkçe ad. Bilinmeyen değer olduğu gibi.
const ROLE_LABELS: Record<string, string> = { ADMIN: 'Kurum Yöneticisi', MENTOR: 'Mentör', MENTI: 'Menti' };

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export async function sendAdminNewUserNotification(args: {
  toEmail: string;
  adminName: string;
  newUserFullName: string;
  newUserRole: string;
  tenantName: string;
}): Promise<void> {
  await send(
    args.toEmail,
    `[${args.tenantName}] Onay Bekleyen Yeni Kayıt`,
    `<p>Merhaba ${escapeHtml(args.adminName)},</p>
     <p><strong>${escapeHtml(args.newUserFullName)}</strong> adlı yeni bir <strong>${escapeHtml(roleLabel(args.newUserRole))}</strong> kaydı sisteme girdi.</p>
     <p>Kullanıcı eşleşme havuzuna dahil edilebilmesi için onayınızı bekliyor.</p>
     <p>Lütfen admin panelinizden inceleyip onaylayın veya reddedin.</p>`,
  );
}

export async function sendUserApprovalNotification(args: {
  toEmail: string;
  userName: string;
  approved: boolean;
  // Red/düzeltme gerekçesi (varsa) — kibar, destekleyici tonla eklenir.
  rejectionReason?: string | null;
}): Promise<void> {
  const subject = args.approved ? 'Kaydınız Onaylandı' : 'Başvurunuz Hakkında';
  const reasonBlock =
    !args.approved && args.rejectionReason
      ? `<p><strong>Güncellenmesi gerekenler:</strong> ${escapeHtml(args.rejectionReason)}</p>`
      : '';
  const body = args.approved
    ? `<p>Merhaba ${escapeHtml(args.userName)},</p><p>Kaydınız onaylandı. Artık mentorluk eşleşme havuzuna dahilsiniz. Sisteme giriş yapabilirsiniz.</p>`
    : `<p>Merhaba ${escapeHtml(args.userName)},</p>` +
      `<p>Başvurunuz şu an onaylanmadı. Aşağıdaki notu dikkate alarak <strong>dilerseniz tekrar başvurabilirsiniz</strong> — daha önce doldurduğunuz test ve profil bilgileriniz korunur, baştan yapmanız gerekmez.</p>` +
      reasonBlock +
      `<p>İlginiz için teşekkür ederiz.</p>`;
  await send(args.toEmail, subject, body);
}

export async function sendPasswordResetEmail(args: {
  toEmail: string;
  userName: string;
  rawToken: string;
}): Promise<void> {
  const resetUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:3001'}/reset-password?token=${encodeURIComponent(args.rawToken)}`;
  await send(
    args.toEmail,
    'Şifre Sıfırlama Talebi',
    `<p>Merhaba ${escapeHtml(args.userName)},</p>
     <p>Şifrenizi sıfırlamak için aşağıdaki bağlantıya tıklayın:</p>
     <p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
     <p>Bu bağlantı <strong>60 dakika</strong> geçerlidir.</p>
     <p>Bu talebi siz yapmadıysanız bu e-postayı güvenle yoksayabilirsiniz.</p>`,
  );
}

export async function sendAdminTestCompletedNotification(args: {
  toEmail: string;
  adminName: string;
  userName: string;
  userRole: string;
  tenantName: string;
}): Promise<void> {
  await send(
    args.toEmail,
    `[${args.tenantName}] Kullanıcı DISC Testini Tamamladı — Onay Bekliyor`,
    `<p>Merhaba ${escapeHtml(args.adminName)},</p>
     <p><strong>${escapeHtml(args.userName)}</strong> (${escapeHtml(roleLabel(args.userRole))}) DISC karakter analizini tamamladı.</p>
     <p>Kullanıcı eşleşme havuzuna dahil edilebilmesi için onayınızı bekliyor.</p>
     <p>Lütfen admin panelinizden inceleyip onaylayın veya reddedin.</p>`,
  );
}

export async function sendAlgorithmAdjustmentProposal(args: {
  toEmail: string;
  adminName: string;
  tenantName: string;
  tenantId: string;
  reason: string;
  phase1Nps: number | null;
  phase3Nps: number | null;
  prevSector: number; prevDisc: number;
  newSector: number;  newDisc: number;
}): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';
  const approveUrl = `${frontendUrl}/admin/algorithm-tuner?action=approve&tenantId=${encodeURIComponent(args.tenantId)}`;
  const rejectUrl  = `${frontendUrl}/admin/algorithm-tuner?action=reject&tenantId=${encodeURIComponent(args.tenantId)}`;

  await send(
    args.toEmail,
    `[${args.tenantName}] Algoritma Kalibrasyon Önerisi — Onayınız Bekleniyor`,
    `<p>Merhaba ${escapeHtml(args.adminName)},</p>
     <p>Bu hafta eşleştirme algoritmanız analiz edildi. Aşağıdaki kalibrasyon önerilmektedir:</p>
     <table style="border-collapse:collapse;width:100%">
       <tr><th style="text-align:left;padding:8px;background:#f3f4f6">Kriter</th><th style="padding:8px;background:#f3f4f6">Önceki</th><th style="padding:8px;background:#f3f4f6">Önerilen</th></tr>
       <tr><td style="padding:8px">Sektör Ağırlığı</td><td style="padding:8px">%${escapeHtml(args.prevSector)}</td><td style="padding:8px"><strong>%${escapeHtml(args.newSector)}</strong></td></tr>
       <tr><td style="padding:8px">Karakter/DISC Ağırlığı</td><td style="padding:8px">%${escapeHtml(args.prevDisc)}</td><td style="padding:8px"><strong>%${escapeHtml(args.newDisc)}</strong></td></tr>
     </table>
     <p><strong>Neden bu öneri?</strong><br>${escapeHtml(args.reason)}</p>
     <p>NPS Verileri: 1. ay = ${escapeHtml(args.phase1Nps ?? 'Yetersiz veri')} | 3. ay = ${escapeHtml(args.phase3Nps ?? 'Yetersiz veri')}</p>
     <p>Bu değişiklik küçük (±%5) ve geri alınabilir. Son karar sizindir.</p>
     <p>
       <a href="${escapeHtml(approveUrl)}" style="background:#6366f1;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;margin-right:8px">✅ Onayla</a>
       <a href="${escapeHtml(rejectUrl)}"  style="background:#ef4444;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px">❌ Reddet</a>
     </p>`,
  );
}

/**
 * Faz 3 — Taslak kurtarma e-postası.
 * Yalnızca onboardingStep in ['TEMPLATE','LOGO','PREVIEW'] olan tenant adminlerine gönderilir.
 * Step4 geçilmiş = e-posta + KVKK onayı alınmıştır.
 * KVKK zorunluluğu: her e-postada unsubscribe linki bulunmalı.
 */
export async function sendDraftTenantReminderEmail(args: {
  toEmail:          string;
  adminName:        string;
  tenantName:       string;
  unsubscribeToken: string;
}): Promise<boolean> {
  const frontendUrl    = process.env['FRONTEND_URL'] ?? 'http://localhost:3001';
  // BACKEND_URL kullan: /api/tenants/unsubscribe bir backend route'u.
  // Tek-domain deploy'da FRONTEND_URL ile aynı; ayrı-domain deploy'da farklı olabilir.
  const backendUrl     = process.env['BACKEND_URL'] ?? process.env['FRONTEND_URL'] ?? 'http://localhost:3000';
  const resumeUrl      = `${frontendUrl}/onboarding/stk`;
  const unsubscribeUrl = `${backendUrl}/api/tenants/unsubscribe?token=${encodeURIComponent(args.unsubscribeToken)}`;

  return send(
    args.toEmail,
    `${args.tenantName} — Programınızı Tamamlamayı Unutmayın`,
    `<p>Merhaba ${escapeHtml(args.adminName)},</p>
     <p><strong>${escapeHtml(args.tenantName)}</strong> için kurulum sürecinizi başlattınız ancak henüz tamamlamadınız.</p>
     <p>Birkaç adım kaldı — programınızı aktive etmek için:</p>
     <p><a href="${escapeHtml(resumeUrl)}" style="background:#6366f1;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block">Kuruluma Devam Et →</a></p>
     <p style="margin-top:32px;font-size:12px;color:#6b7280">
       Bu e-postayı almak istemiyorsanız
       <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280">buraya tıklayarak</a> abonelikten çıkabilirsiniz.
     </p>`,
  );
}

export async function sendAlreadyRegisteredEmail(args: {
  toEmail: string;
  userName: string;
}): Promise<boolean> {
  return send(
    args.toEmail,
    'Hesabınızla İlgili Bilgilendirme',
    `<p>Merhaba ${escapeHtml(args.userName)},</p>
     <p>E-posta adresinizle yeni bir hesap oluşturulmaya çalışıldı. Zaten bir hesabınız bulunmaktadır — giriş yapmak için <a href="${escapeHtml(`${config.frontendBaseUrl}/login`)}">buraya tıklayın</a>.</p>
     <p>Eğer bu işlemi siz yapmadıysanız herhangi bir şey yapmanıza gerek yok; hesabınız güvende.</p>`,
  );
}

// Not: Mentöre otomatik sertifika hatırlatma maili KALDIRILDI (maliyet). Yerine STK
// yöneticisine uygulama-içi bildirim kullanılıyor (notificationService.notifyAdminsMentorCertLapsed).
// İleride kurum kendi mail hesabından göndermek isterse buraya bir e-posta fonksiyonu eklenebilir.

/**
 * Yönetici "dürtme"si — pasif üyeye / hareketsiz eşleşmeye nazik re-engagement hatırlatması.
 * İçerik kullanıcıyı geri dâvet eder; suçlayıcı/spam dili yok.
 */
export async function sendNudgeReminderEmail(args: {
  toEmail: string;
  recipientName: string;
  tenantName: string;
  message?: string; // yöneticinin eklediği kısa kişisel not (opsiyonel)
}): Promise<void> {
  const extra = args.message
    ? `<p style="padding:12px;border-left:3px solid #ccc;color:#444;">${escapeHtml(args.message)}</p>`
    : '';
  await send(
    args.toEmail,
    `${args.tenantName} — seni aramızda görmek isteriz`,
    `<p>Merhaba ${escapeHtml(args.recipientName)},</p>
     <p><strong>${escapeHtml(args.tenantName)}</strong> mentörlük programında bir süredir seni göremedik.
        Kaldığın yerden devam etmek için harika bir zaman!</p>
     ${extra}
     <p>Panele giriş yaparak eşleşmeni ilerletebilir, görüşme planlayabilirsin.</p>`,
  );
}

export async function sendFeedbackReminderEmail(args: {
  toEmail: string;
  recipientName: string;
  meetingId: string;
  scheduledAt: Date;
}): Promise<boolean> {
  const tarih = escapeHtml(args.scheduledAt.toLocaleString('tr-TR'));
  return send(
    args.toEmail,
    'Görüşme Geri Bildiriminizi Bekliyoruz',
    `<p>Merhaba ${escapeHtml(args.recipientName)},</p>
     <p>${tarih} tarihli görüşme için henüz geri bildirim vermediniz.</p>
     <p>Birkaç dakikanızı ayırarak değerlendirmenizi tamamlamanız, eşleşme kalitesini artırmaktadır.</p>`,
  );
}

// AN-09: public şüphe formundan yeni kayıt geldiğinde platform yöneticisine haber verir.
// Bilinçli olarak YALNIZ kayıt no gider — bildirenin adı/iletişimi/açıklaması e-postaya (ve SMTP sağlayıcısına)
// konmaz; içerik platform panelinde okunur.
export async function sendSuspicionReportAlert(args: { toEmail: string; reportId: string }): Promise<boolean> {
  return send(
    args.toEmail,
    'Yeni şüphe bildirimi',
    `<p>Platforma yeni bir şüphe bildirimi geldi (kayıt no: <strong>${escapeHtml(args.reportId)}</strong>).</p>
     <p>Kişisel verilerin korunması için bildirimin içeriği bu e-postaya eklenmedi.
     Lütfen platform panelindeki şüphe bildirimleri bölümünden inceleyin.</p>`,
  );
}

// AN-26 (KARAR-53 ④): menti mesaj talebi başlattı, mentör henüz yanıt vermedi → mentöre nazik hatırlatma
// (3. ve 7. gün). Menti adı ve mesaj METNİ e-postaya KONMAZ — yalnız "bir menti" + konuşma bağlantısı.
export async function sendMentorResponseReminderEmail(args: {
  toEmail: string;
  mentorName: string;
  conversationId: string;
  reminderNo: 1 | 2;
}): Promise<boolean> {
  const conversationUrl = `${config.frontendBaseUrl}/messages/${encodeURIComponent(args.conversationId)}`;
  const opening = args.reminderNo === 1
    ? 'Bir menti birkaç gün önce size mesaj gönderdi ve yanıtınızı bekliyor.'
    : 'Bir menti yaklaşık bir haftadır yanıtınızı bekliyor.';
  return send(
    args.toEmail,
    'Bir menti yanıtınızı bekliyor',
    `<p>Merhaba ${escapeHtml(args.mentorName)},</p>
     <p>${opening}</p>
     <p>Kısa bir yanıt bile menti için çok değerli. Uygun değilseniz bunu nazikçe belirtmeniz de yeterli.</p>
     <p><a href="${escapeHtml(conversationUrl)}">Konuşmayı açmak için tıklayın</a></p>`,
  );
}

// AN-26 (KARAR-53 ④): 10 gündür yanıtsız kalan talep → kurum yöneticisine eskalasyon.
// Yalnız mentör adı + bekleme süresi; menti adı ve mesaj içeriği KONMAZ (veri minimizasyonu).
export async function sendMentorNoResponseEscalationEmail(args: {
  toEmail: string;
  adminName: string;
  mentorName: string;
  daysWaiting: number;
}): Promise<boolean> {
  return send(
    args.toEmail,
    'Yanıt bekleyen bir mentorluk talebi var',
    `<p>Merhaba ${escapeHtml(args.adminName)},</p>
     <p>Mentör <strong>${escapeHtml(args.mentorName)}</strong>, bir mentinin mesaj talebine
        <strong>${escapeHtml(args.daysWaiting)} gündür</strong> yanıt vermedi.</p>
     <p>Uygun görürseniz mentörle kısaca iletişime geçebilirsiniz.</p>`,
  );
}
