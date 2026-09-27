/**
 * AN-09 — public şüphe bildirimi platform yöneticisine e-postayla haber verir;
 * e-postaya bildirenin kişisel verisi ya da açıklama metni KONMAZ. Gerçek SMTP mock'lanır.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb } from './helpers/db.js';
import { resetRateLimiters } from '../src/middleware/rateLimiter.js';
import { config } from '../src/config.js';

const mocks = vi.hoisted(() => ({ sendSuspicionReportAlert: vi.fn(async () => true) }));

vi.mock('../src/services/emailService.js', async (orig) => ({
  ...(await orig<typeof import('../src/services/emailService.js')>()),
  sendSuspicionReportAlert: mocks.sendSuspicionReportAlert,
}));

const VALID_REPORT = {
  tenantName: 'Örnek Sahte Dernek',
  reporterName: 'Bildiren Kişi',
  reporterRole: 'Gönüllü',
  contact: 'bildiren-iletisim@example.org',
  description: 'Bu kurum adına sahte davet bağlantısı gönderiliyor, lütfen inceleyin.',
};

describe('AN-09 · şüphe bildirimi e-posta uyarısı', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    resetRateLimiters();
    http = agent();
    mocks.sendSuspicionReportAlert.mockClear();
  });

  it('geçerli bildirim → 201 ve platform yöneticisine yalnız kayıt no ile uyarı', async () => {
    const res = await http.post('/api/suspicion-reports').send(VALID_REPORT).expect(201);

    expect(mocks.sendSuspicionReportAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendSuspicionReportAlert).toHaveBeenCalledWith({
      toEmail: config.platformAdminEmail,
      reportId: res.body.id,
    });
    const sent = JSON.stringify(mocks.sendSuspicionReportAlert.mock.calls);
    expect(sent).not.toContain(VALID_REPORT.contact);
    expect(sent).not.toContain(VALID_REPORT.reporterName);
    expect(sent).not.toContain(VALID_REPORT.description);
  });

  it('NEGATİF: geçersiz bildirim → 400 ve e-posta gönderilmez', async () => {
    await http.post('/api/suspicion-reports').send({ tenantName: 'x' }).expect(400);
    expect(mocks.sendSuspicionReportAlert).not.toHaveBeenCalled();
  });
});
