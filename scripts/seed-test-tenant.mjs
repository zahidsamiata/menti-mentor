/**
 * İŞ 3 — Panel görsel testi için TEST verisi seed'i. İDEMPOTENT.
 *
 * Oluşturur (hepsi `test-` id / `test-*` slug / `@test.local` e-posta → ayırt edilebilir, silinebilir):
 *   1 kurum (TEST Panel Demo) + 1 admin + 2 mentör + 2 menti (User + UserProfile + TenantMembership)
 *   + 3 görüşme (farklı status/format). DISC tipleri D/I/S/C → dağılım anlamlı.
 *
 * GÜVENLİK:
 *  - Varsayılan DRY-RUN; yazmak için `--apply`. Hedef DB host'unu loglar.
 *  - Tüm e-postalar `@test.local` → emailService.isUndeliverableRecipient bunları ATLAR → hiç mail gitmez.
 *  - Idempotent upsert (email/slug/userId/id unique) → tekrar çalışınca çift kayıt YOK.
 *  - Yalnızca YENİ test kayıtları ekler; mevcut hiçbir kaydı değiştirmez (update:{}).
 *
 * KULLANIM (backend dizininde, izole branch'e yönlendirilmiş DATABASE_URL ile):
 *   node scripts/seed-test-tenant.mjs            # dry-run
 *   node scripts/seed-test-tenant.mjs --apply    # uygula
 */
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

let url = process.env.DATABASE_URL;
if (!url) {
  try {
    const t = readFileSync('.env', 'utf8');
    const m = t.match(/^DATABASE_URL=(.*)$/m);
    if (m) url = m[1].trim().replace(/^["']|["']$/g, '').replace(/\r$/, '');
  } catch { /* yok */ }
}
if (!url) { console.error('[seed] HATA: DATABASE_URL yok.'); process.exit(1); }

const host = (url.split('@')[1] || '').split('/')[0] || '(bilinmiyor)';
const APPLY = process.argv.includes('--apply');
console.log(`[seed] hedef DB host: ${host}`);
console.log(`[seed] mod: ${APPLY ? 'APPLY (yazacak)' : 'DRY-RUN (yazmaz)'}`);

const TENANT = { id: 'test-tenant-panel', slug: 'test-panel-demo', name: 'TEST Panel Demo Derneği' };
const TEST_PASSWORD = 'TestPanel!2026'; // test-düzeyi; login için (rapora yazılır)
const USERS = [
  { id: 'test-u-admin',   email: 'admin@test.local',   fullName: 'TEST Yönetici',  role: 'ADMIN',  discType: null },
  { id: 'test-u-mentor1', email: 'mentor1@test.local', fullName: 'TEST Mentör Bir', role: 'MENTOR', discType: 'D' },
  { id: 'test-u-mentor2', email: 'mentor2@test.local', fullName: 'TEST Mentör İki', role: 'MENTOR', discType: 'I' },
  { id: 'test-u-menti1',  email: 'menti1@test.local',  fullName: 'TEST Menti Bir',  role: 'MENTI',  discType: 'S' },
  { id: 'test-u-menti2',  email: 'menti2@test.local',  fullName: 'TEST Menti İki',  role: 'MENTI',  discType: 'C' },
];
const disc = (t) => ({ D: { discD: 0.7, discI: 0.1, discS: 0.1, discC: 0.1 }, I: { discD: 0.1, discI: 0.7, discS: 0.1, discC: 0.1 }, S: { discD: 0.1, discI: 0.1, discS: 0.7, discC: 0.1 }, C: { discD: 0.1, discI: 0.1, discS: 0.1, discC: 0.7 } }[t] ?? { discD: 0.25, discI: 0.25, discS: 0.25, discC: 0.25 });

const day = 24 * 3600 * 1000;
const now = Date.now();
const MEETINGS = [
  { id: 'test-mtg-1', mentor: 'test-u-mentor1', menti: 'test-u-menti1', status: 'COMPLETED', format: 'ONLINE',    starts: now - 3 * day, hasFeedback: true },
  { id: 'test-mtg-2', mentor: 'test-u-mentor1', menti: 'test-u-menti2', status: 'APPROVED',  format: 'ONLINE',    starts: now + 2 * day, hasFeedback: false },
  { id: 'test-mtg-3', mentor: 'test-u-mentor2', menti: 'test-u-menti1', status: 'PENDING',   format: 'IN_PERSON', starts: now + 5 * day, hasFeedback: false },
];

if (!APPLY) {
  console.log(`[seed] DRY-RUN — oluşturulacak: 1 kurum (${TENANT.slug}), ${USERS.length} kullanıcı (${USERS.map((u) => u.role).join(',')}), ${MEETINGS.length} görüşme.`);
  console.log('[seed] Uygulamak için: node scripts/seed-test-tenant.mjs --apply');
  process.exit(0);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  const pw = await bcrypt.hash(TEST_PASSWORD, 12);

  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT.slug },
    create: { id: TENANT.id, slug: TENANT.slug, name: TENANT.name, verificationStatus: 'APPROVED', isActive: true, plan: 'FREE', onboardingStep: 'DONE' },
    update: {},
  });
  console.log(`[seed] kurum: ${tenant.slug} (${tenant.id})`);

  for (const u of USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: {
        id: u.id, tenantId: tenant.id, email: u.email, fullName: u.fullName, role: u.role,
        password: pw, authProvider: 'LOCAL', approvalStatus: 'APPROVED', isActive: true,
        kvkkConsentAt: new Date(), discType: u.discType ?? undefined,
      },
      update: {},
    });
    await prisma.tenantMembership.upsert({
      where: { userId_tenantId: { userId: u.id, tenantId: tenant.id } },
      create: { userId: u.id, tenantId: tenant.id, role: u.role, isActive: true },
      update: {},
    });
    if (u.discType) {
      await prisma.userProfile.upsert({
        where: { userId: u.id },
        create: { userId: u.id, archetypeRole: u.role === 'MENTOR' ? 'MENTOR' : 'MENTI', ...disc(u.discType) },
        update: {},
      });
    }
  }
  console.log(`[seed] ${USERS.length} kullanıcı + membership + profil hazır.`);

  for (const m of MEETINGS) {
    await prisma.meeting.upsert({
      where: { id: m.id },
      create: {
        id: m.id, tenantId: tenant.id, mentorUserId: m.mentor, mentiUserId: m.menti,
        startsAt: new Date(m.starts), endsAt: new Date(m.starts + 3600 * 1000),
        status: m.status, format: m.format, durationMin: 60, hasFeedback: m.hasFeedback,
        requestMessage: 'TEST-SEED görüşme kaydı — panel demo.',
      },
      update: {},
    });
  }
  console.log(`[seed] ${MEETINGS.length} görüşme hazır.`);
  console.log('[seed] TAMAM. Login şifresi (tüm test hesapları): ' + TEST_PASSWORD);
} finally {
  await prisma.$disconnect();
}
