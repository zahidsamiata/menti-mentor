/**
 * DK-02 / KARAR-23 — kurum başvuru bildirimleri:
 *  - ONAY ve DÜZELTME e-postası gider (gönderim bayrağı açıkken),
 *  - RET e-postası GÖNDERİLMEZ (bayrak açık olsa bile),
 *  - düzeltme e-postası yöneticinin yazdığı düzeltme notunu (ne düzeltileceğini) içerir.
 * DB'siz birim testi: prisma, üyelik, e-posta servisi, config ve logger mock'lanır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendEmail, findUnique, findTenantAdminUsers } = vi.hoisted(() => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  findUnique: vi.fn(),
  findTenantAdminUsers: vi.fn(),
}));

vi.mock('../src/config.js', () => ({ config: { email: { tenantNotificationsEnabled: true } } }));
vi.mock('../src/services/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../src/db.js', () => ({ prisma: { tenant: { findUnique } } }));
vi.mock('../src/services/membership.js', () => ({ findTenantAdminUsers }));
vi.mock('../src/services/emailService.js', () => ({ send: sendEmail }));

import {
  buildTenantNotification,
  isTenantNotificationEmailed,
  notifyTenantVerification,
} from '../src/services/tenantNotifications.js';

const NOTE = 'Faaliyet belgenizin güncel tarihli bir kopyasını yükleyin.';

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue({ name: 'ornek-dernek', displayName: 'Örnek Derneği' });
  findTenantAdminUsers.mockResolvedValue([{ id: 'u1', fullName: 'Kurum Yöneticisi', email: 'yonetici@ornek.org' }]);
});

describe('KARAR-23: hangi kurum bildirimi e-postayla gider', () => {
  it('onay ve düzeltme gider, ret gitmez (saf)', () => {
    expect(isTenantNotificationEmailed('APPROVED')).toBe(true);
    expect(isTenantNotificationEmailed('CORRECTION_REQUESTED')).toBe(true);
    expect(isTenantNotificationEmailed('REJECTED')).toBe(false);
  });

  it('ONAY: bayrak açıkken kurum yöneticisine e-posta gider', async () => {
    await notifyTenantVerification({ tenantId: 't1', kind: 'APPROVED' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]?.[0]).toBe('yonetici@ornek.org');
  });

  it('DÜZELTME: e-posta gider ve düzeltme notunu içerir', async () => {
    await notifyTenantVerification({ tenantId: 't1', kind: 'CORRECTION_REQUESTED', note: NOTE });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [, subject, html] = sendEmail.mock.calls[0] as [string, string, string];
    expect(subject).toContain('Örnek Derneği');
    expect(html).toContain('Güncellenmesi istenenler:');
    expect(html).toContain(NOTE);
    expect(html).toContain('başvurunuz reddedilmedi');
  });

  it('RET: bayrak açık olsa bile e-posta GİTMEZ', async () => {
    await notifyTenantVerification({ tenantId: 't1', kind: 'REJECTED', note: 'Gerekçe' });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('düzeltme e-postası metni (saf)', () => {
  it('not yoksa not bloğu eklenmez, destekleyici metin kalır', () => {
    const { html } = buildTenantNotification({
      kind: 'CORRECTION_REQUESTED',
      tenantName: 'Örnek Derneği',
      adminName: 'Kurum Yöneticisi',
    });
    expect(html).not.toContain('Güncellenmesi istenenler:');
    expect(html).toContain('başvurunuz reddedilmedi');
  });
});
