/**
 * GV-14 — günlüğe yazılan URL'deki gizli değerlerin maskelenmesi — birim testi (DB gerektirmez).
 *
 * Kapsam: davet token'ı (yol parçası), OAuth code/state, abonelik ?token=… değerleri günlükte görünmez;
 * sıradan yollar ve zararsız parametreler aynen kalır; requestLogger çıktısı token içermez.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { maskUrlForLog, URL_REDACTED } from '../src/services/logUrl.js';
import { requestLogger } from '../src/middleware/requestLogger.js';

const INVITE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJ0ZW5hbnRJZCI6InQxIn0.c2lnbmF0dXJlLXZhbHVl';

describe('maskUrlForLog', () => {
  it('davet token yol parçası gizlenir, yolun geri kalanı kalır', () => {
    const out = maskUrlForLog(`/api/invitations/${INVITE_JWT}/join`);
    expect(out).toBe(`/api/invitations/${URL_REDACTED}/join`);
    expect(out).not.toContain(INVITE_JWT);
  });

  it('OAuth code ve state değerleri gizlenir, zararsız parametre kalır', () => {
    const out = maskUrlForLog('/api/auth/google/callback?code=4%2F0AbCdEf&state=eyJ.x.y&scope=email');
    expect(out).toBe(`/api/auth/google/callback?code=${URL_REDACTED}&state=${URL_REDACTED}&scope=email`);
    expect(out).not.toContain('0AbCdEf');
  });

  it('abonelik ?token= ve access_token / refreshToken değerleri gizlenir', () => {
    expect(maskUrlForLog('/api/tenants/unsubscribe?token=0b8f-uuid')).toBe(`/api/tenants/unsubscribe?token=${URL_REDACTED}`);
    expect(maskUrlForLog('/x?access_token=abc&refreshToken=def&page=2'))
      .toBe(`/x?access_token=${URL_REDACTED}&refreshToken=${URL_REDACTED}&page=2`);
  });

  it('bilinmeyen bir yolda JWT biçimli parça da gizlenir', () => {
    expect(maskUrlForLog(`/api/other/${INVITE_JWT}`)).toBe(`/api/other/${URL_REDACTED}`);
  });

  it('sıradan yol ve sorgu AYNEN kalır', () => {
    const urls = [
      '/api/users/me',
      '/api/admin/users?page=2&pageSize=20&status=PENDING',
      '/api/tenants/abc123/invitations',
      '/health',
      '/api/matches/cm1x2y3z4?flag',
    ];
    for (const url of urls) expect(maskUrlForLog(url)).toBe(url);
  });
});

describe('requestLogger — negatif: token değeri günlükte yok', () => {
  it('davet bağlantısı isteğinin log satırında token bulunmaz', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = Object.assign(new EventEmitter(), { statusCode: 200 }) as unknown as Response;
    const req = {
      method: 'GET',
      originalUrl: `/api/invitations/${INVITE_JWT}/join?token=gizli-deger`,
      header: () => undefined,
    } as unknown as Request;
    const next = vi.fn() as unknown as NextFunction;

    requestLogger(req, res, next);
    (res as unknown as EventEmitter).emit('finish');

    const line = String(logSpy.mock.calls.at(-1)?.[0]);
    expect(line).not.toContain(INVITE_JWT);
    expect(line).not.toContain('gizli-deger');
    expect(JSON.parse(line).url).toBe(`/api/invitations/${URL_REDACTED}/join?token=${URL_REDACTED}`);
    logSpy.mockRestore();
  });
});
