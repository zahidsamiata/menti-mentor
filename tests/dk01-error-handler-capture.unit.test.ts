/**
 * DK-01 7b — 500 hata yakalayıcısı dış izleme servisine SÜZÜLMÜŞ adres iletir (DB gerektirmez).
 * `extra.url`'de davet token'ı, uzun kimlik ve sorgu değeri (ör. `email=`) dışarı çıkmamalı.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../src/services/logger.js', () => ({
  logger: { error: vi.fn(async () => {}), warn: vi.fn(async () => {}), info: vi.fn(async () => {}) },
}));

const { globalErrorHandler } = await import('../src/middleware/errorHandler.js');
const { initErrorMonitor, resetErrorMonitorForTest } = await import('../src/services/errorMonitor.js');

afterEach(() => resetErrorMonitorForTest());

describe('globalErrorHandler → captureError', () => {
  it('extra.url sorgusuz ve token/kimlik parçaları gizli', async () => {
    const sdk = { init: vi.fn(), captureException: vi.fn() };
    await initErrorMonitor({ dsn: 'https://k@o1.ingest.sentry.io/1', loadSdk: async () => sdk });

    const req = {
      originalUrl: '/api/invitations/davet-gizli-123/join?email=ornek.kisi%40example.com&sayfa=2',
      method: 'GET',
    } as unknown as Request;
    const res = { headersSent: false, status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    globalErrorHandler(new Error('boom'), req, res, (() => {}) as NextFunction);

    expect(sdk.captureException).toHaveBeenCalledTimes(1);
    const hint = sdk.captureException.mock.calls[0][1] as { extra: { url: string } };
    expect(hint.extra.url).toBe('/api/invitations/[gizli]/join');
  });
});
