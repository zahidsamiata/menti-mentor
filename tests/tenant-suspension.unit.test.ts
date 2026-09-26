/**
 * Y1-B9 — kurum askı kararı (saf fonksiyon). Entegrasyon kapsamı: tenant-suspension.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { isSuspensionExemptRequest, isTenantSuspended } from '../src/middleware/tenantSuspension.js';

describe('Y1-B9: isTenantSuspended', () => {
  it('platformun dondurduğu kurum (isActive=false) askıdadır', () => {
    expect(isTenantSuspended({ isActive: false, verificationStatus: 'APPROVED' })).toBe(true);
    expect(isTenantSuspended({ isActive: false, verificationStatus: 'AUTO_APPROVED' })).toBe(true);
  });

  it('başvurusu reddedilen kurum askıdadır (platform reddi isActive\'e dokunmasa da)', () => {
    expect(isTenantSuspended({ isActive: true, verificationStatus: 'REJECTED' })).toBe(true);
    expect(isTenantSuspended({ isActive: false, verificationStatus: 'REJECTED' })).toBe(true);
  });

  it('aktif ve onaylı / kurulumdaki / incelemedeki / düzeltme istenen kurum askıda DEĞİLDİR', () => {
    for (const verificationStatus of ['AUTO_APPROVED', 'APPROVED', 'PENDING_REVIEW', 'CORRECTION_REQUESTED'] as const) {
      expect(isTenantSuspended({ isActive: true, verificationStatus })).toBe(false);
    }
  });
});

describe('Y1-B9: isSuspensionExemptRequest (tek izin listesi)', () => {
  it('oturum durumu + KVKK md.11 uçları muaf', () => {
    expect(isSuspensionExemptRequest('GET', '/api/auth/me')).toBe(true);
    expect(isSuspensionExemptRequest('GET', '/api/me/data-export')).toBe(true);
    expect(isSuspensionExemptRequest('POST', '/api/me/delete-account')).toBe(true);
  });

  it('sorgu dizesi, sondaki "/" ve harf büyüklüğü normalize edilir', () => {
    expect(isSuspensionExemptRequest('get', '/api/me/data-export/?a=1')).toBe(true);
    expect(isSuspensionExemptRequest('GET', '/API/Auth/Me')).toBe(true);
  });

  it('yanlış yöntem ya da benzer yol muaf DEĞİL', () => {
    expect(isSuspensionExemptRequest('POST', '/api/me/data-export')).toBe(false);
    expect(isSuspensionExemptRequest('GET', '/api/me/delete-account')).toBe(false);
    expect(isSuspensionExemptRequest('GET', '/api/me/data-export/extra')).toBe(false);
    expect(isSuspensionExemptRequest('GET', '/api/users/u1/export')).toBe(false);
    expect(isSuspensionExemptRequest('GET', '/api/meetings/active')).toBe(false);
  });
});
