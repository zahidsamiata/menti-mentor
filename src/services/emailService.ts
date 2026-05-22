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
