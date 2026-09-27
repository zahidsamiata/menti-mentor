/**
 * AJ-50 — BİR KEZLİK veri temizliği: User.discResultCard içinden ham `discVector` + `rawScores`.
 * Saf mantık + DB adımları: src/services/discCardCleanup.ts (runDiscCardCleanup). Bu dosya yalnız CLI + env.
 *
 * 🔵 CANLI VERİYE YAZMA — yalnız PO "EVET"i sonrası (docs/otonom/01-KARARLAR.md kartı).
 * ⚠️ CANLI = LOKAL AYNI NEON DB → yanlış host'ta koşma; host her koşuda loglanır.
 * Migration DEĞİL (şema değişmez) → migrate history'ye girmez.
 *
 * KULLANIM (backend dizininde):
 *   npx tsx scripts/cleanup-disc-card-raw-keys.ts
 *       → KURU ÇALIŞMA: etkilenecek kayıt sayısı + maskeli örnek kimlik. YAZMAZ.
 *   npx tsx scripts/cleanup-disc-card-raw-keys.ts --uygula --onay="TEMIZLE <host>"
 *       → (1) tarihli yedek tablo "User_discResultCard_yedek_YYYYMMDD" (id + discResultCard)
 *         (2) UPDATE "User" SET "discResultCard" = "discResultCard" - 'discVector' - 'rawScores'
 *         Tek transaction; sayılar tutmazsa geri alınır. Hedef TEST_DATABASE_URL host'u ise --onay istenmez.
 *   DATABASE_URL env'de yoksa aynı dizindeki .env'den okunur.
 *
 * GERİ ALMA (gerekirse):
 *   UPDATE "User" u SET "discResultCard" = y."discResultCard"
 *   FROM "User_discResultCard_yedek_YYYYMMDD" y WHERE u.id = y.id;
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import {
  checkApplyAllowed,
  hostOf,
  runDiscCardCleanup,
  type CleanupDb,
} from '../src/services/discCardCleanup.js';

const TAG = '[disc-kart-temizlik]';

function readDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const t = readFileSync('.env', 'utf8');
    const m = t.match(/^DATABASE_URL=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '').replace(/\r$/, '');
  } catch { /* .env yok */ }
  return undefined;
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
}

async function main(): Promise<void> {
  const url = readDatabaseUrl();
  if (!url) { console.error(`${TAG} HATA: DATABASE_URL bulunamadı.`); process.exit(1); }

  const apply = process.argv.includes('--uygula');
  console.log(`${TAG} hedef DB host: ${hostOf(url)}`);
  console.log(`${TAG} mod: ${apply ? 'UYGULA (yedek + yazma)' : 'KURU ÇALIŞMA (yazmaz)'}`);

  if (apply) {
    const gate = checkApplyAllowed({ targetUrl: url, testUrl: process.env.TEST_DATABASE_URL, confirmation: argValue('--onay') });
    if (!gate.ok) { console.error(`${TAG} DUR: ${gate.reason}`); process.exit(1); }
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const report = await runDiscCardCleanup(prisma as unknown as CleanupDb, { apply, now: new Date() });
    console.log(`${TAG} etkilenecek kayıt: ${report.affected}`);
    console.log(`${TAG} örnek (maskeli): ${report.sampleMaskedIds.join(', ') || '(yok)'}`);
    if (report.mode === 'KURU') {
      console.log(`${TAG} KURU ÇALIŞMA bitti. Yedek tablo adı olacak: ${report.backupTable}`);
      return;
    }
    if (report.affected === 0) { console.log(`${TAG} temizlenecek kayıt yok — yedek alınmadı, yazılmadı.`); return; }
    console.log(`${TAG} yedek: ${report.backupTable} · ${report.backedUp} satır`);
    console.log(`${TAG} güncellenen: ${report.updated} · kalan (0 olmalı): ${report.remaining}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
