import { describe, it, expect } from 'vitest';
import { isUndeliverableRecipient } from '../src/services/emailService.js';

// Saf fonksiyon — DB/SMTP'ye dokunmaz; sahte-alıcı guard mantığını doğrular.
describe('isUndeliverableRecipient', () => {
  it('sahte/test domainleri teslim edilemez sayar', () => {
    expect(isUndeliverableRecipient('user@test.local')).toBe(true);
    expect(isUndeliverableRecipient('a@foo.test')).toBe(true);
    expect(isUndeliverableRecipient('x@bar.invalid')).toBe(true);
    expect(isUndeliverableRecipient('y@baz.example')).toBe(true);
    expect(isUndeliverableRecipient('z@sub.test.local')).toBe(true);
  });

  it('gerçek domainleri teslim edilebilir sayar', () => {
    expect(isUndeliverableRecipient('user@gmail.com')).toBe(false);
    expect(isUndeliverableRecipient('admin@sivilkapasite.org')).toBe(false);
    expect(isUndeliverableRecipient('a@example.com')).toBe(false); // .example TLD değil
  });

  it('geçersiz formatı teslim edilemez sayar', () => {
    expect(isUndeliverableRecipient('no-at-sign')).toBe(true);
    expect(isUndeliverableRecipient('trailing@')).toBe(true);
  });

  it('büyük/küçük harf toleransı', () => {
    expect(isUndeliverableRecipient('User@TEST.LOCAL')).toBe(true);
  });
});
