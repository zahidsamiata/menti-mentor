/**
 * Y1-B9 — kurum askı kararı (saf fonksiyon). Entegrasyon kapsamı: tenant-suspension.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { isTenantSuspended } from '../src/middleware/tenantSuspension.js';

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
