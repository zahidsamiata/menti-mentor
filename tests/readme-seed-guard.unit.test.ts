/**
 * AJ-26 — backend README'de çalıştırılabilir `npm run seed` satırı OLMAMALI.
 * AJ-57 — kapsam genişledi: `prisma migrate dev|reset`, `prisma db seed`, `tsx prisma/seed.ts`,
 * `db push --accept-data-loss`, `npm run prisma:migrate` da yakalanır; README'ye ek olarak
 * backend/CLAUDE.md komut listesi de denetlenir.
 *
 * Neden: `npm run seed` (= prisma/seed.ts) toplu deleteMany() çalıştırır ve canlı = lokal
 * aynı DB'dir (CLAUDE.md § CANLI = LOKAL AYNI DB). README kurulum adımını izleyen biri canlı
 * veriyi siler. Komut README'de yalnız yorum (`#`) içinde, uyarıyla anılabilir; kod bloğunda
 * yorum dışı bir satır olarak geri gelirse bu test kırmızıya döner.
 * Güvenli alt komutlar (`seed:certification` vb.) bu testin kapsamı dışındadır.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README_PATH = path.join(BACKEND_ROOT, 'README.md');
/** Ajanlar backend/CLAUDE.md'deki komut listesini de izler (AJ-57). */
const CLAUDE_MD_PATH = path.join(BACKEND_ROOT, 'CLAUDE.md');

/**
 * Veri silen / DB sıfırlayan komutlar (AJ-26 + AJ-57). Satırın herhangi bir yerinde (ör. ortam
 * değişkeni önekiyle) geçerse yakalanır. Güvenli alt komutlar (`seed:certification`,
 * `prisma:migrate:status`) desenlerin sonundaki `(\s|$)` sayesinde yakalanmaz.
 */
const DANGEROUS_COMMANDS: RegExp[] = [
  /npm\s+run\s+seed(\s|$)/,
  /prisma\s+db\s+seed(\s|$)/,
  /tsx\s+(\.\/)?prisma\/seed\.ts(\s|$)/,
  /prisma\s+migrate\s+(dev|reset)(\s|$)/,
  /db\s+push\b.*--(accept-data-loss|force-reset)/,
  /npm\s+run\s+prisma:migrate(\s|$)/,
];

/** ``` ile açılıp kapanan kod bloklarının içindeki satırları (1 tabanlı satır no ile) döndürür. */
function codeBlockLines(markdown: string): { lineNo: number; text: string }[] {
  const result: { lineNo: number; text: string }[] = [];
  let inBlock = false;
  markdown.split(/\r?\n/).forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      inBlock = !inBlock;
      return;
    }
    if (inBlock) result.push({ lineNo: index + 1, text: line });
  });
  return result;
}

/** Kabuk yorumunu (`#` ile başlayan ya da boşluktan sonra gelen) atar; kalan kısım çalıştırılabilir. */
function stripShellComment(line: string): string {
  return line.replace(/(^|\s)#.*$/, '');
}

/** Kod bloklarında yorum dışında kalan, çalıştırılabilir tehlikeli komut satırlarını bulur. */
function findRunnableDangerousLines(markdown: string): number[] {
  return codeBlockLines(markdown)
    .filter(({ text }) => {
      const runnable = stripShellComment(text);
      return DANGEROUS_COMMANDS.some((pattern) => pattern.test(runnable));
    })
    .map(({ lineNo }) => lineNo);
}

describe('README seed koruması (AJ-26)', () => {
  const readme = readFileSync(README_PATH, 'utf-8');

  it('kod bloklarında çalıştırılabilir `npm run seed` satırı yok (AJ-57: migrate dev/reset, db seed, tsx seed.ts, db push --accept-data-loss dahil)', () => {
    expect(findRunnableDangerousLines(readme)).toEqual([]);
  });

  it('kurulum bölümü seed çalıştırılmaz uyarısını içerir', () => {
    const setup = readme.split(/^## /m).find((section) => section.startsWith('Kurulum'));
    expect(setup).toBeDefined();
    expect(setup).toContain('seed ÇALIŞTIRILMAZ');
  });

  it('dedektör: yorum dışı satırı yakalar, yorumu ve alt komutları yakalamaz', () => {
    const sample = [
      '```bash',
      '# npm run seed',
      'npm run seed:certification',
      'npm run seed',
      '  npm run seed   # yorumlu ama çalışır',
      '```',
      'npm run seed',
    ].join('\n');
    expect(findRunnableDangerousLines(sample)).toEqual([4, 5]);
  });

  it('AJ-57: backend/CLAUDE.md komut listesinde de çalıştırılabilir tehlikeli komut yok', () => {
    expect(findRunnableDangerousLines(readFileSync(CLAUDE_MD_PATH, 'utf-8'))).toEqual([]);
  });

  it('AJ-57 dedektör: tehlikeli komut ailesini yakalar (pozitif örnekler)', () => {
    const positives = [
      'npm run prisma:migrate',
      'npm run prisma:migrate -- --name ekle',
      'npx prisma migrate dev',
      'prisma migrate dev --name x',
      'npx prisma migrate reset --force',
      'npx prisma db seed',
      'prisma db seed',
      'npx tsx prisma/seed.ts',
      'tsx ./prisma/seed.ts',
      'npx prisma db push --accept-data-loss',
      'npx prisma db push --force-reset',
      'MENTI_TEHLIKELI_DB_ONAY=seed npm run seed',
      'cd backend && npx prisma migrate dev   # yorum sonda, komut çalışır',
    ];
    const sample = ['```bash', ...positives, '```'].join('\n');
    expect(findRunnableDangerousLines(sample)).toEqual(positives.map((_, i) => i + 2));
  });

  it('AJ-57 dedektör: güvenli komutları, yorumları ve kod bloğu dışını yakalamaz (negatif örnekler)', () => {
    const sample = [
      'npx prisma migrate dev',
      '```bash',
      '# npm run prisma:migrate  # ⛔ KORUMALI',
      '                         # prisma migrate dev sıfırlayabilir',
      'npm run prisma:migrate:status',
      'npm run prisma:generate',
      'npx prisma migrate status',
      'npx prisma migrate deploy',
      'npx prisma migrate resolve --applied 20260101000000_x',
      'npx prisma db execute --file x.sql --schema prisma/schema.prisma',
      'npx prisma db push',
      'npm run seed:learning-journey',
      'npx tsx prisma/seed-certification.ts',
      '```',
      'npm run seed',
    ].join('\n');
    expect(findRunnableDangerousLines(sample)).toEqual([]);
  });
});
