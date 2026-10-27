import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from '../services/logger.js';

/**
 * E-4 · KARANTİNA KAPISI — silme protokolü adım 5 (kök CLAUDE.md § SİLME PROTOKOLÜ; KARAR-11 = A:
 * "karantina → bir tur bekle → sonra sil").
 *
 * Neden var: aynı işi başka bir ucun yaptığı (mükerrer) ve ön yüzün hiç çağırmadığı uçlar
 * silinmeden önce bir tur DEVRE DIŞI bekletilir. Kod yerinde kalır; yalnız bu kapı isteği
 * handler'a ulaştırmadan 410 (Gone) ile keser ve çağrıyı SystemLog'a yazar — böylece "bu uç
 * gerçekten kimse tarafından kullanılmıyor mu" sorusu bir tur boyunca canlı kayıtla doğrulanır
 * (platform paneli › Sistem kayıtları, kategori HTTP, mesaj "Karantinadaki uç çağrıldı").
 *
 * Kapı KİMLİK DOĞRULAMADAN SONRA takılır: oturumsuz/yetkisiz istek eskisi gibi 401/403 alır,
 * karantina yetkili çağırana bile uç varlığı dışında bilgi vermez.
 *
 * Geri açma iki yoldan:
 *  1. Kalıcı: ilgili rota satırındaki `quarantined('<anahtar>')` çağrısını kaldır (git revert).
 *  2. Acil (kod değişmeden): ortam değişkenine anahtarı ekle —
 *     `QUARANTINE_REOPEN=super-admin-tenant-status,system-logs` (virgülle ayrılmış). İstek anında
 *     okunur, yeniden başlatma gerektirmez ama değişkeni değiştirmek için dağıtım ayarı gerekir.
 *
 * Arşiv (tam kod + niyet + geri alma komutu): çatı reposu `docs/arsiv/silinenler-2026-09-10.md`.
 * Gerçek silme ayrı turdadır ve PO'nun İKİNCİ onayını ister (E-5).
 */

export const QUARANTINE_REOPEN_ENV = 'QUARANTINE_REOPEN';

/** Karantinadaki uçların kalıcı anahtarları — arşiv belgesindeki tablo ile birebir. */
export const QUARANTINE_KEYS = [
  'super-admin-tenant-status',
  'super-admin-tenants-pending',
  'system-logs',
  'tenants-list',
  'tenants-get',
  'users-me-social',
  'meetings-pair-signal',
] as const;

export type QuarantineKey = (typeof QUARANTINE_KEYS)[number];

export const QUARANTINE_ERROR_CODE = 'ENDPOINT_QUARANTINED';
export const QUARANTINE_MESSAGE = 'Bu uç kullanımdan kaldırıldı.';

/** Saf karar fonksiyonu — ortam değişkeni değeri verilen anahtarı yeniden açıyor mu? */
export function isQuarantineReopened(key: QuarantineKey, envValue: string | undefined): boolean {
  if (!envValue) return false;
  return envValue
    .split(',')
    .map((part) => part.trim())
    .includes(key);
}

/**
 * Rota zincirine eklenir: `router.get('/x', requireAuth(), quarantined('anahtar'), handler)`.
 * Yeniden açılmamışsa 410 döner ve handler'a hiç ulaşılmaz.
 */
export function quarantined(key: QuarantineKey): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isQuarantineReopened(key, process.env[QUARANTINE_REOPEN_ENV])) {
      next();
      return;
    }
    // Rota KALIBI yazılır (`/tenants/:id/status`), gerçek URL değil — id/sorgu dizesi kayda girmez.
    const routePattern = `${req.baseUrl}${(req.route as { path?: string } | undefined)?.path ?? ''}`;
    void logger.warn('HTTP', `Karantinadaki uç çağrıldı: ${key}`, {
      key,
      method: req.method,
      route: routePattern,
    });
    res.status(410).json({ error: QUARANTINE_ERROR_CODE, message: QUARANTINE_MESSAGE });
  };
}
