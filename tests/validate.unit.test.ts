/**
 * Y-03 — ortak doğrulama yardımcısı: başarıda veri, başarısızlıkta kopyalarla BİREBİR aynı 400 yanıtı.
 */
import { describe, it, expect } from 'vitest';
import type { Response } from 'express';
import { z } from 'zod';
import '../src/zodLocale.js';
import { validateRequest } from '../src/middleware/validate.js';

function fakeRes() {
  const state: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
  };
  return { res: res as unknown as Response, state };
}

const Schema = z.object({
  name: z.string().trim().min(2, 'İsim en az 2 karakter olmalı.'),
  age: z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().int()),
});

describe('Y-03: validateRequest', () => {
  it('başarıda dönüştürülmüş veriyi döner, yanıta dokunmaz', () => {
    const { res, state } = fakeRes();
    const parsed = validateRequest(Schema, { name: '  Ada  ', age: '30' }, res);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual({ name: 'Ada', age: 30 });
    expect(state.status).toBeUndefined();
    expect(state.body).toBeUndefined();
  });

  it('başarısızlıkta tam olarak 400 + { error, details: { formErrors, fieldErrors } } yazar (ek alan yok)', () => {
    const { res, state } = fakeRes();
    const parsed = validateRequest(Schema, { name: 'A', age: 'x' }, res);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.response).toBe(res);
    expect(state.status).toBe(400);
    const expected = Schema.safeParse({ name: 'A', age: 'x' });
    expect(expected.success).toBe(false);
    expect(state.body).toStrictEqual({ error: 'VALIDATION', details: expected.error!.flatten() });
    const body = state.body as { details: { formErrors: string[]; fieldErrors: Record<string, string[]> } };
    expect(Object.keys(body).sort()).toEqual(['details', 'error']);
    expect(Object.keys(body.details).sort()).toEqual(['fieldErrors', 'formErrors']);
    expect(body.details.fieldErrors['name']).toEqual(['İsim en az 2 karakter olmalı.']);
    expect(body.details.fieldErrors['age']?.[0]).not.toMatch(/expected|Invalid/i);
  });

  it('nesne olmayan girdide formErrors doldurulur, fieldErrors boş', () => {
    const { res, state } = fakeRes();
    const parsed = validateRequest(Schema, undefined, res);
    expect(parsed.success).toBe(false);
    const body = state.body as { details: { formErrors: string[]; fieldErrors: Record<string, string[]> } };
    expect(state.status).toBe(400);
    expect(body.details.formErrors.length).toBe(1);
    expect(body.details.fieldErrors).toEqual({});
  });

  it('AJ-43: options.message verilirse yanıt { error, message, details } olur; details biçimi aynı kalır', () => {
    const { res, state } = fakeRes();
    const parsed = validateRequest(Schema, { name: 'A', age: 1 }, res, {
      message: (err) => `Etiket: ${err.issues[0]?.message}`,
    });
    expect(parsed.success).toBe(false);
    expect(state.status).toBe(400);
    const expected = Schema.safeParse({ name: 'A', age: 1 });
    expect(state.body).toStrictEqual({
      error: 'VALIDATION',
      message: 'Etiket: İsim en az 2 karakter olmalı.',
      details: expected.error!.flatten(),
    });
  });

  it('AJ-43 negatif: başarılı girdide message üretici hiç çağrılmaz, yanıta dokunulmaz', () => {
    const { res, state } = fakeRes();
    let called = 0;
    const parsed = validateRequest(Schema, { name: 'Deneme', age: 3 }, res, {
      message: () => { called += 1; return 'x'; },
    });
    expect(parsed.success).toBe(true);
    expect(called).toBe(0);
    expect(state.body).toBeUndefined();
  });
});
