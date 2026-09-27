/**
 * V-01 + F-25 (AJ-45) — SMTP el sıkışması başarısızsa operatör bunu görür.
 *
 * health.test.ts yalnız "unconfigured" dalını ölçüyordu; smtp alanı testi dört değerin
 * hepsini kabul ettiği için her koşulda geçiyordu. Burada SMTP YAPILANDIRILMIŞ kabul edilir,
 * nodemailer taşıyıcısı sahtedir ve verify() sonucu kontrol edilir:
 * - V-01: verify reddederse `getSmtpStatus()` ve `/health` → 'failed'; başarırsa 'verified'.
 * - F-25: platform sağlık ucu config'in VARLIĞINA değil gerçek verify sonucuna bakar →
 *   yapılandırma dolu ama el sıkışma başarısızsa mail: 'not_configured'.
 * DB ve e-posta sunucusu gerekmez (birim testi).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { Request, Response } from 'express';

const { verifyMock, sendMailMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  sendMailMock: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ verify: verifyMock, sendMail: sendMailMock }) },
}));

vi.mock('../src/db.js', () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]),
    systemLog: { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(0) },
  },
}));

import { config } from '../src/config.js';
import { getSmtpStatus, verifyTransporter } from '../src/services/emailService.js';
import { getHealthStatus } from '../src/services/health.js';
import { getPlatformHealth } from '../src/controllers/platformController.js';

const originalEmail = { ...config.email };

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

async function callPlatformHealth() {
  const res = fakeRes();
  await getPlatformHealth({} as Request, res as unknown as Response);
  return res;
}

describe('SMTP durumu — yapılandırma DOLU iken (V-01 / F-25)', () => {
  beforeEach(() => {
    verifyMock.mockReset();
    sendMailMock.mockReset();
    // Yapılandırma var: sorun ancak gerçek el sıkışmada ortaya çıkabilir.
    config.email.smtpHost = 'smtp.example.test';
    config.email.smtpUser = 'smtp-kullanici';
    config.email.smtpPass = 'smtp-parola';
  });

  afterAll(() => {
    Object.assign(config.email, originalEmail);
  });

  it('V-01: el sıkışma başarısızsa getSmtpStatus ve /health "failed" döner', async () => {
    verifyMock.mockRejectedValueOnce(new Error('535 Authentication failed'));
    expect(await verifyTransporter()).toBe(false);
    expect(getSmtpStatus()).toBe('failed');
    const health = await getHealthStatus();
    expect(health.smtp).toBe('failed');
  });

  it('V-01: el sıkışma başarılıysa "verified" döner (failed dalı ayırt edilir)', async () => {
    verifyMock.mockResolvedValueOnce(true);
    expect(await verifyTransporter()).toBe(true);
    expect(getSmtpStatus()).toBe('verified');
    expect((await getHealthStatus()).smtp).toBe('verified');
  });

  it('F-25: yapılandırma dolu ama el sıkışma başarısızsa platform sağlık ucu mail "not_configured" der', async () => {
    verifyMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await callPlatformHealth();
    expect(res.statusCode).toBe(200);
    expect(verifyMock).toHaveBeenCalledTimes(1); // gerçek prob çağrıldı
    expect((res.body as { mail: string }).mail).toBe('not_configured');
  });

  it('F-25: el sıkışma başarılıysa platform sağlık ucu mail "configured" der', async () => {
    verifyMock.mockResolvedValueOnce(true);
    const res = await callPlatformHealth();
    expect(verifyMock).toHaveBeenCalledTimes(1);
    expect((res.body as { mail: string }).mail).toBe('configured');
  });

  it('F-25: sonuç önbellekten değil her çağrıda yeni probdan gelir (başarılı → başarısız)', async () => {
    verifyMock.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('timeout'));
    expect(((await callPlatformHealth()).body as { mail: string }).mail).toBe('configured');
    expect(((await callPlatformHealth()).body as { mail: string }).mail).toBe('not_configured');
    expect(verifyMock).toHaveBeenCalledTimes(2);
  });
});
