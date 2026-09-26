/**
 * GV-18 — rıza sürümü kaydediliyor ama hiç kontrol edilmiyordu.
 *
 * `hasCurrentSignupConsent` artık login/refresh/me yanıtlarında `needsReconsent` alanına
 * bağlanıyor; `POST /api/auth/reconsent` kullanıcının rızasını GÜNCEL sürümde yeniden yazıyor.
 * Bugün `CONSENT_VERSION` yer tutucu olduğundan (`v1.0`) bu hiçbir CANLI davranışı değiştirmez —
 * yalnız altyapı: gerçek sürüm artışı olduğunda devreye girer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createUser } from './helpers/factories.js';
import { recordSignupConsent, recordConsent, CONSENT_VERSION } from '../src/services/consentService.js';
import { LEGACY_VERSION } from '../src/services/consentBackfill.js';
import type { Tenant, User } from '@prisma/client';

describe('GV-18: needsReconsent — login/me/refresh', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let user: User & { rawPassword: string };

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant();
    user = await createUser({ tenantId: tenant.id });
  });

  it('hiç kayıt rızası yoksa (eski/backfill\'siz kullanıcı) login needsReconsent:true döner', async () => {
    const res = await http.post('/api/auth/login').send({ email: user.email, password: user.rawPassword }).expect(200);
    expect(res.body.user.needsReconsent).toBe(true);
  });

  it('güncel sürümde rıza varsa login needsReconsent:false döner', async () => {
    await recordSignupConsent({ userId: user.id }, 'FORM');
    const res = await http.post('/api/auth/login').send({ email: user.email, password: user.rawPassword }).expect(200);
    expect(res.body.user.needsReconsent).toBe(false);
  });

  // Bağımsız inceleme bulgusu (2026-09-26): 2026-08-28 öncesi backfill'lenmiş (yalnız ACIK_RIZA,
  // LEGACY_VERSION, AYDINLATMA satırı hiç yok) gerçek canlı kullanıcı login olunca YANLIŞLIKLA
  // needsReconsent:true görmemeli — bu senaryo düzeltmeden önce SONSUZA DEK true dönüyordu.
  it('2026-08-28 backfill senaryosu (legacy ACIK_RIZA, AYDINLATMA yok) → login needsReconsent:false döner', async () => {
    await recordConsent({ userId: user.id }, 'ACIK_RIZA', { source: 'BACKFILL', version: LEGACY_VERSION });
    const res = await http.post('/api/auth/login').send({ email: user.email, password: user.rawPassword }).expect(200);
    expect(res.body.user.needsReconsent).toBe(false);
  });

  it('GET /api/auth/me aynı bayrağı taşır', async () => {
    const { accessToken } = await loginAs(http, user.email, user.rawPassword);
    const res = await http.get('/api/auth/me').set(tenantHeaders(tenant.id, accessToken)).expect(200);
    expect(res.body.needsReconsent).toBe(true); // henüz rıza yazılmadı
  });

  it('POST /api/auth/reconsent sonrası needsReconsent false olur, yeni satır açılır (eski silinmez)', async () => {
    const { accessToken } = await loginAs(http, user.email, user.rawPassword);
    const before = await testPrisma.consent.count({ where: { userId: user.id } });
    expect(before).toBe(0);

    const res = await http.post('/api/auth/reconsent').set(tenantHeaders(tenant.id, accessToken)).expect(200);
    expect(res.body.needsReconsent).toBe(false);

    const rows = await testPrisma.consent.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(2); // AYDINLATMA + ACIK_RIZA
    expect(rows.every((r) => r.version === CONSENT_VERSION)).toBe(true);

    const me = await http.get('/api/auth/me').set(tenantHeaders(tenant.id, accessToken)).expect(200);
    expect(me.body.needsReconsent).toBe(false);
  });

  it('negatif: kimlik doğrulanmadan reconsent çağrılırsa 401, hiçbir satır yazılmaz', async () => {
    const res = await http.post('/api/auth/reconsent').set(tenantHeaders(tenant.id)).send({});
    expect(res.status).toBe(401);
    expect(await testPrisma.consent.count()).toBe(0);
  });
});
