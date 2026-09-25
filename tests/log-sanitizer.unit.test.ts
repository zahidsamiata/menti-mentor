/**
 * GV-07 — günlük (log) kişisel veri süzgeci — birim testi (DB gerektirmez).
 *
 * Kapsam: `sanitizeLogMeta` / `scrubText` e-posta, ad, token, psikometrik alanları maskeler;
 * `userId` / `tenantId` gibi analitik alanları korur; döngüsel yapıda çökmez.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeLogMeta, scrubText, REDACTED } from '../src/services/logSanitizer.js';

describe('sanitizeLogMeta — hassas anahtarlar', () => {
  it('e-posta maskelenir, ad/token/parola tamamen gizlenir', () => {
    const out = sanitizeLogMeta({
      email: 'ornek.kisi@example.com',
      toEmail: 'baska@example.org',
      fullName: 'Ayşe Yılmaz',
      password: 'p@ss',
      accessToken: 'eyJhbGciOi.abc.def',
      inviteToken: 'xyz',
      discVector: { d: 0.4, i: 0.2 },
    });
    expect(out.email).toBe('o***@example.com');
    expect(out.toEmail).toBe('b***@example.org');
    expect(out.fullName).toBe(REDACTED);
    expect(out.password).toBe(REDACTED);
    expect(out.accessToken).toBe(REDACTED);
    expect(out.inviteToken).toBe(REDACTED);
    expect(out.discVector).toBe(REDACTED);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('ornek.kisi');
    expect(serialized).not.toContain('Ayşe');
    expect(serialized).not.toContain('eyJhbGciOi');
  });

  it('userId / tenantId / sayısal alanlar ve tokenTenantId aynen korunur', () => {
    const meta = { userId: 'u_1', tenantId: 't_1', tokenTenantId: 't_2', count: 3, ok: true, when: null };
    expect(sanitizeLogMeta(meta)).toEqual(meta);
  });

  it('iç içe nesne ve dizilerdeki hassas alanlar da maskelenir', () => {
    const out = sanitizeLogMeta({
      tenantId: 't_1',
      user: { id: 'u_1', email: 'a@b.co', profile: { fullName: 'X Y' } },
      list: [{ refresh_token: 'r' }, 'iletisim: kisi@alan.com.tr'],
    }) as { user: { id: string; email: string; profile: { fullName: string } }; list: unknown[] };
    expect(out.user.id).toBe('u_1');
    expect(out.user.email).toBe('a***@b.co');
    expect(out.user.profile.fullName).toBe(REDACTED);
    expect(out.list[0]).toEqual({ refresh_token: REDACTED });
    expect(out.list[1]).toBe('iletisim: k***@alan.com.tr');
  });

  it('serbest metin değerlerindeki e-posta adresleri maskelenir (SMTP hata metni)', () => {
    const out = sanitizeLogMeta({ message: '550 Recipient <kisi@example.com> rejected' });
    expect(out.message).toBe('550 Recipient <k***@example.com> rejected');
  });

  it('döngüsel yapıda çökmez', () => {
    const a: Record<string, unknown> = { userId: 'u_1' };
    a.self = a;
    const out = sanitizeLogMeta(a);
    expect(out.userId).toBe('u_1');
    expect(out.self).toBe('[döngüsel]');
  });

  it('girdiyi değiştirmez', () => {
    const meta = { email: 'a@b.co' };
    sanitizeLogMeta(meta);
    expect(meta.email).toBe('a@b.co');
  });
});

describe('scrubText', () => {
  it('e-posta yoksa metni aynen döndürür (paket yolları dahil)', () => {
    const text = 'at node_modules/@prisma/client/runtime.js:12';
    expect(scrubText(text)).toBe(text);
  });

  it('mesaj içindeki e-postayı maskeler', () => {
    expect(scrubText('E-posta gönderilemedi: kisi@example.com')).toBe('E-posta gönderilemedi: k***@example.com');
  });
});
