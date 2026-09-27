/**
 * F-06 (AJ-45) — kalibrasyon (manuel ağırlık) AUDIT yazımının HATA yolu.
 *
 * algorithm-weights-manual.test.ts yalnız mutlu yolu ölçüyordu. F-06 iki şey vaat eder:
 * (a) audit yazımı artık fire-and-forget değil, yanıttan ÖNCE tamamlanır (await);
 * (b) yazım başarısız olursa sessizce kaybolmaz — konsola (ops) düşer, işlem yine 200 döner.
 *
 * Kod gerçeği: `logger.info` → `writeLog` DB hatasını KENDİSİ yakalar ve `[LOGGER] SystemLog DB
 * yazımı başarısız` ile console.error'a yazar; hiç reddetmez. Bu yüzden adminController'daki
 * `.catch(...)` dalı bugün tetiklenemez (savunma amaçlı, ölü dal). Bu test hatanın GERÇEKTE
 * aktığı yolu ölçer: DB yazımı patlar → konsol kaydı + 200; ayrıca yanıtın audit yazımı
 * bitmeden gönderilmediğini ölçer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Response } from 'express';
import type { RequestWithTenant } from '../src/types.js';

const { systemLogCreate, setManualWeightsMock } = vi.hoisted(() => ({
  systemLogCreate: vi.fn(),
  setManualWeightsMock: vi.fn(),
}));

vi.mock('../src/db.js', () => ({
  prisma: { systemLog: { create: systemLogCreate } },
}));
vi.mock('../src/services/algorithmTuner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/algorithmTuner.js')>();
  return { ...actual, setManualWeights: setManualWeightsMock };
});

import { setAlgorithmWeightsHandler } from '../src/controllers/adminController.js';
import { WEIGHT_CHANGE_AUDIT_MESSAGE } from '../src/services/algorithmTuner.js';

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn(function (this: { statusCode: number }, code: number) { this.statusCode = code; return this; }),
    json: vi.fn(function (this: { body: unknown }, payload: unknown) { this.body = payload; return this; }),
  };
}

const req = {
  body: { sectorWeight: 0.65 },
  tenant: { tenantId: 'tn1' },
  auth: { userId: 'adm1' },
} as unknown as RequestWithTenant;

describe('Manuel ağırlık AUDIT yazımı — hata yolu (F-06)', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    systemLogCreate.mockReset();
    setManualWeightsMock.mockReset();
    setManualWeightsMock.mockResolvedValue({
      previousWeights: { sectorWeight: 0.6, discWeight: 0.4 },
      newWeights: { sectorWeight: 0.65, discWeight: 0.35 },
      pendingCleared: false,
    });
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AUDIT DB yazımı başarısızsa sessiz kalmaz (konsola düşer) ve işlem yine 200 döner', async () => {
    systemLogCreate.mockRejectedValueOnce(new Error('connection terminated'));
    const res = fakeRes();

    await setAlgorithmWeightsHandler(req, res as unknown as Response);

    expect(systemLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ level: 'INFO', category: 'AUDIT', message: WEIGHT_CHANGE_AUDIT_MESSAGE }),
    });
    expect(consoleError).toHaveBeenCalledWith('[LOGGER] SystemLog DB yazımı başarısız:', expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ weights: { sectorWeight: 0.65 } });
  });

  it('yanıt, AUDIT yazımı tamamlanmadan gönderilmez (fire-and-forget değil)', async () => {
    let finishWrite!: () => void;
    systemLogCreate.mockReturnValueOnce(new Promise<void>((resolve) => { finishWrite = resolve; }));
    const res = fakeRes();

    const pending = setAlgorithmWeightsHandler(req, res as unknown as Response);
    // Audit yazımı askıdayken birkaç mikro-görev turu geçsin: yanıt gitmemiş olmalı.
    await new Promise((r) => setTimeout(r, 10));
    expect(systemLogCreate).toHaveBeenCalledTimes(1);
    expect(res.json).not.toHaveBeenCalled();

    finishWrite();
    await pending;
    expect(res.json).toHaveBeenCalledTimes(1);
  });
});
