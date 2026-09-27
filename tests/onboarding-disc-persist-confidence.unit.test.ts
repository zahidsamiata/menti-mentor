/**
 * AJ-32 · PS-02 — `submitDiscTest` DB'ye KALICI yazdığı `discVector`'a confidence koyuyor mu
 * (DB'siz birim testi).
 *
 * Neden: `onboarding-disc-confidence.unit.test.ts` yalnız `calculateDiscResult`'ın confidence
 * ÜRETTİĞİNİ ölçüyor; `onboardingController.ts`'te kalıcı vektöre confidence ekleyen satır
 * (`persistedDiscVector`) geri alınsa 6/6 test yeşil kalıyordu (bitti-dogrulama-2026-09-27 · PS-02 ⚠️).
 * confidence'sız vektörü eşleştirme motoru "yok" sayar → kullanıcının onboarding cevapları sessizce
 * atlanır. Bu test prisma.user.update'e GİDEN veriyi yakalar.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { RequestWithTenant } from '../src/types.js';

const userUpdate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
  id: 'u-1',
  fullName: 'Test',
  discType: args.data.discType,
  discVector: args.data.discVector,
  discResultCard: args.data.discResultCard,
  updatedAt: new Date(),
}));

vi.mock('../src/db.js', () => ({
  prisma: { user: { update: (args: { data: Record<string, unknown> }) => userUpdate(args) } },
}));

import { submitDiscTest } from '../src/controllers/onboardingController.js';

function fakeRes() {
  const res = { statusCode: 200, body: undefined as unknown } as {
    statusCode: number; body: unknown; status: (c: number) => typeof res; json: (b: unknown) => typeof res;
  };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}

async function submit(answerCount: number) {
  const answers = Array.from({ length: answerCount }, (_, i) => ({ questionId: i + 1, selectedOption: 'A' }));
  const req = { auth: { userId: 'u-1', tenantId: 't-1' }, body: { answers } } as unknown as RequestWithTenant;
  const res = fakeRes();
  await submitDiscTest(req, res as unknown as Response);
  return res;
}

describe('AJ-32 · PS-02 — kalıcı discVector confidence taşır', () => {
  // Blok gövdesi kasıtlı: beforeEach'ten dönen fonksiyonu vitest temizleyici olarak çağırır.
  beforeEach(() => {
    userUpdate.mockClear();
  });

  it('6/8 cevap → DB\'ye yazılan vektörde confidence 0.75', async () => {
    const res = await submit(6);
    expect(res.statusCode).toBe(200);
    expect(userUpdate).toHaveBeenCalledTimes(1);

    const persisted = userUpdate.mock.calls[0][0].data.discVector as Record<string, unknown>;
    expect(persisted).toHaveProperty('confidence');
    expect(persisted.confidence).toBeCloseTo(0.75, 5);
  });

  it('8/8 cevap → DB\'ye yazılan vektörde confidence 1 (vektör D/I/S/C alanları da yerinde)', async () => {
    await submit(8);
    const persisted = userUpdate.mock.calls[0][0].data.discVector as Record<string, unknown>;
    expect(persisted.confidence).toBe(1);
    for (const k of ['D', 'I', 'S', 'C']) expect(typeof persisted[k]).toBe('number');
  });
});
