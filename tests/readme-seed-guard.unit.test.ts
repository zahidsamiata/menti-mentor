/**
 * AJ-26 — backend README'de çalıştırılabilir `npm run seed` satırı OLMAMALI.
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

const README_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'README.md');

/** Tehlikeli komut: `npm run seed` ve ardından boşluk/satır sonu (alt komutlar `seed:x` hariç). */
const DANGEROUS_SEED = /^npm\s+run\s+seed(\s|$)/;

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

/** Kod bloklarında yorum olmayan, çalıştırılabilir `npm run seed` satırlarını bulur. */
function findRunnableSeedLines(markdown: string): number[] {
  return codeBlockLines(markdown)
    .filter(({ text }) => DANGEROUS_SEED.test(text.trim()))
    .map(({ lineNo }) => lineNo);
}

describe('README seed koruması (AJ-26)', () => {
  const readme = readFileSync(README_PATH, 'utf-8');

  it('kod bloklarında çalıştırılabilir `npm run seed` satırı yok', () => {
    expect(findRunnableSeedLines(readme)).toEqual([]);
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
    expect(findRunnableSeedLines(sample)).toEqual([4, 5]);
  });
});
