/**
 * AJ-32 · GV-21 — `/api/auth` rota YIĞINI denetimi (DB'siz birim testi).
 *
 * Neden: `auth-route-order.test.ts` yalnız bugün var olan `/me` ucunu ve bilinmeyen adları ölçüyor.
 * `GET /:provider` catch-all olduğu için, onun ALTINA eklenen HER yeni `GET /api/auth/<ad>` ucu
 * sessizce OAuth başlatmaya düşer — mevcut test bunu yakalamaz (bitti-dogrulama-2026-09-27 · GV-21 ⚠️).
 * Bu test router yığınını genel olarak tarar: OAuth catch-all rotaları GET yığınının EN SONUNDA olmalı.
 */

import { describe, it, expect } from 'vitest';
import authRoutes from '../src/routes/authRoutes.js';

type RouteLayer = { route?: { path: string; methods: Record<string, boolean> } };

function getRoutesInOrder(): { method: string; path: string }[] {
  const stack = (authRoutes as unknown as { stack: RouteLayer[] }).stack;
  const out: { method: string; path: string }[] = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (enabled) out.push({ method: method.toUpperCase(), path: layer.route.path });
    }
  }
  return out;
}

const CATCH_ALL = ['/:provider', '/:provider/callback'];

describe('AJ-32 · GV-21 — OAuth catch-all rotaları GET yığınının en sonunda', () => {
  it('yığın okunabiliyor ve catch-all rotaları kayıtlı (test boşa koşmuyor)', () => {
    const getPaths = getRoutesInOrder().filter((r) => r.method === 'GET').map((r) => r.path);
    expect(getPaths).toContain('/me');
    for (const p of CATCH_ALL) expect(getPaths).toContain(p);
  });

  it('catch-all rotalarından SONRA hiçbir GET ucu tanımlı değil', () => {
    const getPaths = getRoutesInOrder().filter((r) => r.method === 'GET').map((r) => r.path);
    const firstCatchAll = Math.min(...CATCH_ALL.map((p) => getPaths.indexOf(p)));
    const shadowed = getPaths.slice(firstCatchAll).filter((p) => !CATCH_ALL.includes(p));
    expect(
      shadowed,
      `Bu GET uçları /:provider altında kalmış, OAuth'a düşer — authRoutes.ts'te catch-all'ın ÜSTÜNE taşıyın`,
    ).toEqual([]);
  });
});
