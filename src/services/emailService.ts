import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from './logger.js';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.email.smtpUser,
    pass: config.email.smtpPass,
  },
});

async function send(to: string, subject: string, html: string): Promise<void> {
  if (!config.email.smtpUser || !config.email.smtpPass) {
    void logger.warn('EMAIL', 'SMTP yapılandırması eksik — e-posta gönderilmedi.');
    return;
  }
  await transporter.sendMail({ from: config.email.from, to, subject, html });
}

export async function sendMeetingRequestEmail(args: {
  toEmail: string;
  mentorName: string;
  mentiName: string;
  scheduledAt: Date;
}): Promise<void> {
  const tarih = args.scheduledAt.toLocaleString('tr-TR');
  await send(
    args.toEmail,
    'Yeni Toplantı Talebi',
    `<p>Merhaba ${args.mentorName},</p>
     <p><strong>${args.mentiName}</strong> sizinle <strong>${tarih}</strong> tarihinde bir toplantı talep etti.</p>
     <p>Lütfen sisteme giriş yaparak talebi onaylayın veya reddedin.</p>`,
  );
}

export async function sendMeetingApprovalEmail(args: {
  toEmail: string;
  mentiName: string;
  mentorName: string;
  scheduledAt: Date;
}): Promise<void> {
  const tarih = args.scheduledAt.toLocaleString('tr-TR');
  await send(
    args.toEmail,
    'Toplantı Talebiniz Onaylandı',
    `<p>Merhaba ${args.mentiName},</p>
     <p><strong>${args.mentorName}</strong>, <strong>${tarih}</strong> tarihli toplantı talebinizi onayladı.</p>
     <p>Toplantıya hazırlıklı gelmeyi unutmayın!</p>`,
  );
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
    `<p>Merhaba ${args.adminName},</p>
     <p><strong>${args.newUserFullName}</strong> adlı yeni bir <strong>${args.newUserRole}</strong> kaydı sisteme girdi.</p>
     <p>Kullanıcı eşleşme havuzuna dahil edilebilmesi için onayınızı bekliyor.</p>
     <p>Lütfen admin panelinizden inceleyip onaylayın veya reddedin.</p>`,
  );
}

export async function sendUserApprovalNotification(args: {
  toEmail: string;
  userName: string;
  approved: boolean;
}): Promise<void> {
  const subject = args.approved ? 'Kaydınız Onaylandı' : 'Kaydınız Hakkında Bilgilendirme';
  const body = args.approved
    ? `<p>Merhaba ${args.userName},</p><p>Kaydınız onaylandı. Artık mentorluk eşleşme havuzuna dahilsiniz. Sisteme giriş yapabilirsiniz.</p>`
    : `<p>Merhaba ${args.userName},</p><p>Kaydınız incelendi ancak şu an topluluk kriterlerimizle tam örtüşmediğini gördük. Gösterdiğiniz ilgi için teşekkür ederiz.</p>`;
  await send(args.toEmail, subject, body);
}

export async function sendPasswordResetEmail(args: {
  toEmail: string;
  userName: string;
  rawToken: string;
}): Promise<void> {
  const resetUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:3001'}/reset-password?token=${args.rawToken}`;
  await send(
    args.toEmail,
    'Şifre Sıfırlama Talebi',
    `<p>Merhaba ${args.userName},</p>
     <p>Şifrenizi sıfırlamak için aşağıdaki bağlantıya tıklayın:</p>
     <p><a href="${resetUrl}">${resetUrl}</a></p>
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
    `<p>Merhaba ${args.adminName},</p>
     <p><strong>${args.userName}</strong> (${args.userRole}) DISC karakter analizini tamamladı.</p>
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
  const approveUrl = `${frontendUrl}/admin/algorithm-tuner?action=approve&tenantId=${args.tenantId}`;
  const rejectUrl  = `${frontendUrl}/admin/algorithm-tuner?action=reject&tenantId=${args.tenantId}`;

  await send(
    args.toEmail,
    `[${args.tenantName}] Algoritma Kalibrasyon Önerisi — Onayınız Bekleniyor`,
    `<p>Merhaba ${args.adminName},</p>
     <p>Bu hafta eşleştirme algoritmanız analiz edildi. Aşağıdaki kalibrasyon önerilmektedir:</p>
     <table style="border-collapse:collapse;width:100%">
       <tr><th style="text-align:left;padding:8px;background:#f3f4f6">Kriter</th><th style="padding:8px;background:#f3f4f6">Önceki</th><th style="padding:8px;background:#f3f4f6">Önerilen</th></tr>
       <tr><td style="padding:8px">Sektör Ağırlığı</td><td style="padding:8px">%${args.prevSector}</td><td style="padding:8px"><strong>%${args.newSector}</strong></td></tr>
       <tr><td style="padding:8px">Karakter/DISC Ağırlığı</td><td style="padding:8px">%${args.prevDisc}</td><td style="padding:8px"><strong>%${args.newDisc}</strong></td></tr>
     </table>
     <p><strong>Neden bu öneri?</strong><br>${args.reason}</p>
     <p>NPS Verileri: 1. ay = ${args.phase1Nps ?? 'Yetersiz veri'} | 3. ay = ${args.phase3Nps ?? 'Yetersiz veri'}</p>
     <p>Bu değişiklik küçük (±%5) ve geri alınabilir. Son karar sizindir.</p>
     <p>
       <a href="${approveUrl}" style="background:#6366f1;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;margin-right:8px">✅ Onayla</a>
       <a href="${rejectUrl}"  style="background:#ef4444;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px">❌ Reddet</a>
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
}): Promise<void> {
  const frontendUrl    = process.env['FRONTEND_URL'] ?? 'http://localhost:3001';
  // BACKEND_URL kullan: /api/tenants/unsubscribe bir backend route'u.
  // Tek-domain deploy'da FRONTEND_URL ile aynı; ayrı-domain deploy'da farklı olabilir.
  const backendUrl     = process.env['BACKEND_URL'] ?? process.env['FRONTEND_URL'] ?? 'http://localhost:3000';
  const resumeUrl      = `${frontendUrl}/onboarding/stk`;
  const unsubscribeUrl = `${backendUrl}/api/tenants/unsubscribe?token=${args.unsubscribeToken}`;

  await send(
    args.toEmail,
    `${args.tenantName} — Programınızı Tamamlamayı Unutmayın`,
    `<p>Merhaba ${args.adminName},</p>
     <p><strong>${args.tenantName}</strong> için kurulum sürecinizi başlattınız ancak henüz tamamlamadınız.</p>
     <p>Birkaç adım kaldı — programınızı aktive etmek için:</p>
     <p><a href="${resumeUrl}" style="background:#6366f1;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block">Kuruluma Devam Et →</a></p>
     <p style="margin-top:32px;font-size:12px;color:#6b7280">
       Bu e-postayı almak istemiyorsanız
       <a href="${unsubscribeUrl}" style="color:#6b7280">buraya tıklayarak</a> abonelikten çıkabilirsiniz.
     </p>`,
  );
}

export async function sendFeedbackReminderEmail(args: {
  toEmail: string;
  recipientName: string;
  meetingId: string;
  scheduledAt: Date;
}): Promise<void> {
  const tarih = args.scheduledAt.toLocaleString('tr-TR');
  await send(
    args.toEmail,
    'Toplantı Geri Bildiriminizi Bekliyoruz',
    `<p>Merhaba ${args.recipientName},</p>
     <p>${tarih} tarihli toplantı için henüz geri bildirim vermediniz.</p>
     <p>Birkaç dakikanızı ayırarak değerlendirmenizi tamamlamanız, eşleşme kalitesini artırmaktadır.</p>`,
  );
}
