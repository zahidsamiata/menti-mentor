/**
 * AN-50 (KARAR-64 C · KARAR-66 B) — API ve e-posta metinlerinde "mizaç" yok (→ "kişilik") ve sistemin
 * eşleştirdiği iddiası yok (→ "öneri"). Kod adları (matching.ts, matchScore…) kapsam dışı: yalnız
 * dize içeren, yorum olmayan satırlar taranır. DB gerektirmez.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(process.cwd(), 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? files(f) : /\.ts$/.test(n) ? [f] : [];
  });
}

function offenders(pattern: RegExp): string[] {
  const out: string[] = [];
  for (const f of files(SRC)) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (!/['"`]/.test(line)) return;
      if (pattern.test(line)) out.push(`${relative(SRC, f)}:${i + 1}`);
    });
  }
  return out;
}

describe('AN-50 · API/e-posta dili', () => {
  it('"mizaç" geçmiyor', () => {
    expect(offenders(/miza[çc]/i)).toEqual([]);
  });
  it('"eşleştirme algoritması/ağırlıkları" iddiası yok', () => {
    expect(offenders(/eşleştirme (algoritma|ağırlık)/i)).toEqual([]);
  });
});
