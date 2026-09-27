/**
 * Yenileme (refresh) çerezi yardımcısı — birim testleri (AJ-09 refaktör).
 *
 * Bağlam: `authController.ts` ve `selfServeController.ts`'de birebir aynı iki ayrı
 * `setRefreshCookie` kopyası vardı; `src/utils/authCookies.ts`'te TEK ortak yardımcıya
 * birleştirildi (davranış DEĞİŞMEDİ). Bu test, birleştirme SONRASI Set-Cookie başlığının
 * birleştirme ÖNCESİYLE birebir aynı kaldığını kanıtlar: HttpOnly, SameSite, Max-Age, Path,
 * (test ortamında) Secure YOKLUĞU. DB gerektirmez — küçük bir Express app + supertest.
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import {
  setRefreshCookie,
  clearRefreshCookie,
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_EXPIRY_DAYS,
} from '../src/utils/authCookies.js';

function buildApp() {
  const app = express();
  app.get('/set', (_req, res) => {
    setRefreshCookie(res, 'raw-refresh-token-value');
    res.status(204).end();
  });
  app.get('/clear', (_req, res) => {
    clearRefreshCookie(res);
    res.status(204).end();
  });
  return app;
}

describe('authCookies — setRefreshCookie/clearRefreshCookie (Set-Cookie başlığı eskiyle AYNI)', () => {
  it('setRefreshCookie: mm_refresh · HttpOnly · SameSite=Strict · Path=/ · Max-Age=7 gün · test ortamında Secure YOK', async () => {
    const res = await supertest(buildApp()).get('/set');
    const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const cookie = setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));

    expect(cookie).toBeDefined();
    expect(cookie).toContain(`${REFRESH_COOKIE_NAME}=raw-refresh-token-value`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain(`Max-Age=${REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60}`);
    // NODE_ENV=test (tests/setup.ts) → isProd=false → Secure eklenmez (prod'da eklenir).
    expect(cookie).not.toContain('Secure');
  });

  it('clearRefreshCookie: setRefreshCookie ile BİREBİR aynı seçenekler (GV-23 — aksi halde tarayıcı silmeyebilir)', async () => {
    const res = await supertest(buildApp()).get('/clear');
    const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const cookie = setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));

    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Secure');
    // res.clearCookie → geçmiş bir tarihe Expires + Max-Age=0 (hemen silinir).
    expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});
