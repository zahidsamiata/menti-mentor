/**
 * İŞ 3 TEMİZLİK — seed-test-tenant.mjs ile eklenen TEST verisini güvenle siler.
 *
 * GÜVENLİK:
 *  - YALNIZCA slug 'test-panel-demo' olan kuruma ve onun kullanıcılarına dokunur (hard guard).
 *    Başka/gerçek kurumları ASLA silmez.
 *  - Varsayılan DRY-RUN; silmek için `--apply`. Hedef DB host'unu loglar.
 *  - FK-güvenli sıra: görüşmeler → membership → profil → token'lar → kullanıcılar → kurum.
 *
 * KULLANIM (backend dizininde, test branch'e yönlendirilmiş DATABASE_URL ile):
 *   node scripts/delete-test-data.mjs            # dry-run (ne silineceğini sayar)
 *   node scripts/delete-test-data.mjs --apply    # sil
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const TEST_SLUG = 'test-panel-demo';

let url = process.env.DATABASE_URL;
if (!url) {
  try {
    const t = readFileSync('.env', 'utf8');
    const m = t.match(/^DATABASE_URL=(.*)$/m);
    if (m) url = m[1].trim().replace(/^["']|["']$/g, '').replace(/\r$/, '');
  } catch { /* yok */ }
}
if (!url) { console.error('[cleanup] HATA: DATABASE_URL yok.'); process.exit(1); }

const host = (url.split('@')[1] || '').split('/')[0] || '(bilinmiyor)';
const APPLY = process.argv.includes('--apply');
console.log(`[cleanup] hedef DB host: ${host}`);
console.log(`[cleanup] mod: ${APPLY ? 'APPLY (silecek)' : 'DRY-RUN (silmez)'}`);

const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TEST_SLUG }, select: { id: true, slug: true } });
  if (!tenant) { console.log(`[cleanup] '${TEST_SLUG}' kurumu yok — silinecek bir şey yok.`); process.exit(0); }
  // HARD GUARD: yalnızca beklenen test slug'ı.
  if (tenant.slug !== TEST_SLUG) { console.error('[cleanup] GUARD: beklenmeyen slug, iptal.'); process.exit(1); }
  const tid = tenant.id;

  const userIds = (await prisma.user.findMany({ where: { tenantId: tid }, select: { id: true } })).map((u) => u.id);
  const counts = {
    meetings: await prisma.meeting.count({ where: { tenantId: tid } }),
    memberships: await prisma.tenantMembership.count({ where: { tenantId: tid } }),
    users: userIds.length,
  };
  console.log(`[cleanup] silinecek: görüşme=${counts.meetings}, membership=${counts.memberships}, kullanıcı=${counts.users}, kurum=1 (${TEST_SLUG})`);

  if (!APPLY) { console.log('[cleanup] DRY-RUN bitti. Silmek için --apply.'); process.exit(0); }

  await prisma.meeting.deleteMany({ where: { tenantId: tid } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: tid } });
  if (userIds.length) {
    await prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  }
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.delete({ where: { id: tid } });
  console.log('[cleanup] TAMAM — TEST verisi silindi.');
} finally {
  await prisma.$disconnect();
}
