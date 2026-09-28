/**
 * AJ-62 (AJ-43 kalanı) — Zod'suz elle yapılan girdi kontrolleri de ortak 400 biçimini döner:
 * { error: 'VALIDATION', message: '<aynı Türkçe cümle>', details: { formErrors: [cümle], fieldErrors: {} } }.
 *
 * Önceden bu uçlar `{ error: '<Türkçe cümle>' }` (randevu/check-in) ya da `details`'siz
 * `{ error: 'VALIDATION', message }` (selfProfile) dönüyordu. Mesaj metinleri ve durum kodu AYNI kalır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const prismaMock = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  match: { findFirst: vi.fn() },
  meeting: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  tenantMembership: { findUnique: vi.fn() },
  availabilityBlock: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../src/db.js', () => ({ prisma: prismaMock }));
vi.mock('../src/services/pairBlockGuard.js', () => ({ isPairBlockedInTenants: vi.fn().mockResolvedValue(false) }));

import type { Response } from 'express';
import '../src/zodLocale.js';
import { sendValidationError } from '../src/middleware/validate.js';
import {
  saveAvailability,
  getAvailability,
  bookMeeting,
  approveMeetingByMentor,
  markFeedbackPrompted,
} from '../src/controllers/meetingController.js';
import { getPairEfficiencySignal } from '../src/controllers/meetingCheckInController.js';
import { patchSelfProfile } from '../src/controllers/userController.js';

function mockRes() {
  const res: { statusCode?: number; body?: unknown; status: (c: number) => typeof res; json: (b: unknown) => typeof res } = {
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  return res;
}

/** Ortak biçim: tam anahtar kümesi + message aynı cümle + details.formErrors = [cümle]. */
function expectValidationShape(res: ReturnType<typeof mockRes>, message: string) {
  expect(res.statusCode).toBe(400);
  expect(res.body).toStrictEqual({
    error: 'VALIDATION',
    message,
    details: { formErrors: [message], fieldErrors: {} },
  });
}

const req = (extra: Record<string, unknown>) =>
  ({ auth: { userId: 'u-1', role: 'MENTOR' }, tenant: { tenantId: 't1' }, params: {}, query: {}, body: {}, ...extra }) as never;

const HOUR = 60 * 60 * 1000;
const LONG_MESSAGE = 'Bu görüşmede kariyer planlamamı ve hedeflerimi sizinle konuşmak istiyorum lütfen.';

beforeEach(() => vi.clearAllMocks());

describe('AJ-62: sendValidationError yardımcısı', () => {
  it('400 + { error: VALIDATION, message, details: { formErrors: [message], fieldErrors: {} } } yazar', () => {
    const res = mockRes();
    const out = sendValidationError(res as unknown as Response, 'Örnek cümle.');
    expect(out).toBe(res);
    expectValidationShape(res, 'Örnek cümle.');
  });
});

describe('AJ-62: müsaitlik kaydı (POST /api/meetings/availability)', () => {
  it.each([
    [{ blocks: 'x' }, 'blocks bir dizi olmalı.'],
    [{ blocks: [{ weekday: 'FUNDAY', startTime: '09:00', endTime: '10:00' }] }, 'Geçersiz gün: FUNDAY'],
    [{ blocks: [{ weekday: 'MON', startTime: '9', endTime: '10:00' }] }, 'Saatler HH:MM formatında olmalı.'],
    [{ blocks: [{ weekday: 'MON', startTime: '11:00', endTime: '10:00' }] }, 'Başlangıç saati bitişten önce olmalı.'],
  ])('%j → ortak biçim, DB\'ye gidilmez', async (body, message) => {
    const res = mockRes();
    await saveAvailability(req({ body }), res as never);
    expectValidationShape(res, message);
    expect(prismaMock.tenantMembership.findUnique).not.toHaveBeenCalled();
  });
});

describe('AJ-62: müsaitlik okuma (GET /api/meetings/availability)', () => {
  it('mentorUserId yoksa ortak biçim', async () => {
    const res = mockRes();
    await getAvailability(req({}), res as never);
    expectValidationShape(res, 'mentorUserId query parametresi gerekli.');
    expect(prismaMock.availabilityBlock.findMany).not.toHaveBeenCalled();
  });
});

describe('AJ-62: randevu talebi (POST /api/meetings/book)', () => {
  const base = { mentorUserId: 'u-mentor', format: 'ONLINE', requestMessage: LONG_MESSAGE };
  const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

  it.each([
    [{ startsAt: 'dun', endsAt: 'yarin' }, 'startsAt/endsAt geçerli ISO tarih olmalı.'],
    [{ startsAt: iso(3 * HOUR), endsAt: iso(2 * HOUR) }, 'Başlangıç bitişten önce olmalı.'],
    [{ startsAt: iso(-2 * HOUR), endsAt: iso(-HOUR) }, 'Geçmiş bir zamana görüşme oluşturulamaz.'],
  ])('%j → ortak biçim, DB\'ye gidilmez', async (times, message) => {
    const res = mockRes();
    await bookMeeting(req({ body: { ...base, ...times } }), res as never);
    expectValidationShape(res, message);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('eşleşmenin mentörü farklıysa ortak biçim', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ tenantId: 't1' });
    prismaMock.match.findFirst.mockResolvedValue({ mentor: { userId: 'baska-mentor' }, menti: { userId: 'u-1' } });
    const res = mockRes();
    await bookMeeting(req({ body: { ...base, matchId: 'm-1', startsAt: iso(2 * HOUR), endsAt: iso(3 * HOUR) } }), res as never);
    expectValidationShape(res, 'mentorUserId bu eşleşmenin mentörüyle uyuşmuyor.');
  });
});

describe('AJ-62: mentör onayı (POST /api/meetings/:meetingId/approve)', () => {
  it('ONLINE görüşme linksiz onaylanırsa ortak biçim, güncelleme yok', async () => {
    const tx = {
      meeting: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'mt-1', mentiUserId: 'u-menti', startsAt: new Date(), endsAt: new Date(), format: 'ONLINE',
        }),
        update: vi.fn(),
      },
    };
    prismaMock.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
    const res = mockRes();
    await approveMeetingByMentor(req({ params: { meetingId: 'mt-1' }, body: {} }), res as never);
    expectValidationShape(res, 'Online görüşmeyi onaylamak için görüşme bağlantısı girmelisiniz.');
    expect(tx.meeting.update).not.toHaveBeenCalled();
  });
});

describe('AJ-62: geri bildirim kartı işareti (POST /api/meetings/:meetingId/feedback-prompted)', () => {
  it('meetingId yoksa ortak biçim', async () => {
    const res = mockRes();
    await markFeedbackPrompted(req({ params: {} }), res as never);
    expectValidationShape(res, 'meetingId gerekli.');
    expect(prismaMock.meeting.findFirst).not.toHaveBeenCalled();
  });
});

describe('AJ-62: çift verimsizlik sinyali (GET /api/meetings/pair-signal)', () => {
  it('mentorId/mentiId eksikse ortak biçim', async () => {
    const res = mockRes();
    await getPairEfficiencySignal(req({ query: { mentorId: 'x' } }), res as never);
    expectValidationShape(res, 'mentorId ve mentiId gerekli.');
    expect(prismaMock.meeting.findMany).not.toHaveBeenCalled();
  });
});

describe('AJ-62: selfProfile düzenleme (PATCH /api/users/:id/self-profile)', () => {
  const tooManyKeys = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 'v']));
  it.each([
    [['dizi'], 'Body bir JSON objesi olmalıdır.'],
    [tooManyKeys, 'selfProfile en fazla 50 anahtar içerebilir.'],
    [{ ['a'.repeat(101)]: 'v' }, 'selfProfile anahtarları en fazla 100 karakter olabilir.'],
  ])('geçersiz gövde → ortak biçim, güncelleme yok (%#)', async (body, message) => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 'u-1', selfProfile: {} });
    const res = mockRes();
    await patchSelfProfile(req({ params: { id: 'u-1' }, body }), res as never);
    expectValidationShape(res, message);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe('AJ-62: kaynakta elle kurulmuş doğrulama 400\'ü kalmadı (bekçi)', () => {
  function listTs(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return listTs(full);
      return full.endsWith('.ts') ? [full] : [];
    });
  }
  const sources = listTs('src').filter((f) => !f.endsWith(join('middleware', 'validate.ts')));

  it("400 `error` alanına Türkçe cümle yazılmaz (yalnız BÜYÜK_HARF kod — iş kuralı istisnaları)", () => {
    // `error` değeri kod değil de cümleyse (küçük harf/boşluk/şablon) → ortak yardımcı kullanılmalı.
    const sentenceError = /status\(400\)\.json\(\{\s*error:\s*(?:`|'(?![A-Z_]+'))/;
    const offenders = sources.filter((f) => sentenceError.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it("`error: 'VALIDATION'` yanıtı yalnız middleware/validate.ts'te kurulur", () => {
    const manualValidation = /\.json\(\{\s*error:\s*'VALIDATION'/;
    const offenders = sources.filter((f) => manualValidation.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
