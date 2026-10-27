/**
 * DK-03 · GET /api/platform/logs/:id/trace — platform yöneticisine temizlenmiş hata iz kaydı
 * (KARAR-24 → B). Entegrasyon testi (izole test DB; kanıt CI).
 *
 *  - Platform oturumu: ERROR kaydının iz kaydı döner, kişisel veri maskeli, ham meta YOK,
 *    denetim izi (VIEW_PLATFORM_LOG_TRACE) yazılır.
 *  - ERROR dışı kayıt / olmayan no → 404 (iz yalnız hatalar için).
 *  - NEGATİF: oturumsuz → 401; kurum yöneticisi oturumu (Bearer ya da çereze konmuş kullanıcı
 *    anahtarı) → 401/403; hiçbir durumda iz sızmaz ve denetim kaydı yazılmaz.
 *  - AJ-102 sözleşmesi: liste ucu `/api/platform/logs` hâlâ meta/stack döndürmez.
 * Örnek veriler uydurmadır.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createAdminUser } from './helpers/factories.js';
import { signToken, PLATFORM_AUDIENCE } from '../src/middleware/jwtAuth.js';

function platformCookie(): string {
  const token = signToken(
    { sub: 'platform-admin', tenantId: '__platform__', role: 'ADMIN', fullName: 'Platform Yöneticisi', isPlatformAdmin: true },
    { audience: PLATFORM_AUDIENCE },
  );
  return `platform_token=${encodeURIComponent(token)}`;
}

async function waitForAuditLog(message: string, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const log = await testPrisma.systemLog.findFirst({ where: { category: 'AUDIT', message } });
    if (log) return log;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

const EMAIL = 'dk03-sizmamali@example.org';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkazAzIn0.ZGswMy1pbXphLWRlZ2VyaQ';
const QUERY_SECRET = 'dk03-sorgu-gizli';
const STACK = [
  `Error: Unique constraint failed for ${EMAIL} data: { fullName: "Dk Uc Deneme" }`,
  `    at handler (/srv/app/dist/controllers/meetingController.js:77:9) url=/api/x?token=${QUERY_SECRET}`,
  `    at auth (/srv/app/dist/middleware/jwtAuth.js:12:3) Bearer ${JWT}`,
].join('\n');

describe('DK-03 · platform hata iz kaydı ucu', () => {
  let errorLogId: string;
  let infoLogId: string;

  beforeEach(async () => {
    await cleanDb();
    const errorLog = await testPrisma.systemLog.create({
      data: {
        level: 'ERROR',
        category: 'HTTP',
        message: 'Beklenmedik sunucu hatası',
        meta: { message: `Unique constraint failed for ${EMAIL}`, stack: STACK, url: '/api/meetings/m1', method: 'POST', userId: 'u-dk03', tenantId: 't-dk03', email: EMAIL },
      },
    });
    errorLogId = errorLog.id;
    const infoLog = await testPrisma.systemLog.create({
      data: { level: 'INFO', category: 'AUTH', message: 'dk03 bilgi', meta: { stack: STACK } },
    });
    infoLogId = infoLog.id;
  });

  it('platform oturumu: ERROR kaydının iz kaydı temizlenmiş döner + denetim izi', async () => {
    const res = await agent().get(`/api/platform/logs/${errorLogId}/trace`).set('Cookie', platformCookie());
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body['id']).toBe(errorLogId);
    expect(String(body['stack'])).toContain('meetingController.js:77:9');
    expect(body['userId']).toBe('u-dk03');
    expect(body['tenantId']).toBe('t-dk03');
    expect(body).not.toHaveProperty('meta');
    const raw = JSON.stringify(res.body);
    for (const secret of [EMAIL, JWT, QUERY_SECRET, 'Dk Uc Deneme']) expect(raw).not.toContain(secret);

    const audit = await waitForAuditLog('VIEW_PLATFORM_LOG_TRACE');
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.meta ?? {})).toContain(errorLogId);
    expect(JSON.stringify(audit?.meta ?? {})).not.toContain(EMAIL);
  });

  it('ERROR dışı kayıt ve olmayan kayıt → 404, iz yok', async () => {
    for (const id of [infoLogId, 'olmayan-kayit-no', 'x'.repeat(80)]) {
      const res = await agent().get(`/api/platform/logs/${id}/trace`).set('Cookie', platformCookie());
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('meetingController');
    }
  });

  it('NEGATİF: oturumsuz → 401, iz yok, denetim kaydı yok', async () => {
    const res = await agent().get(`/api/platform/logs/${errorLogId}/trace`);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('meetingController');
    expect(await testPrisma.systemLog.findFirst({ where: { category: 'AUDIT', message: 'VIEW_PLATFORM_LOG_TRACE' } })).toBeNull();
  });

  it('NEGATİF: kurum yöneticisi oturumu (Bearer ya da platform çerezine konmuş) → 401/403, iz yok', async () => {
    const tenant = await createTenant();
    const admin = await createAdminUser(tenant.id);
    const http = agent();
    const { accessToken } = await loginAs(http, admin.email, admin.rawPassword);

    const viaBearer = await http.get(`/api/platform/logs/${errorLogId}/trace`).set(tenantHeaders(tenant.id, accessToken));
    expect(viaBearer.status).toBe(401);
    expect(JSON.stringify(viaBearer.body)).not.toContain('meetingController');

    const viaCookie = await agent()
      .get(`/api/platform/logs/${errorLogId}/trace`)
      .set('Cookie', `platform_token=${encodeURIComponent(accessToken)}`);
    expect(viaCookie.status).toBe(403);
    expect(JSON.stringify(viaCookie.body)).not.toContain('meetingController');

    expect(await testPrisma.systemLog.findFirst({ where: { category: 'AUDIT', message: 'VIEW_PLATFORM_LOG_TRACE' } })).toBeNull();
  });

  it('AJ-102 korunur: liste ucu /api/platform/logs meta/stack döndürmez', async () => {
    const res = await agent().get('/api/platform/logs').set('Cookie', platformCookie());
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('"meta"');
    expect(raw).not.toContain('"stack"');
    expect(raw).not.toContain('meetingController');
  });
});
