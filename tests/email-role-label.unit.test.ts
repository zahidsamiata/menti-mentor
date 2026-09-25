/**
 * IC-03 (e-posta ayağı) — yöneticiye giden e-postalarda rol Türkçe adıyla yazılır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMail = vi.fn().mockResolvedValue({});
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail, verify: vi.fn() }) },
  createTransport: () => ({ sendMail, verify: vi.fn() }),
}));

describe('IC-03: e-postada rol adı', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', 'test-secret-min-32-chars-for-testing-only!!');
    sendMail.mockClear();
  });

  it('roleLabel bilinen rolleri Türkçeye çevirir, bilinmeyeni olduğu gibi bırakır', async () => {
    const { roleLabel } = await import('../src/services/emailService.js');
    expect(roleLabel('MENTOR')).toBe('Mentör');
    expect(roleLabel('MENTI')).toBe('Menti');
    expect(roleLabel('ADMIN')).toBe('Kurum Yöneticisi');
    expect(roleLabel('BILINMEYEN')).toBe('BILINMEYEN');
  });
});
