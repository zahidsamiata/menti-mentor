/**
 * AJ-69 — Ağırlık önerisi e-postası küçük örnekte NPS ortalamasını YAZMAZ (k-anonimlik, V-05 kalanı).
 * DB'siz birim testi (meeting-rejected-email.unit.test.ts deseni): nodemailer, config, logger ve db
 * taklit edilir; gönderilen e-postanın HTML'i yakalanır.
 *
 *   npx vitest run tests/algorithm-adjustment-email-nps.unit.test.ts --reporter=verbose
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

import { sendAlgorithmAdjustmentProposal } from '../src/services/emailService.js';

const baseArgs = {
  toEmail: 'yonetici@ornek.org',
  adminName: 'Yönetici',
  tenantName: 'Kurum',
  tenantId: 't1',
  reason: '1. aydan 3. aya NPS düşüşü (3. ay ortalama 5.5/10) — DISC ağırlığı +5%',
  phase3Nps: { avgNps: 5.5, sampleSize: 10 },
  prevSector: 60, prevDisc: 40, newSector: 55, newDisc: 45,
};

const npsLine = () => {
  const { html } = sendMail.mock.calls[0]![0] as { html: string };
  return html.match(/NPS Verileri:[^<]*/)?.[0] ?? '';
};

describe('AJ-69 sendAlgorithmAdjustmentProposal: NPS satırı k-anonim', () => {
  beforeEach(() => sendMail.mockClear());

  for (const n of [1, 2]) {
    it(`1. ay n=${n} → ortalama yazılmaz, "gizli (<3 yanıt)" yazılır`, async () => {
      await sendAlgorithmAdjustmentProposal({ ...baseArgs, phase1Nps: { avgNps: 9.4, sampleSize: n } });
      const line = npsLine();
      expect(line).toContain('1. ay = gizli (&lt;3 yanıt)');
      expect(line).not.toContain('9.4');
      expect(line).toContain('3. ay = 5.5');
    });
  }

  it('1. ay n=3 → ortalama yazılır', async () => {
    await sendAlgorithmAdjustmentProposal({ ...baseArgs, phase1Nps: { avgNps: 9.4, sampleSize: 3 } });
    expect(npsLine()).toContain('1. ay = 9.4');
  });

  it('önceden maskelenmiş örnek (suppressed) → gizli; yanıt yok → "Yetersiz veri"', async () => {
    await sendAlgorithmAdjustmentProposal({
      ...baseArgs,
      phase1Nps: { avgNps: null, sampleSize: 0, suppressed: true },
      phase3Nps: { avgNps: null, sampleSize: 0 },
    });
    expect(npsLine()).toContain('1. ay = gizli (&lt;3 yanıt)');
    expect(npsLine()).toContain('3. ay = Yetersiz veri');
  });
});
