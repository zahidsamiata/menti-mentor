/**
 * AJ-109 — mizaç testi isteğinde `selectedEnneagram` uzunluk sınırı (DB'siz, prisma sahte).
 *
 * Neden: istek şemasında sınır yoktu; 20 karakteri aşan etiket hesaplanıp yazım kapısında
 * (`TemperamentResultWriteSchema.enneagramWing`, `MAX_ENNEAGRAM_LABEL`) reddediliyor ve 500 dönüyordu.
 * Ölçüt: sınırı aşan etiket → 400 VALIDATION, yazım HİÇ çağrılmaz; sınırdaki etiket → 200.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { RequestWithTenant } from '../src/types.js';

const userUpdate = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'u-1', ...args.data }));
const userFindFirst = vi.fn(async () => ({ id: 'u-1' }));

vi.mock('../src/db.js', () => ({
  prisma: {
    user: {
      update: (args: { data: Record<string, unknown> }) => userUpdate(args),
      findFirst: () => userFindFirst(),
    },
  },
}));

import { submitTemperamentTest } from '../src/controllers/temperamentController.js';
import { MAX_ENNEAGRAM_LABEL } from '../src/services/jsonFieldSchemas.js';

function fakeRes() {
  const res = { statusCode: 200, body: undefined as unknown } as {
    statusCode: number; body: unknown; status: (c: number) => typeof res; json: (b: unknown) => typeof res;
  };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}

function selfReq(enneagramLabel: string) {
  const answers = Array.from({ length: 7 }, (_, i) => ({
    questionId: i + 1,
    selectedDisc: 'D',
    selectedEnneagram: enneagramLabel,
  }));
  return {
    auth: { userId: 'u-1', role: 'MENTI', tenantId: 't-1' },
    tenant: { tenantId: 't-1' },
    params: { id: 'u-1' },
    body: { answers },
  } as unknown as RequestWithTenant;
}

beforeEach(() => {
  userUpdate.mockClear();
});

describe('AJ-109 · submitTemperamentTest — selectedEnneagram sınırı', () => {
  it('21 karakterlik etiket → 400 VALIDATION, user.update ÇAĞRILMAZ', async () => {
    const res = fakeRes();
    await submitTemperamentTest(selfReq('x'.repeat(MAX_ENNEAGRAM_LABEL + 1)), res as unknown as Response);
    expect(MAX_ENNEAGRAM_LABEL + 1).toBe(21);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toBe('VALIDATION');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('20 karakterlik etiket (sınırda) → 200, yazım yapılır', async () => {
    const res = fakeRes();
    await submitTemperamentTest(selfReq('x'.repeat(MAX_ENNEAGRAM_LABEL)), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(userUpdate).toHaveBeenCalledTimes(1);
  });
});
