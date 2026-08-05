/**
 * b3 Backfill — Eksik TenantMembership kayıtlarını oluşturur (idempotent).
 *
 * NEDEN: Tarihsel olarak TenantMembership yalnızca kurucu ADMIN için oluşturuluyordu.
 * Bu script, membership'i olmayan her User için (kendi tenant'ında) bir kayıt oluşturur
 * → panel/sayım kaynağı TenantMembership.role gerçek veriyle dolar.
 *
 * GÜVENLİK:
 *  - Varsayılan DRY-RUN: yalnızca sayar, YAZMAZ. Yazmak için `--apply` ver.
 *  - Idempotent: @@unique[userId,tenantId] + upsert(update:{}) → tekrar çalışınca çift kayıt/patlama YOK,
 *    MEVCUT membership'ler DEĞİŞMEZ (yalnızca eksik olanlar eklenir).
 *  - Hedef DB host'unu (secret'sız) loglar → yanlış DB'ye yazmayı yakala.
 *
 * KULLANIM:
 *   Dev:  (backend dizininde)  node scripts/backfill-memberships.mjs            # dry-run
 *         (backend dizininde)  node scripts/backfill-memberships.mjs --apply    # uygula
 *   PROD: Prod ortamında DATABASE_URL set iken (ör. prod konteynerinde):
 *         node scripts/backfill-memberships.mjs            # önce dry-run, sayıyı gör
 *         node scripts/backfill-memberships.mjs --apply    # sonra uygula (tek seferlik, idempotent)
 *   DATABASE_URL env'de yoksa aynı dizindeki .env'den okunur.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

let url = process.env.DATABASE_URL;
if (!url) {
  try {
    const t = readFileSync('.env', 'utf8');
    const m = t.match(/^DATABASE_URL=(.*)$/m);
    if (m) url = m[1].trim().replace(/^["']|["']$/g, '').replace(/\r$/, '');
  } catch { /* .env yok */ }
}
if (!url) { console.error('[backfill] HATA: DATABASE_URL bulunamadı.'); process.exit(1); }

const host = (url.split('@')[1] || '').split('/')[0] || '(bilinmiyor)';
const APPLY = process.argv.includes('--apply');
console.log(`[backfill] hedef DB host: ${host}`);
console.log(`[backfill] mod: ${APPLY ? 'APPLY (yazacak)' : 'DRY-RUN (yazmaz)'}`);

const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  const [users, mems] = await Promise.all([
    prisma.user.findMany({ select: { id: true, tenantId: true, role: true, isActive: true } }),
    prisma.tenantMembership.findMany({ select: { userId: true, tenantId: true } }),
  ]);
  const have = new Set(mems.map((m) => `${m.userId}:${m.tenantId}`));
  const missing = users.filter((u) => !have.has(`${u.id}:${u.tenantId}`));

  console.log(`[backfill] toplam user: ${users.length} | mevcut membership: ${mems.length} | kendi-tenant'ında membership EKSİK: ${missing.length}`);

  if (!APPLY) {
    console.log('[backfill] DRY-RUN bitti. Uygulamak için: node scripts/backfill-memberships.mjs --apply');
  } else {
    let added = 0;
    for (const u of missing) {
      await prisma.tenantMembership.upsert({
        where: { userId_tenantId: { userId: u.id, tenantId: u.tenantId } },
        create: { userId: u.id, tenantId: u.tenantId, role: u.role, isActive: u.isActive },
        update: {}, // idempotent: mevcut kaydı değiştirme
      });
      added++;
    }
    console.log(`[backfill] eklenen membership: ${added}`);
    // Doğrulama: tekrar tara, kalan eksik 0 olmalı.
    const [users2, mems2] = await Promise.all([
      prisma.user.findMany({ select: { id: true, tenantId: true } }),
      prisma.tenantMembership.findMany({ select: { userId: true, tenantId: true } }),
    ]);
    const have2 = new Set(mems2.map((m) => `${m.userId}:${m.tenantId}`));
    const remaining = users2.filter((u) => !have2.has(`${u.id}:${u.tenantId}`)).length;
    console.log(`[backfill] kalan eksik (0 olmalı): ${remaining}`);
  }
} finally {
  await prisma.$disconnect();
}
