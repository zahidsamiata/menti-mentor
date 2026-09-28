/**
 * AJ-08 — package.json'daki `seed:*` npm komutlarının işaret ettiği betiklerde toplu SİLME
 * deseni (deleteMany/.delete(/DELETE FROM/DROP/TRUNCATE/$executeRaw) OLMADIĞINI statik olarak
 * doğrular.
 *
 * NEDEN: `npm run seed` (tsx prisma/seed.ts) toplu deleteMany() çalıştırır — ASLA koşulmaz
 * (bkz. CLAUDE.md § CANLI = LOKAL AYNI DB). `seed:certification` / `seed:learning-journey` /
 * `seed:test-tenant` bu anlamda SİLME yapmıyor İÇİN package.json'a açık adla eklendi. Bu test o
 * varsayımı KOD SEVİYESİNDE kilitler: ileride biri bir "seed:*" komutunu yanlışlıkla silme
 * deseni içeren bir betiğe bağlarsa CI kırmızı olur.
 *
 * ⚠️ KAPSAM SINIRI — bu test "veri değişmez/zararsız" DEMEZ, yalnız "silme deseni yok" der:
 * `updateMany` / içerik ezen `upsert.update` kolu BİLEREK yakalanmıyor. Örn.
 * `seed-certification.ts` yalnız upsert kullanıyor OLSA da: upsert'in `update` kolu soru/şık
 * metnini, puanı ve aktifliği EZER; ayrıca `:307`'deki `certificationQuestion.updateMany(...)`
 * bankada olmayan tüm aktif soruları PASİFLEŞTİRİR — bu SİLME değil ama canlı sertifika
 * havuzunun anlamını değiştiren toplu bir yazımdır (bkz. PR #177 bağımsız inceleme). Böyle bir
 * betiği "seed:*" olarak eklemek CANLI=LOKAL AYNI DB kuralı gereği yine KARAR+yedek şartına
 * tabidir (README'de belirtilir); bu test o riski KAPSAMAZ, yalnız SİLME regresyonunu yakalar.
 *
 * KAPSAM DIŞI: düz "seed" komutu — o zaten bilinen-tehlikelidir, güvenli listede DEĞİL,
 * bu testin kapsamına girmez (silme protokolü: dokunulmaz, kaldırılmaz).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// DELETE FROM / DROP: boşluk esnek (\s+) — raw SQL biçimlerini de yakalar.
// $executeRaw / $executeRawUnsafe: Prisma raw SQL çıkış kapısı — DELETE/DROP/TRUNCATE'ı
// string içine gizleyebilir, bu yüzden çağrının kendisi de tehlikeli sayılır.
const DELETION_PATTERN = /deleteMany|\.delete\s*\(|DELETE\s+FROM|DROP\s+|TRUNCATE|\$executeRaw/i;

function loadPackageJson(): { scripts: Record<string, string> } {
  const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
  return JSON.parse(raw) as { scripts: Record<string, string> };
}

/**
 * npm script komut metninden çalıştırılan dosya yolunu çıkarır.
 * Örn: "tsx prisma/seed-certification.ts" → "prisma/seed-certification.ts"
 *      "node scripts/seed-test-tenant.mjs" → "scripts/seed-test-tenant.mjs"
 */
function extractScriptFilePath(command: string): string {
  const match = command.match(/([\w./-]+\.(?:ts|js|mjs|cjs))(?:\s|$)/);
  if (!match) {
    throw new Error(`komut içinde çalıştırılabilir dosya yolu bulunamadı: "${command}"`);
  }
  return match[1];
}

describe('AJ-08 · seed:* komutlarının hedef betiklerinde silme deseni yok', () => {
  const { scripts } = loadPackageJson();
  const seedCommandNames = Object.keys(scripts).filter(
    (name) => name.startsWith('seed:'),
  );

  it('en az bir "seed:*" komut tanımlı (regresyon: liste boşalmasın)', () => {
    expect(seedCommandNames.length).toBeGreaterThan(0);
  });

  for (const name of seedCommandNames) {
    it(`${name} → hedef betikte deleteMany/.delete(/DELETE FROM/DROP/TRUNCATE/$executeRaw YOK`, () => {
      const command = scripts[name];
      const filePath = extractScriptFilePath(command);
      const content = readFileSync(join(process.cwd(), filePath), 'utf8');
      const offendingLines = content
        .split('\n')
        .map((line, i) => ({ line, i: i + 1 }))
        .filter(({ line }) => DELETION_PATTERN.test(line));

      expect(
        offendingLines,
        `"${name}" (${filePath}) silme deseni içeriyor, güvenli listeden çıkarılmalı:\n` +
          offendingLines.map(({ line, i }) => `  L${i}: ${line.trim()}`).join('\n'),
      ).toEqual([]);
    });
  }

  it('bilinen-tehlikeli düz "seed" komutu güvenli listede DEĞİL; AJ-57 koruma betiğinden geçer', () => {
    expect(seedCommandNames).not.toContain('seed');
    // AJ-57: eski değer "tsx prisma/seed.ts" → onay kapısı (arşiv: docs/arsiv/silinenler-2026-09-28.md).
    expect(scripts['seed']).toBe('tsx scripts/db-guard.ts seed');
  });
});
