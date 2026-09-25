/**
 * Liste uçları için limit/offset ayrıştırma (AN-39). Saf, test edilebilir.
 * Geçersiz ya da eksik değerde varsayılan sayfa; üst sınırın üstü kırpılır —
 * istemci tek istekte sınırsız satır çekemez.
 */
export interface PageBounds {
  defaultLimit: number;
  maxLimit: number;
}

export function parsePagination(
  limitRaw: unknown,
  offsetRaw: unknown,
  bounds: PageBounds,
): { limit: number; offset: number } {
  const l = Number(limitRaw);
  const o = Number(offsetRaw);
  const limit =
    limitRaw !== undefined && limitRaw !== '' && Number.isFinite(l)
      ? Math.min(Math.max(Math.trunc(l), 1), bounds.maxLimit)
      : bounds.defaultLimit;
  const offset = Number.isFinite(o) && o > 0 ? Math.trunc(o) : 0;
  return { limit, offset };
}

// Şikâyet listeleri (kurum yöneticisi + platform) — aynı sayfa boyutu.
export const REPORT_PAGE: PageBounds = { defaultLimit: 50, maxLimit: 100 };
