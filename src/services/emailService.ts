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
