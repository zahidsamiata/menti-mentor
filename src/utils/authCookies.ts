import type { Request, Response } from 'express';

// Yenileme (refresh) token çerezi için tek ortak yardımcı (AJ-09 — önceden authController.ts ve
// selfServeController.ts'de birebir aynı kopya olarak duruyordu, davranış DEĞİŞMEDİ).

export const REFRESH_TOKEN_EXPIRY_DAYS = 7;
export const REFRESH_COOKIE_NAME = 'mm_refresh';

const isProd = process.env.NODE_ENV === 'production';

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  });
}

// Oturum çerezini temizleyen tek yol: seçenekler set ile birebir aynı olmalı, yoksa tarayıcı
// çerezi silmeyebilir (GV-23 — hesap kapatma da bunu kullanır).
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { httpOnly: true, secure: isProd, sameSite: 'strict' });
}

export function getRefreshTokenFromCookie(req: Request): string | undefined {
  const cookieHeader = req.headers['cookie'];
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key === REFRESH_COOKIE_NAME) return decodeURIComponent(val);
  }
  return undefined;
}

export function refreshTokenExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
  return d;
}
