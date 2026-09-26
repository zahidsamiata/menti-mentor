/**
 * P-05 / KARAR-22 (B) — ret e-postası içeriği: nazik, jenerik, gerekçesiz, kaçırılmış.
 * DB'siz birim testi: nodemailer, config, logger ve db mock'lanır; gönderilen e-posta yakalanır.
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

import { sendMeetingRejectedEmail } from '../src/services/emailService.js';

describe('sendMeetingRejectedEmail', () => {
  beforeEach(() => sendMail.mockClear());

  it('mentiye nazik, jenerik metin gönderir; true döner', async () => {
    const ok = await sendMeetingRejectedEmail({
      toEmail: 'kisi@gercek-alan.org',
      mentiName: 'Deneme Menti',
      scheduledAt: new Date('2026-09-25T10:00:00Z'),
    });
    expect(ok).toBe(true);
    const mail = sendMail.mock.calls[0]![0] as { to: string; subject: string; html: string };
    expect(mail.to).toBe('kisi@gercek-alan.org');
    expect(mail.subject).toBe('Görüşme Talebiniz Hakkında');
    expect(mail.html).toContain('mentörünüz şu an yeni görüşme alamıyor');
    expect(mail.html).toContain('profilinizle ilgili bir değerlendirme değildir');
    // Sert/suçlayıcı dil ve alternatif mentör önerisi yok (KARAR-22 B).
    expect(mail.html).not.toMatch(/reddedildi|reddetti|iptal/i);
    expect(mail.html).not.toMatch(/başka (bir )?mentör/i);
  });

  it('menti adını HTML olarak kaçırır (GV-15)', async () => {
    await sendMeetingRejectedEmail({
      toEmail: 'kisi@gercek-alan.org',
      mentiName: 'Ali <b>x</b>',
      scheduledAt: new Date('2026-09-25T10:00:00Z'),
    });
    const { html } = sendMail.mock.calls[0]![0] as { html: string };
    expect(html).toContain('Ali &lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });
});
