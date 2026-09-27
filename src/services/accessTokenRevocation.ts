/**
 * AJ-03 — çıkış (logout) sonrası erişim (access) anahtarının anında reddi.
 *
 * SORUN: refresh token DB'de saklanır ve logout'ta silinir (bkz. authController.logout,
 * platformController.platformLogout) — ama access token (JWT) imzalı ve kendi başına
 * geçerlidir; sunucu tarafında onu iptal edecek bir mekanizma YOKTU. Kullanıcı çıkış yaptıktan
 * sonra bile o anahtar süresi dolana kadar (config.jwt.expiresIn, varsayılan 1h; platform
 * anahtarı için PLATFORM_COOKIE_OPTS.maxAge=1h) korunan uçlara erişebiliyordu.
 *
 * Projede halihazırda bir "oturum iptali" deseni VAR ama bu onun kapsamadığı bir eksen:
 * GV-10 (`tests/session-revocation.test.ts`) rol düşürme/red/pasife alma durumunda
 * `requireTenant`'ın HER İSTEKTE üyelik+hesap durumunu DB'den okumasına dayanır (kullanıcı
 * hâlâ aktif ama farklı yetkide/DB durumunda). Düz "logout" farklıdır: kullanıcı durumu
 * DEĞİŞMEZ, yalnız BU oturumun bu anahtarı geçersiz sayılmalıdır — DB'den okunacak bir "hesap
 * durumu" yok, doğrudan "bu belirli anahtar iptal edildi mi" sorusu gerekir. Proje genelinde
 * böyle bir jti/denylist deseni YOKTU (grep: tokenVersion/sessionVersion/revoked/jti — hepsi
 * boş) → bu dosya o boşluğu dolduruyor.
 *
 * ŞEMA/MIGRATION YASAK (AJ-03 görev tanımı) → yeni DB tablosu/kolonu YOK. Bunun yerine:
 * `signToken()` her anahtara rastgele bir `jti` claim'i ekler (bkz. jwtAuth.ts); logout bu
 * jti'yi, anahtarın KALAN ömrü kadar (exp - now) süreyle bu bellek-içi listeye yazar.
 * `verifyToken()` her doğrulamada listeye bakar (bkz. jwtAuth.ts verifyToken).
 *
 * TEK-INSTANCE VARSAYIMI (AN-06 dağıtım topolojisi teyidine bağlı): liste yalnız BU Node
 * sürecinin belleğinde tutulur, süreçler arası PAYLAŞILMAZ.
 *   - Yatay ölçekleme (birden çok backend instance'ı) varsa: bir instance'ta yapılan logout
 *     diğer instance'larda bu anahtarı iptal ETMEZ — istek şans eseri başka bir instance'a
 *     düşerse anahtar orada hâlâ geçerli sayılabilir. Çoklu instance doğrulanırsa bu liste
 *     paylaşılan bir depoya (ör. Redis) taşınmalıdır.
 *   - Süreç yeniden başlarsa (deploy/crash): liste sıfırlanır — o ana kadar iptal edilmiş ama
 *     süresi dolmamış eski anahtarlar yeniden geçerli sayılır. Kabul edilen risk: deploy seyrek,
 *     access token ömrü kısa (varsayılan 1h) → pencere küçük.
 *
 * GERİYE UYUMLULUK: bu değişiklikten ÖNCE imzalanmış anahtarlarda `jti` YOKTUR. Böyle bir
 * anahtar logout'ta iptal listesine hiç GİRMEZ (revokeAccessToken jti'siz çağrılmaz) —
 * ömürleri (en fazla mevcut config.jwt.expiresIn) boyunca geçerli kalmaya devam ederler. Bu
 * geçiş penceresi en fazla bir access-token-ömrü kadar sürer, sonra kendiliğinden kapanır.
 *
 * BELLEK SINIRI: liste sınırsız büyümesin diye eklerken doluluk kontrolü yapılır — önce süresi
 * geçmişler atılır, hâlâ doluysa en eski kayıt (Map ekleme sırasını korur) atılır. Normal
 * kullanımda dolmaz (aktif oturum sayısı << MAX_ENTRIES); bu yalnız bir üst sınır güvencesidir.
 */

const MAX_ENTRIES = 10_000;

/** jti → anahtarın `exp` claim'inin epoch-ms karşılığı. */
const revokedJtis = new Map<string, number>();

function pruneExpired(now: number): void {
  for (const [jti, expiresAtMs] of revokedJtis) {
    if (expiresAtMs <= now) revokedJtis.delete(jti);
  }
}

/**
 * Bir erişim anahtarını `jti`'si üzerinden iptal listesine ekler.
 * @param jti  Anahtarın `jti` claim'i.
 * @param exp  Anahtarın `exp` claim'i (JWT standardı — saniye cinsinden epoch).
 */
export function revokeAccessToken(jti: string, exp: number): void {
  const expiresAtMs = exp * 1000;
  const now = Date.now();
  if (expiresAtMs <= now) return; // zaten doğal olarak dolmuş, listeye almaya gerek yok

  if (revokedJtis.size >= MAX_ENTRIES) {
    pruneExpired(now);
  }
  if (revokedJtis.size >= MAX_ENTRIES) {
    const oldestKey = revokedJtis.keys().next().value;
    if (oldestKey !== undefined) revokedJtis.delete(oldestKey);
  }
  revokedJtis.set(jti, expiresAtMs);
}

/** Verilen jti şu an iptal listesinde mi (ve süresi dolmamış mı)? */
export function isAccessTokenRevoked(jti: string | undefined): boolean {
  if (!jti) return false;
  const expiresAtMs = revokedJtis.get(jti);
  if (expiresAtMs === undefined) return false;
  if (expiresAtMs <= Date.now()) {
    revokedJtis.delete(jti);
    return false;
  }
  return true;
}

/** Yalnız testler için: listeyi temizler (test izolasyonu). */
export function __resetAccessTokenRevocationForTests(): void {
  revokedJtis.clear();
}
