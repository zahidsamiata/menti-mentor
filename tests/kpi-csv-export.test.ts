/**
 * F-18 — GET /api/admin/kpi/export: kurum yöneticisi KPI raporunu CSV indirir.
 * Yalnız toplu metrikler (panelle aynı kaynak), k-anonimlik, tenant izolasyonu, rol kapısı.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, loginAs, tenantHeaders, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';
import { createTenant, createMentor, createMenti, createAdminUser } from './helpers/factories.js';
import { SUPPRESSED_CELL_TEXT } from '../src/services/kpiReport.service.js';
import type { Tenant } from '@prisma/client';

const EXPORT_URL = '/api/admin/kpi/export';

describe('F-18: KPI raporu CSV dışa aktarımı', () => {
  let http: TestAgent;
  let tenant: Tenant;
  let adminToken: string;
  let mentor: Awaited<ReturnType<typeof createMentor>>;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
    tenant = await createTenant({ name: 'Birinci Dernek' });
    const admin = await createAdminUser(tenant.id);
    mentor = await createMentor(tenant.id);
    adminToken = (await loginAs(http, admin.email, admin.rawPassword)).accessToken;
  });

  async function addFeedback(tenantId: string, mentorId: string, phase: number, npsScore: number) {
    const menti = await createMenti(tenantId);
    await testPrisma.feedbackLog.create({
      data: { tenantId, mentorId, mentiId: menti.id, phase, starRating: 4, npsScore, goalAchieved: 'EVET' },
    });
  }

  it('admin → 200, text/csv, ek olarak iner, BOM + Türkçe başlıklar', async () => {
    const res = await http.get(EXPORT_URL).set(tenantHeaders(tenant.id, adminToken)).buffer(true).expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="kpi-raporu-${tenant.slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    const csv = res.text;
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')[0]).toBe('Bölüm;Metrik;Değer;Açıklama');
    expect(csv).toContain('Toplam aktif kullanıcı;');
    expect(csv).toContain('Birinci Dernek');
  });

  it('panelle aynı sayılar: 3+ yanıtlı dönem görünür', async () => {
    await addFeedback(tenant.id, mentor.id, 3, 9);
    await addFeedback(tenant.id, mentor.id, 3, 6);
    await addFeedback(tenant.id, mentor.id, 3, 3);
    const panel = await http.get('/api/admin/kpi').set(tenantHeaders(tenant.id, adminToken)).expect(200);
    const res = await http.get(EXPORT_URL).set(tenantHeaders(tenant.id, adminToken)).buffer(true).expect(200);
    expect(res.text).toContain('Geri bildirim;3. ay NPS ortalaması (0-10);6;');
    expect(res.text).toContain('Geri bildirim;3. ay yanıt sayısı;3;');
    expect(res.text).toContain(`Kullanıcılar;Toplam aktif kullanıcı;${panel.body.stats.totalActiveUsers};`);
  });

  it('k-anonim: 3 yanıttan az dönem "gizli" yazılır, gerçek ortalama/sayı CSV\'de yok', async () => {
    await addFeedback(tenant.id, mentor.id, 1, 9);
    await addFeedback(tenant.id, mentor.id, 1, 2);
    const res = await http.get(EXPORT_URL).set(tenantHeaders(tenant.id, adminToken)).buffer(true).expect(200);
    expect(res.text).toContain(`Geri bildirim;1. ay NPS ortalaması (0-10);${SUPPRESSED_CELL_TEXT};`);
    expect(res.text).toContain(`Geri bildirim;1. ay yanıt sayısı;${SUPPRESSED_CELL_TEXT};`);
    expect(res.text).not.toMatch(/1\. ay NPS ortalaması \(0-10\);\d/);
    expect(res.text).not.toMatch(/1\. ay yanıt sayısı;\d/);
  });

  it('CSV\'de hiçbir kişinin adı ya da e-postası yok', async () => {
    const menti = await createMenti(tenant.id);
    const res = await http.get(EXPORT_URL).set(tenantHeaders(tenant.id, adminToken)).buffer(true).expect(200);
    const users = await testPrisma.user.findMany({ where: { tenantId: tenant.id }, select: { fullName: true, email: true } });
    expect(users.length).toBeGreaterThanOrEqual(3);
    for (const u of users) {
      expect(res.text).not.toContain(u.email);
      expect(res.text).not.toContain(u.fullName);
    }
    expect(res.text).not.toContain(menti.id);
    expect(res.text).not.toMatch(/@/);
  });

  it('başka kurumun verisi CSV\'ye girmez', async () => {
    const other = await createTenant({ name: 'Ikinci Vakif' });
    const otherMentor = await createMentor(other.id);
    for (let i = 0; i < 5; i++) await createMenti(other.id);
    for (let i = 0; i < 3; i++) await addFeedback(other.id, otherMentor.id, 2, 10);

    const before = await http.get(EXPORT_URL).set(tenantHeaders(tenant.id, adminToken)).buffer(true).expect(200);
    // Birinci kurum: 1 admin + 1 mentör aktif; ikinci kurumun 2. ay yanıtları görünmemeli.
    expect(before.text).toContain('Kullanıcılar;Toplam aktif kullanıcı;2;');
    expect(before.text).not.toContain('2. ay');
    expect(before.text).not.toContain('Ikinci Vakif');
    expect(before.text).not.toContain(other.slug);
  });

  it('negatif: başka kurumun X-Tenant-Id başlığıyla o kurumun raporu alınamaz', async () => {
    const other = await createTenant({ name: 'Ikinci Vakif' });
    const res = await http.get(EXPORT_URL).set(tenantHeaders(other.id, adminToken)).buffer(true);
    expect(res.status).not.toBe(200);
    expect(res.text ?? '').not.toContain('Ikinci Vakif');
  });

  it('negatif: MENTOR → 403', async () => {
    const m = await createMentor(tenant.id);
    const { accessToken } = await loginAs(http, m.email, m.rawPassword);
    await http.get(EXPORT_URL).set(tenantHeaders(tenant.id, accessToken)).expect(403);
  });

  it('negatif: MENTI → 403', async () => {
    const m = await createMenti(tenant.id);
    const { accessToken } = await loginAs(http, m.email, m.rawPassword);
    await http.get(EXPORT_URL).set(tenantHeaders(tenant.id, accessToken)).expect(403);
  });

  it('negatif: kimliksiz → 401', async () => {
    await agent().get(EXPORT_URL).set(tenantHeaders(tenant.id)).expect(401);
  });

  it('denetim izi: AUDIT kaydı düşer, içinde PII yok', async () => {
    await http.get(EXPORT_URL).set(tenantHeaders(tenant.id, adminToken)).buffer(true).expect(200);
    const logs = await testPrisma.systemLog.findMany({ where: { message: 'KPI raporu dışa aktarıldı' } });
    expect(logs.length).toBe(1);
    expect(JSON.stringify(logs[0])).not.toMatch(/@/);
  });
});
