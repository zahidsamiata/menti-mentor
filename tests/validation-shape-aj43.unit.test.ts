/**
 * AJ-43 (Y-03 kalanı) — ortak hata biçiminin dışında kalan uçlar artık `validateRequest` üzerinden
 * { error: 'VALIDATION', message?, details: { formErrors, fieldErrors } } döner.
 *
 * Her uçta: geçersiz girdi → 400 + ortak biçim (tam anahtar kümesi) ve veri katmanına HİÇ gidilmez
 * (negatif: geçersiz istek hiçbir kaydı okumaz/değiştirmez).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  question: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  tenant: { findUnique: vi.fn() },
  meeting: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}));

vi.mock('../src/db.js', () => ({ prisma: prismaMock }));

vi.mock('../src/services/questionService.js', () => ({
  buildQuestionList: vi.fn(),
  calcAdaptiveProgress: vi.fn(),
  upsertSingleResponse: vi.fn(),
  validateQuestionIds: vi.fn(),
  listHiddenQuestions: vi.fn(),
}));

import '../src/zodLocale.js';
import * as questionService from '../src/services/questionService.js';
import {
  createQuestion,
  updateQuestion,
  respondToQuestion,
  submitResponses,
} from '../src/controllers/questionController.js';

function mockRes() {
  const res: { statusCode?: number; body?: unknown; status: (c: number) => typeof res; json: (b: unknown) => typeof res } = {
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  return res;
}

type ValidationBody = {
  error: string;
  message?: string;
  details: { formErrors: string[]; fieldErrors: Record<string, string[]> };
};

function expectCommonShape(res: ReturnType<typeof mockRes>, withMessage: boolean) {
  expect(res.statusCode).toBe(400);
  const body = res.body as ValidationBody;
  expect(body.error).toBe('VALIDATION');
  expect(Object.keys(body).sort()).toEqual(withMessage ? ['details', 'error', 'message'] : ['details', 'error']);
  expect(Object.keys(body.details).sort()).toEqual(['fieldErrors', 'formErrors']);
  return body;
}

const adminReq = (extra: Record<string, unknown>) =>
  ({ auth: { userId: 'u-admin', role: 'ADMIN' }, tenant: { tenantId: 't1' }, params: {}, ...extra }) as never;

describe('AJ-43: soru uçları ortak yardımcıdan geçer (message alan etiketli kalır)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /questions — geçersiz gövde → ortak biçim + etiketli message, soru oluşturulmaz', async () => {
    const res = mockRes();
    await createQuestion(adminReq({ body: { text: 'kısa' } }), res as never);
    const body = expectCommonShape(res, true);
    expect(body.message).toMatch(/^Soru metni: /);
    expect(body.details.fieldErrors['text']?.length).toBeGreaterThan(0);
    expect(prismaMock.question.create).not.toHaveBeenCalled();
  });

  it('PUT/PATCH /questions/:id — geçersiz gövde → ortak biçim, soru güncellenmez', async () => {
    prismaMock.question.findUnique.mockResolvedValue({ id: 'q1', tenantId: 't1' });
    const res = mockRes();
    await updateQuestion(adminReq({ params: { questionId: 'q1' }, body: { order: -1 } }), res as never);
    const body = expectCommonShape(res, true);
    expect(body.message).toMatch(/^Sıra: /);
    expect(prismaMock.question.update).not.toHaveBeenCalled();
  });

  it('POST /questions/:id/respond — geçersiz gövde → ortak biçim, yanıt yazılmaz', async () => {
    const res = mockRes();
    await respondToQuestion(adminReq({ params: { questionId: 'q1' }, body: {} }), res as never);
    const body = expectCommonShape(res, true);
    expect(body.message).toMatch(/^Cevap değeri: /);
    expect(questionService.upsertSingleResponse).not.toHaveBeenCalled();
  });

  it('POST /questions/respond (toplu) — geçersiz gövde → ortak biçim, yanıtlar yazılmaz', async () => {
    const res = mockRes();
    await submitResponses(adminReq({ body: { responses: 'x' } }), res as never);
    const body = expectCommonShape(res, true);
    expect(body.message).toMatch(/^Yanıtlar: /);
    expect(questionService.validateQuestionIds).not.toHaveBeenCalled();
  });
});
