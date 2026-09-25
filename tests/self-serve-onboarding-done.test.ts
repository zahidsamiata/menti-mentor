/**
 * KR-23 / KARAR-81 — self-serve kayıt başarılıysa kurum aynı işlemde "kurulum tamamlandı"
 * (onboardingStep=DONE) olarak açılır; taslak temizliğinin hedefine girmez.
 * Negatif: kayıt reddedilirse (ör. aynı e-posta) kurum hiç oluşmaz.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { agent, type TestAgent } from './helpers/request.js';
import { cleanDb, testPrisma } from './helpers/db.js';

function payload(email: string, slug: string) {
  return {
    email,
    password: 'Test1234!',
    name: 'Test Admin',
    tenantName: `Test Kurum ${slug}`,
    slug,
    programTemplate: 'OZEL',
    kvkkConsent: true,
    institutionRole: 'Kulüp Başkanı',
    verificationNote: 'https://example.com/kanit',
  };
}

describe('KR-23: kurum kaydında kurulum işareti', () => {
  let http: TestAgent;

  beforeEach(async () => {
    await cleanDb();
    http = agent();
  });

  it('kurumsal ve onay bekleyen kayıtta kurum DONE açılır (ayrı istek gerekmez)', async () => {
    await http.post('/api/tenants/self-serve/register').send(payload('admin@kurum-ornek.org.tr', 'kr23-kurum')).expect(201);
    await http.post('/api/tenants/self-serve/register').send(payload('biri@gmail.com', 'kr23-bekleyen')).expect(201);
    const tenants = await testPrisma.tenant.findMany({
      where: { slug: { in: ['kr23-kurum', 'kr23-bekleyen'] } },
      select: { slug: true, onboardingStep: true },
    });
    expect(tenants).toHaveLength(2);
    for (const t of tenants) expect(t.onboardingStep, t.slug).toBe('DONE');
  });

  it('negatif: aynı e-postayla ikinci başvuruda ikinci kurum hiç oluşmaz', async () => {
    await http.post('/api/tenants/self-serve/register').send(payload('tekrar@kurum-ornek.org.tr', 'kr23-ilk')).expect(201);
    // GV-12: kayıtlı e-posta numaralandırmayı önlemek için 409 yerine yeni kayıtla aynı 201 alır
    // (kurum oluşturulmaz) — ayrıntı: self-serve-register-enumeration.test.ts
    await http.post('/api/tenants/self-serve/register').send(payload('tekrar@kurum-ornek.org.tr', 'kr23-ikinci')).expect(201);
    expect(await testPrisma.tenant.count({ where: { slug: 'kr23-ikinci' } })).toBe(0);
  });
});
