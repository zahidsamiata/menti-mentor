/**
 * G1-07 — consentService entegrasyon testleri (tipli+sürümlü rıza, test-DB).
 * Kapsam: kayıt, sürüm geçmişi, aktif rıza, geri çekme (idempotent), sürüm kontrolü, özne doğrulama.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import {
  recordConsent,
  recordSignupConsent,
  getActiveConsent,
  getAllConsents,
  revokeConsent,
  hasValidConsent,
  CONSENT_VERSION,
  SIGNUP_CONSENT_TYPES,
} from '../src/services/consentService.js';
import type { Tenant, User } from '@prisma/client';

describe('consentService — tipli + sürümlü rıza', () => {
  let tenant: Tenant;
  let user: User & { rawPassword: string };

  beforeEach(async () => {
    await cleanDb();
    tenant = await createTenant();
    user = await createUser({ tenantId: tenant.id });
  });

  it('recordConsent tek satır oluşturur; alanlar doğru', async () => {
    await recordConsent({ userId: user.id }, 'ACIK_RIZA', { source: 'FORM' });
    const rows = await testPrisma.consent.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('ACIK_RIZA');
    expect(rows[0].version).toBe(CONSENT_VERSION);
    expect(rows[0].source).toBe('FORM');
    expect(rows[0].revokedAt).toBeNull();
    expect(rows[0].tenantId).toBeNull();
  });

  it('recordSignupConsent AYDINLATMA + ACIK_RIZA yazar (iki satır)', async () => {
    await recordSignupConsent({ userId: user.id }, 'FORM');
    const rows = await testPrisma.consent.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.type))).toEqual(new Set(SIGNUP_CONSENT_TYPES));
  });

  it('ikinci recordConsent YENİ satır açar; eskisi durur (sürüm geçmişi)', async () => {
    await recordConsent({ userId: user.id }, 'ACIK_RIZA', { source: 'FORM', version: 'v1.0' });
    await recordConsent({ userId: user.id }, 'ACIK_RIZA', { source: 'FORM', version: 'v2.0' });
    const rows = await testPrisma.consent.findMany({ where: { userId: user.id, type: 'ACIK_RIZA' } });
    expect(rows).toHaveLength(2);
  });

  it('getActiveConsent en yeni grantedAt + revokedAt=null döner', async () => {
    await recordConsent({ userId: user.id }, 'ACIK_RIZA', { source: 'FORM', version: 'v1.0', grantedAt: new Date('2020-01-01') });
    await recordConsent({ userId: user.id }, 'ACIK_RIZA', { source: 'FORM', version: 'v2.0', grantedAt: new Date('2021-01-01') });
    const active = await getActiveConsent({ userId: user.id }, 'ACIK_RIZA');
    expect(active?.version).toBe('v2.0');
  });

  it('getAllConsents denetim izi: tüm satırları döner', async () => {
    await recordSignupConsent({ userId: user.id }, 'FORM');
    const all = await getAllConsents({ userId: user.id });
    expect(all).toHaveLength(2);
  });

  it('revokeConsent revokedAt doldurur, YENİ satır açmaz; sonra aktif null', async () => {
    await recordConsent({ userId: user.id }, 'ACIK_RIZA', { source: 'FORM' });
    const res = await revokeConsent({ userId: user.id }, 'ACIK_RIZA');
    expect(res.revoked).toBe(true);
    const rows = await testPrisma.consent.findMany({ where: { userId: user.id, type: 'ACIK_RIZA' } });
    expect(rows).toHaveLength(1); // yeni satır YOK
    expect(rows[0].revokedAt).not.toBeNull();
    expect(await getActiveConsent({ userId: user.id }, 'ACIK_RIZA')).toBeNull();
  });

  it('rıza yokken revoke → hata değil, no-op (revoked:false)', async () => {
    const res = await revokeConsent({ userId: user.id }, 'ACIK_RIZA');
    expect(res.revoked).toBe(false);
  });

  it('zaten geri çekilmişken tekrar revoke → no-op (idempotent)', async () => {
    await recordConsent({ userId: user.id }, 'ACIK_RIZA', { source: 'FORM' });
    await revokeConsent({ userId: user.id }, 'ACIK_RIZA');
    const res2 = await revokeConsent({ userId: user.id }, 'ACIK_RIZA');
    expect(res2.revoked).toBe(false);
  });

  it('hasValidConsent: sürüm eşleşmezse false (metin güncellendi → yeniden onay)', async () => {
    await recordConsent({ userId: user.id }, 'ACIK_RIZA', { source: 'FORM', version: 'v1.0' });
    expect(await hasValidConsent({ userId: user.id }, 'ACIK_RIZA')).toBe(true);
    expect(await hasValidConsent({ userId: user.id }, 'ACIK_RIZA', 'v1.0')).toBe(true);
    expect(await hasValidConsent({ userId: user.id }, 'ACIK_RIZA', 'v2.0')).toBe(false);
  });

  it('geçersiz özne (ikisi dolu / ikisi boş) → hata', async () => {
    await expect(recordConsent({ userId: user.id, tenantId: tenant.id }, 'ACIK_RIZA', { source: 'FORM' })).rejects.toThrow();
    await expect(recordConsent({}, 'ACIK_RIZA', { source: 'FORM' })).rejects.toThrow();
  });

  it('tenant öznesi (kurum rızası) userId null ile yazılır ve okunur', async () => {
    await recordConsent({ tenantId: tenant.id }, 'ACIK_RIZA', { source: 'SELF_SERVE' });
    const rows = await testPrisma.consent.findMany({ where: { tenantId: tenant.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBeNull();
    expect(await getActiveConsent({ tenantId: tenant.id }, 'ACIK_RIZA')).not.toBeNull();
  });
});
