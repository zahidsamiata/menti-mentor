/**
 * Günlüğe yazılacak URL'deki gizli değerleri maskeler (GV-14).
 *
 * Neden: `requestLogger` ve `errorHandler` `req.originalUrl`'i olduğu gibi yazıyordu. Bazı uçlarda
 * gizli değer URL'nin İÇİNDE taşınıyor:
 *   - davet bağlantısı:   GET /api/invitations/<davet-token>/join   (yol parçası)
 *   - OAuth dönüşü:       GET /api/auth/<sağlayıcı>/callback?code=…&state=…
 *   - bülten çıkışı:      GET /api/tenants/unsubscribe?token=…
 * Günlüğe erişen biri bu değerleri toplayıp kullanabilirdi. Loglanan URL'de bu değerler `[gizli]` olur;
 * yolun geri kalanı ve zararsız parametreler (sayfa, filtre…) teşhis için AYNEN kalır.
 *
 * Saf fonksiyon — birim testi: `tests/log-url-mask.unit.test.ts`.
 */

export const URL_REDACTED = '[gizli]';

/** Hemen ARDINDAN gelen yol parçası gizli olan yol parçaları (ör. `/invitations/<token>`). */
const SECRET_FOLLOWS_SEGMENT = new Set(['invitations']);

/** Değeri gizlenecek sorgu parametreleri (küçük harf, `_`/`-` atılmış hâliyle karşılaştırılır). */
const SECRET_QUERY_KEYS = new Set([
  'code', 'state', 'token', 'accesstoken', 'refreshtoken', 'idtoken', 'password', 'secret',
  'clientsecret', 'apikey', 'key', 'signature', 'sig', 'otp', 'email',
]);
const SECRET_QUERY_SUFFIXES = ['token', 'secret', 'password'];

// JWT biçimli yol parçası (üç base64url parçası) — bilinmeyen bir uç token'ı yolda taşırsa diye savunma.
const JWT_LIKE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function isSecretQueryKey(rawKey: string): boolean {
  let key = rawKey;
  try {
    key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
  } catch {
    // Bozuk yüzde-kodlaması: ham anahtarla karşılaştır.
  }
  const normalized = normalizeKey(key);
  return SECRET_QUERY_KEYS.has(normalized) || SECRET_QUERY_SUFFIXES.some((s) => normalized.endsWith(s));
}

function maskPath(path: string): string {
  const segments = path.split('/');
  return segments
    .map((segment, index) => {
      const previous = index > 0 ? segments[index - 1] : undefined;
      if (previous !== undefined && SECRET_FOLLOWS_SEGMENT.has(previous.toLowerCase()) && segment !== '') {
        return URL_REDACTED;
      }
      return JWT_LIKE.test(segment) ? URL_REDACTED : segment;
    })
    .join('/');
}

function maskQuery(query: string): string {
  return query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      return isSecretQueryKey(key) ? `${key}=${URL_REDACTED}` : pair;
    })
    .join('&');
}

/**
 * `req.originalUrl` biçimindeki (yol + isteğe bağlı sorgu) URL'yi günlük için maskeler.
 * Gizli değer yoksa girdiyi AYNEN döndürür.
 */
export function maskUrlForLog(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) return maskPath(url);
  return `${maskPath(url.slice(0, q))}?${maskQuery(url.slice(q + 1))}`;
}
