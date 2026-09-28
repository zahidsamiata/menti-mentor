/**
 * AN-36 / G1-12 — Kurum yasal bilgisi doğrulama kuralları (DB'siz birim testi).
 * Entegrasyon eşi (yetki + DB değişmez): tests/an36-kurum-yasal-bilgiler.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  UpdateLegalInfoSchema,
  TENANT_LEGAL_INFO_SELECT,
  pickProvidedLegalFields,
} from '../src/services/tenantLegalInfo.js';

const ok = (body: unknown) => UpdateLegalInfoSchema.safeParse(body).success;

describe('UpdateLegalInfoSchema', () => {
  it('geçerli tam kayıt kabul edilir', () => {
    expect(ok({
      legalName: 'Örnek Derneği', legalAddress: 'Adres', kepAddress: 'ornek@hs01.kep.tr',
      mersisNo: '0123456789012345', taxOffice: 'Çankaya', taxNumber: '1234567890',
    })).toBe(true);
  });

  it('MERSİS yalnız 16 hane rakam', () => {
    expect(ok({ mersisNo: '0123456789012345' })).toBe(true);
    expect(ok({ mersisNo: '0123 4567 8901 2345' })).toBe(true); // boşluklar atılır
    expect(ok({ mersisNo: '012345678901234' })).toBe(false);
    expect(ok({ mersisNo: '01234567890123456' })).toBe(false);
    expect(ok({ mersisNo: '01234567890123AB' })).toBe(false);
  });

  it('KEP geçerli e-posta VE kep.tr alan adı olmalı; küçük harfe çevrilir', () => {
    expect(ok({ kepAddress: 'kep-degil' })).toBe(false);
    expect(ok({ kepAddress: 'kurum@gmail.com' })).toBe(false);
    const parsed = UpdateLegalInfoSchema.safeParse({ kepAddress: ' Kurum@HS01.KEP.tr ' });
    expect(parsed.success && parsed.data.kepAddress).toBe('kurum@hs01.kep.tr');
  });

  it('VKN 10 hane rakam', () => {
    expect(ok({ taxNumber: '1234567890' })).toBe(true);
    expect(ok({ taxNumber: '123456789' })).toBe(false);
    expect(ok({ taxNumber: '12345678901' })).toBe(false);
  });

  it('uzunluk sınırları', () => {
    expect(ok({ legalName: 'a'.repeat(300) })).toBe(true);
    expect(ok({ legalName: 'a'.repeat(301) })).toBe(false);
    expect(ok({ legalAddress: 'a'.repeat(501) })).toBe(false);
    expect(ok({ taxOffice: 'a'.repeat(101) })).toBe(false);
  });

  it('bilinmeyen alan (mass-assignment) ve boş gövde reddedilir', () => {
    expect(ok({ legalName: 'X', plan: 'ENTERPRISE' })).toBe(false);
    expect(ok({ legalName: 'X', isActive: false })).toBe(false);
    expect(ok({})).toBe(false);
  });

  it('boş dize ve null → null (temizleme); gönderilmeyen alan yazılmaz', () => {
    const parsed = UpdateLegalInfoSchema.parse({ legalName: '  ', kepAddress: null, taxNumber: '1234567890' });
    expect(pickProvidedLegalFields(parsed)).toEqual({ legalName: null, kepAddress: null, taxNumber: '1234567890' });
  });
});

describe('TENANT_LEGAL_INFO_SELECT', () => {
  it('yalnız yasal alanlar — Tenant\'ın başka alanı dönmez', () => {
    expect(Object.keys(TENANT_LEGAL_INFO_SELECT).sort()).toEqual([
      'kepAddress', 'legalAddress', 'legalInfoUpdatedAt', 'legalName', 'mersisNo', 'taxNumber', 'taxOffice',
    ]);
  });
});
