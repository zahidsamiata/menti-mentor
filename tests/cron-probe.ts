/**
 * Cron runtime kanıt scripti — sadece manuel çalıştırma için.
 *
 * runDraftTenantReminder + runDraftTenantCleanup fonksiyonlarını
 * gerçek DB'ye karşı kontrollü şekilde doğrular:
 *
 *   1. Reminder: 73h eski TEMPLATE taslak → reminderEmailSentAt set olmalı
 *   2. Skip:    unsubscribedAt dolu taslak → atlanmalı (reminderEmailSentAt null kalmalı)
 *   3. Cleanup dry-run: 97h eski taslak → önce count, ardından sil
 *   4. Cleanup verify: 73h eski taslak → silinmemeli (96h eşiğini geçmedi)
 *
 * Çalıştırma (Windows PowerShell — SMTP boş bırakılarak gerçek e-posta engellenir):
 *   $env:SMTP_USER=''; $env:SMTP_PASS=''; npx tsx tests/cron-probe.ts
 */

import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });
// SMTP'yi boşalt — config.ts bu dosyadan önce yüklenmemiş olduğundan
// dinamik import zinciri (cronScheduler → emailService → config) bu değerleri görür.
process.env['SMTP_USER'] = '';
process.env['SMTP_PASS'] = '';

const probe = new PrismaClient();
const MARKER = 'CRON_PROBE';

// ─── Yardımcılar ──────────────────────────────────────────────────────────────

async function cleanProbeData() {
  await probe.user.deleteMany({ where: { email: { contains: MARKER } } });
  await probe.tenant.deleteMany({ where: { slug: { contains: MARKER } } });
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅ PASS: ${message}`);
  }
}

// ─── Ana akış ─────────────────────────────────────────────────────────────────

async function main() {
  await cleanProbeData();

  const now = Date.now();
  const ts  = now;
  const h73ago = new Date(now - 73 * 3600_000);
  const h97ago = new Date(now - 97 * 3600_000);

  // ── Test tenant'larını oluştur ────────────────────────────────────────────

  // (A) Reminder alması gereken tenant
  const tA = await probe.tenant.create({
    data: {
      name:               `${MARKER}_A_${ts}`,
      slug:               `${MARKER}-a-${ts}`.toLowerCase(),
      displayName:        `Probe-A Reminder`,
      onboardingStep:     'TEMPLATE',
      unsubscribeToken:   crypto.randomUUID(),
      isActive:           true,
      isSharedPoolActive: false,
    },
  });
  // createdAt'i geri al (Prisma @default(now()) override için raw SQL)
  await probe.$executeRaw`UPDATE "Tenant" SET "createdAt" = ${h73ago} WHERE id = ${tA.id}`;

  // Admin kullanıcısı (cron reminder için gerekli)
  await probe.user.create({
    data: {
      tenantId:     tA.id,
      email:        `admin-${MARKER}-a-${ts}@probe.test`,
      fullName:     'Probe Admin A',
      role:         'ADMIN',
      isActive:     true,
      authProvider: 'LOCAL',
    },
  });

  // (B) Unsubscribe edilmiş → atlanmalı
  const tB = await probe.tenant.create({
    data: {
      name:               `${MARKER}_B_${ts}`,
      slug:               `${MARKER}-b-${ts}`.toLowerCase(),
      displayName:        `Probe-B Unsub`,
      onboardingStep:     'LOGO',
      unsubscribeToken:   crypto.randomUUID(),
      unsubscribedAt:     new Date(now - 5 * 3600_000),
      isActive:           true,
      isSharedPoolActive: false,
    },
  });
  await probe.$executeRaw`UPDATE "Tenant" SET "createdAt" = ${h73ago} WHERE id = ${tB.id}`;

  await probe.user.create({
    data: {
      tenantId:     tB.id,
      email:        `admin-${MARKER}-b-${ts}@probe.test`,
      fullName:     'Probe Admin B',
      role:         'ADMIN',
      isActive:     true,
      authProvider: 'LOCAL',
    },
  });

  // (C) Temizlik için 97h eski taslak
  const tC = await probe.tenant.create({
    data: {
      name:               `${MARKER}_C_${ts}`,
      slug:               `${MARKER}-c-${ts}`.toLowerCase(),
      displayName:        `Probe-C Cleanup`,
      onboardingStep:     'PREVIEW',
      isActive:           true,
      isSharedPoolActive: false,
    },
  });
  await probe.$executeRaw`UPDATE "Tenant" SET "createdAt" = ${h97ago} WHERE id = ${tC.id}`;

  console.log(`\n${'─'.repeat(60)}`);
  console.log('CRON PROBE — Test tenant\'ları hazır');
  console.log(`  A (73h, TEMPLATE, unsubscribeToken set) : ${tA.id}`);
  console.log(`  B (73h, LOGO,     unsubscribedAt set)   : ${tB.id}`);
  console.log(`  C (97h, PREVIEW)                        : ${tC.id}`);

  // ── TEST 1: runDraftTenantReminder ────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log('TEST 1 — runDraftTenantReminder');

  const { runDraftTenantReminder } = await import('../src/services/cronScheduler.js');
  await runDraftTenantReminder();

  const afterA = await probe.tenant.findUnique({ where: { id: tA.id }, select: { reminderEmailSentAt: true } });
  const afterB = await probe.tenant.findUnique({ where: { id: tB.id }, select: { reminderEmailSentAt: true } });

  assert(afterA?.reminderEmailSentAt != null,  'Tenant-A reminderEmailSentAt set edildi');
  assert(afterB?.reminderEmailSentAt == null,  'Tenant-B (unsubscribed) atlandı — reminderEmailSentAt null kaldı');

  // ── TEST 2: runDraftTenantCleanup — dry-run ───────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log('TEST 2 — runDraftTenantCleanup (önce dry-run)');

  const DRAFT_STEPS = ['TEMPLATE', 'LOGO', 'PREVIEW'];
  const cutoff96h   = new Date(now - 96 * 3600_000);

  const wouldDelete = await probe.tenant.findMany({
    where: {
      onboardingStep: { in: DRAFT_STEPS },
      createdAt:      { lt: cutoff96h },
      isActive:       true,
    },
    select: { id: true, name: true, createdAt: true },
  });

  console.log(`  Dry-run: ${wouldDelete.length} tenant eşleşti:`);
  for (const t of wouldDelete) {
    const isProbe = t.name.includes(MARKER);
    console.log(`    • ${t.id} | ${t.name} | probe=${isProbe}`);
  }

  const nonProbe = wouldDelete.filter(t => !t.name.includes(MARKER));
  if (nonProbe.length > 0) {
    console.error('\n❌ SAFETY STOP: Probe dışı gerçek tenant eşleşti — silme iptal edildi!');
    console.error('   Eşleşenler:', nonProbe.map(t => `${t.id} (${t.name})`));
    await cleanProbeData();
    await probe.$disconnect();
    process.exit(1);
  }

  // Yalnızca probe tenant'ları eşleşti → güvenli
  const { runDraftTenantCleanup } = await import('../src/services/cronScheduler.js');
  await runDraftTenantCleanup();

  const afterC = await probe.tenant.findUnique({ where: { id: tC.id } });
  const afterA2 = await probe.tenant.findUnique({ where: { id: tA.id } });

  assert(afterC  == null, 'Tenant-C (97h) silindi');
  assert(afterA2 != null, 'Tenant-A (73h) silinmedi — 96h eşiğini geçmedi');

  // ── Temizlik ──────────────────────────────────────────────────────────────
  await cleanProbeData();

  console.log(`\n${'─'.repeat(60)}`);
  if (process.exitCode === 1) {
    console.log('CRON PROBE tamamlandı — bazı testler başarısız.');
  } else {
    console.log('CRON PROBE tamamlandı — tüm testler PASS ✅');
  }

  await probe.$disconnect();
}

main().catch(async (err) => {
  console.error('[PROBE FATAL]', err);
  await cleanProbeData().catch(() => {});
  await probe.$disconnect().catch(() => {});
  process.exit(1);
});
