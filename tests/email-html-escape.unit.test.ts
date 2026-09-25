/**
 * GV-15 — e-posta HTML gövdesinde kullanıcı/kurum kaynaklı metin kaçırılır.
 * DB'siz birim testi: nodemailer, config, logger ve db mock'lanır; gönderilen html yakalanır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn().mockResolvedValue({}) }));
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail, verify: vi.fn() }) },
  createTransport: () => ({ sendMail, verify: vi.fn() }),
}));
vi.mock('../src/config.js', () => ({
  config: {
    email: { smtpHost: 'smtp.x', smtpPort: 587, smtpSecure: false, smtpUser: 'u', smtpPass: 'p', from: 'noreply@x.org' },
    frontendBaseUrl: 'https://app.example.org',
  },
}));
vi.mock('../src/services/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/db.js', () => ({ prisma: {} }));

import * as email from '../src/services/emailService.js';
import { escapeHtml, sanitizeHeaderText } from '../src/services/htmlEscape.js';
import { buildTenantNotification } from '../src/services/tenantNotifications.js';

const EVIL = 'Ali <b>"Kalın"</b> & Co';
const EVIL_ESCAPED = 'Ali &lt;b&gt;&quot;Kalın&quot;&lt;/b&gt; &amp; Co';
const TO = 'kisi@gercek-alan.org';
const DATE = new Date('2026-09-25T10:00:00Z');

/** Son gönderilen e-postanın html'i. */
function lastHtml(): string {
  const call = sendMail.mock.calls.at(-1);
  if (!call) throw new Error('sendMail çağrılmadı');
  return (call[0] as { html: string }).html;
}

function expectEscaped(html: string): void {
  expect(html).toContain(EVIL_ESCAPED);
  expect(html).not.toContain('<b>');
  expect(html).not.toContain('"Kalın"');
}

describe('escapeHtml (saf)', () => {
  it('& < > " \' karakterlerini kaçırır', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
  it('normal Türkçe metni aynen bırakır', () => {
    expect(escapeHtml('Ayşe Öğretmen — Çağ Derneği')).toBe('Ayşe Öğretmen — Çağ Derneği');
  });
  it('null/undefined boş dize, sayı metin olur', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('sanitizeHeaderText (konu satırı)', () => {
  it('CR/LF boşluğa çevrilir, HTML kaçışı yapılmaz', () => {
    expect(sanitizeHeaderText('A\r\nBcc: x@y.z')).toBe('A Bcc: x@y.z');
    expect(sanitizeHeaderText('[A & B] <Kurum>')).toBe('[A & B] <Kurum>');
  });
  it('send() konuyu temizleyerek iletir', async () => {
    sendMail.mockClear();
    await email.send(TO, 'Konu\r\nX-Ek: 1', '<p>x</p>');
    expect((sendMail.mock.calls[0]![0] as { subject: string }).subject).toBe('Konu X-Ek: 1');
  });
});

describe('GV-15: her gönderim fonksiyonu kullanıcı metnini kaçırır', () => {
  beforeEach(() => sendMail.mockClear());

  it('sendMeetingRequestEmail', async () => {
    await email.sendMeetingRequestEmail({ toEmail: TO, mentorName: 'Mentör Ayşe', mentiName: EVIL, scheduledAt: DATE });
    const html = lastHtml();
    expectEscaped(html);
    expect(html).toContain('Merhaba Mentör Ayşe,');
  });

  it('sendMeetingApprovalEmail', async () => {
    await email.sendMeetingApprovalEmail({ toEmail: TO, mentiName: 'Menti Can', mentorName: EVIL, scheduledAt: DATE });
    const html = lastHtml();
    expectEscaped(html);
    expect(html).toContain('Merhaba Menti Can,');
  });

  it('sendNewChatMessageEmail', async () => {
    await email.sendNewChatMessageEmail({ toEmail: TO, recipientName: 'Zeynep', senderName: EVIL });
    expectEscaped(lastHtml());
    expect(lastHtml()).toContain('Merhaba Zeynep,');
  });

  it('sendAdminNewUserNotification (ad + bilinmeyen rol kodu kaçırılır, bilinen rol Türkçe)', async () => {
    await email.sendAdminNewUserNotification({
      toEmail: TO, adminName: 'Yönetici', newUserFullName: EVIL, newUserRole: 'MENTOR', tenantName: 'Kurum',
    });
    expectEscaped(lastHtml());
    expect(lastHtml()).toContain('<strong>Mentör</strong>');

    await email.sendAdminNewUserNotification({
      toEmail: TO, adminName: 'Yönetici', newUserFullName: 'X', newUserRole: '<i>ROL</i>', tenantName: 'Kurum',
    });
    expect(lastHtml()).toContain('&lt;i&gt;ROL&lt;/i&gt;');
    expect(lastHtml()).not.toContain('<i>');
  });

  it('sendUserApprovalNotification (onay + red gerekçesi)', async () => {
    await email.sendUserApprovalNotification({ toEmail: TO, userName: EVIL, approved: true });
    expectEscaped(lastHtml());

    await email.sendUserApprovalNotification({
      toEmail: TO, userName: 'Deniz', approved: false, rejectionReason: EVIL,
    });
    expectEscaped(lastHtml());
    expect(lastHtml()).toContain('Merhaba Deniz,');
  });

  it('sendPasswordResetEmail (ad kaçırılır, href attribute-güvenli)', async () => {
    await email.sendPasswordResetEmail({ toEmail: TO, userName: EVIL, rawToken: 'abc"def<x>&y' });
    const html = lastHtml();
    expectEscaped(html);
    const href = /<a href="([^"]*)">/.exec(html)?.[1] ?? '';
    expect(href).toContain('/reset-password?token=abc%22def%3Cx%3E%26y');
    expect(href).not.toMatch(/[<>"]/);
    // Normal hex token aynen görünür.
    await email.sendPasswordResetEmail({ toEmail: TO, userName: 'Ali', rawToken: 'deadbeef' });
    expect(lastHtml()).toContain('reset-password?token=deadbeef');
  });

  it('sendAdminTestCompletedNotification', async () => {
    await email.sendAdminTestCompletedNotification({
      toEmail: TO, adminName: 'Yönetici', userName: EVIL, userRole: 'MENTI', tenantName: 'Kurum',
    });
    expectEscaped(lastHtml());
    expect(lastHtml()).toContain('(Menti)');
  });

  it('sendAlgorithmAdjustmentProposal (gerekçe + ad kaçırılır, href içindeki tenantId kodlanır)', async () => {
    await email.sendAlgorithmAdjustmentProposal({
      toEmail: TO, adminName: EVIL, tenantName: 'Kurum', tenantId: 't1"&x=<y>', reason: '3. ay NPS 40 (< 50)',
      phase1Nps: null, phase3Nps: 40, prevSector: 60, prevDisc: 40, newSector: 55, newDisc: 45,
    });
    const html = lastHtml();
    expectEscaped(html);
    expect(html).toContain('3. ay NPS 40 (&lt; 50)');
    expect(html).toContain('%55');
    const hrefs = [...html.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]!);
    expect(hrefs).toHaveLength(2);
    for (const h of hrefs) {
      expect(h).toContain('tenantId=t1%22%26x%3D%3Cy%3E');
      expect(h).not.toMatch(/[<>"]/);
    }
  });

  it('sendDraftTenantReminderEmail (kurum adı gövdede kaçırılır, unsubscribe href güvenli)', async () => {
    await email.sendDraftTenantReminderEmail({
      toEmail: TO, adminName: 'Yönetici', tenantName: EVIL, unsubscribeToken: 'tok"<en>',
    });
    const html = lastHtml();
    expectEscaped(html);
    expect(html).toContain('/api/tenants/unsubscribe?token=tok%22%3Cen%3E');
    expect(html).not.toContain('tok"<en>');
  });

  it('sendAlreadyRegisteredEmail', async () => {
    await email.sendAlreadyRegisteredEmail({ toEmail: TO, userName: EVIL });
    const html = lastHtml();
    expectEscaped(html);
    expect(html).toContain('<a href="https://app.example.org/login">');
  });

  it('sendNudgeReminderEmail (yönetici notu + kurum adı)', async () => {
    await email.sendNudgeReminderEmail({ toEmail: TO, recipientName: 'Ece', tenantName: EVIL, message: EVIL });
    const html = lastHtml();
    expect(html.split(EVIL_ESCAPED).length - 1).toBe(2);
    expect(html).not.toContain('<b>');
    expect(html).toContain('Merhaba Ece,');
  });

  it('sendFeedbackReminderEmail', async () => {
    await email.sendFeedbackReminderEmail({ toEmail: TO, recipientName: EVIL, meetingId: 'm1', scheduledAt: DATE });
    expectEscaped(lastHtml());
  });
});

describe('GV-15: kurum bildirimi (tenantNotifications) gövdesi kaçırılır', () => {
  it.each(['APPROVED', 'CORRECTION_REQUESTED', 'REJECTED'] as const)('%s', (kind) => {
    const { subject, html } = buildTenantNotification({ kind, tenantName: EVIL, adminName: EVIL, note: EVIL });
    expectEscaped(html);
    // Konu düz metindir — HTML kaçışı uygulanmaz (e-posta istemcisi metin olarak gösterir).
    expect(subject).toContain(`[${EVIL}]`);
  });
});
