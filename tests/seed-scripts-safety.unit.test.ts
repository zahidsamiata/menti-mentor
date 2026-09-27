/**
 * AJ-08 — package.json'daki `seed:*` (güvenli-etiketli) npm komutlarının işaret ettiği
 * betiklerde toplu silme deseni (deleteMany/.delete(/TRUNCATE) OLMADIĞINI statik olarak doğrular.
 *
 * NEDEN: `npm run seed` (tsx prisma/seed.ts) toplu deleteMany() çalıştırır — ASLA koşulmaz
 * (bkz. CLAUDE.md § CANLI = LOKAL AYNI DB). `seed:certification` / `seed:learning-journey` /
 * `seed:test-tenant` yalnız upsert kullandığı İÇİN "güvenli" kabul edildi ve package.json'a
 * açık adla eklendi. Bu test o varsayımı KOD SEVİYESİNDE kilitler: ileride biri bir "seed:*"
 * komutunu yanlışlıkla tehlikeli bir betiğe (deleteMany/delete/TRUNCATE içeren) bağlarsa CI kırmızı olur.
 *
 * KAPSAM DIŞI: düz "seed" komutu — o zaten bilinen-tehlikelidir, güvenli listede DEĞİL,
 * bu testin kapsamına girmez (silme protokolü: dokunulmaz, kaldırılmaz).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DANGEROUS_PATTERN = /deleteMany|\.delete\(|TRUNCATE/i;

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

describe('AJ-08 · seed:* komutları yalnız güvenli (upsert) betiklere işaret eder', () => {
  const { scripts } = loadPackageJson();
  const seedCommandNames = Object.keys(scripts).filter(
    (name) => name.startsWith('seed:'),
  );

  it('en az bir "seed:*" güvenli komut tanımlı (regresyon: liste boşalmasın)', () => {
    expect(seedCommandNames.length).toBeGreaterThan(0);
  });

  for (const name of seedCommandNames) {
    it(`${name} → hedef betikte deleteMany/.delete(/TRUNCATE YOK`, () => {
      const command = scripts[name];
      const filePath = extractScriptFilePath(command);
      const content = readFileSync(join(process.cwd(), filePath), 'utf8');
      const offendingLines = content
        .split('\n')
        .map((line, i) => ({ line, i: i + 1 }))
        .filter(({ line }) => DANGEROUS_PATTERN.test(line));

      expect(
        offendingLines,
        `"${name}" (${filePath}) tehlikeli desen içeriyor, güvenli listeden çıkarılmalı:\n` +
          offendingLines.map(({ line, i }) => `  L${i}: ${line.trim()}`).join('\n'),
      ).toEqual([]);
    });
  }

  it('bilinen-tehlikeli düz "seed" komutu güvenli listede DEĞİL (silme protokolü — dokunulmadı)', () => {
    expect(seedCommandNames).not.toContain('seed');
    expect(scripts['seed']).toBe('tsx prisma/seed.ts');
  });
});
