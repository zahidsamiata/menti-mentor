/**
 * G1-07 Backfill çalıştırıcısı — eski kvkkConsentAt'ı Consent tablosuna taşır (idempotent).
 * Saf mantık: src/services/consentBackfill.ts (planBackfill). Bu dosya yalnız DB I/O + CLI.
 *
 * ⚠️ G1-16 ile aynı iş — kullanıcı ~sıfırken neredeyse bedava. YALNIZ ACIK_RIZA (PO kararı).
 * ⚠️ CANLI = LOKAL AYNI NEON DB → PROD'da yalnız PO onayı ile (Tur B).
 *
 * KULLANIM (backend dizininde):
 *   npx tsx scripts/backfill-consent.ts            # dry-run (sayıyı gör, YAZMAZ)
 *   npx tsx scripts/backfill-consent.ts --apply    # uygula (tek seferlik, idempotent)
 *   DATABASE_URL env'de yoksa aynı dizindeki .env'den okunur.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { planBackfill } from '../src/services/consentBackfill.js';

async function main(): Promise<void> {
  let url = process.env.DATABASE_URL;
  if (!url) {
    try {
      const t = readFileSync('.env', 'utf8');
      const m = t.match(/^DATABASE_URL=(.*)$/m);
      if (m) url = m[1].trim().replace(/^["']|["']$/g, '').replace(/\r$/, '');
    } catch { /* .env yok */ }
  }
  if (!url) { console.error('[backfill-consent] HATA: DATABASE_URL bulunamadı.'); process.exit(1); }

  const host = (url.split('@')[1] || '').split('/')[0] || '(bilinmiyor)';
  const APPLY = process.argv.includes('--apply');
  console.log(`[backfill-consent] hedef DB host: ${host}`);
  console.log(`[backfill-consent] mod: ${APPLY ? 'APPLY (yazacak)' : 'DRY-RUN (yazmaz)'}`);
  console.log('[backfill-consent] yazılacak tip: ACIK_RIZA (AYDINLATMA YAZILMAZ — PO kararı)');

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [users, tenants, existing] = await Promise.all([
      prisma.user.findMany({ where: { kvkkConsentAt: { not: null } }, select: { id: true, kvkkConsentAt: true } }),
      prisma.tenant.findMany({ where: { kvkkConsentAt: { not: null } }, select: { id: true, kvkkConsentAt: true } }),
      prisma.consent.findMany({ where: { type: 'ACIK_RIZA' }, select: { userId: true, tenantId: true } }),
    ]);

    const { rows, missingUsers, missingTenants } = planBackfill({ users, tenants, existing });
    console.log(`[backfill-consent] User kvkkConsentAt dolu: ${users.length} | ACIK_RIZA EKSİK: ${missingUsers.length}`);
    console.log(`[backfill-consent] Tenant kvkkConsentAt dolu: ${tenants.length} | ACIK_RIZA EKSİK: ${missingTenants.length}`);

    if (!APPLY) {
      console.log(`[backfill-consent] DRY-RUN bitti. Yazılacak toplam satır: ${rows.length}. Uygulamak için: npx tsx scripts/backfill-consent.ts --apply`);
      return;
    }

    console.log('[backfill-consent] APPLY modu — 5 sn içinde başlıyor (durdurmak için Ctrl+C)...');
    await new Promise((r) => setTimeout(r, 5000));

    const result = rows.length ? await prisma.consent.createMany({ data: rows }) : { count: 0 };
    console.log(`[backfill-consent] yazılan ACIK_RIZA satırı: ${result.count} (user ${missingUsers.length} + tenant ${missingTenants.length})`);

    // Doğrulama: tekrar tara, kalan eksik 0 olmalı.
    const existing2 = await prisma.consent.findMany({ where: { type: 'ACIK_RIZA' }, select: { userId: true, tenantId: true } });
    const { rows: remaining } = planBackfill({ users, tenants, existing: existing2 });
    console.log(`[backfill-consent] kalan eksik (0 olmalı): ${remaining.length}`);
    console.log('[backfill-consent] Hata olursa: idempotent → yeniden çalıştırılabilir (mevcut satırlar atlanır).');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
