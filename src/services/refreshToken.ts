import crypto from 'node:crypto';

/**
 * Refresh token saklama kuralı (GV-13).
 *
 * Neden hash: şifre sıfırlama token'ıyla aynı desen (authController hashToken). Çerezdeki
 * ham değer istemcide kalır; veritabanına yalnız SHA-256 özeti yazılır. Veritabanı kopyası
 * ele geçse bile özetten geçerli bir çerez üretilemez.
 *
 * Şema değişmedi: özet mevcut `RefreshToken.token` (@unique) sütununa yazılır.
 *
 * GEÇİŞ UYUMLULUĞU: bu değişiklikten önce yazılmış kayıtlar sütunda AÇIK METİN duruyor.
 * Onları zorla geçersiz kılmamak için arama iki anahtarla yapılır: önce özet, sonra (yalnız
 * eski biçimdeki bir çerez için) ham değer. Eski kayıt bulunursa refresh'in mevcut rotasyonu
 * onu siler ve yerine özetli yeni kayıt yazar → kullanıcı çıkış yapmadan geçiş tamamlanır,
 * toplu veri yazımı gerekmez. Eski kayıtların ömrü en fazla REFRESH_TOKEN_EXPIRY_DAYS (7 gün);
 * bu süre dolduktan sonra ham-değer araması kaldırılabilir.
 */

/** Ham refresh token uzunluğu: 64 bayt → 128 hex karakter (tüm üretim noktaları bu biçimde). */
const RAW_REFRESH_TOKEN_HEX_LENGTH = 128;
const HEX_PATTERN = /^[0-9a-f]+$/;

/** Veritabanına yazılacak değer: ham token'ın SHA-256 özeti (64 hex karakter). */
export function hashRefreshToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Çerezdeki ham değer için veritabanında aranacak anahtarlar (öncelik sırasıyla).
 *
 * Ham-değer anahtarı yalnız çerez eski üretim biçimindeyse (128 hex) eklenir. Özetler 64
 * karakter olduğundan, sütunda duran bir özetin kendisi çerez olarak sunulursa hiçbir
 * anahtarla eşleşmez — ham-değer araması yalnız geçiş dönemindeki eski kayıtları bulur.
 */
export function refreshTokenLookupKeys(raw: string): string[] {
  const keys = [hashRefreshToken(raw)];
  if (raw.length === RAW_REFRESH_TOKEN_HEX_LENGTH && HEX_PATTERN.test(raw)) {
    keys.push(raw);
  }
  return keys;
}

/** Prisma `where` koşulu: çerezdeki ham değere ait kayıt (özetli veya eski açık metin). */
export function refreshTokenWhere(raw: string): { token: { in: string[] } } {
  return { token: { in: refreshTokenLookupKeys(raw) } };
}
