/**
 * Y1-B8 (KARAR-101 B genişletilmiş + EK) — onay bekleyen kullanıcı kapısı.
 *
 * Ürün kararı: onay bekleyen kişi (şifre, Google ya da LinkedIn — üç giriş yolu EŞİT) giriş yapar,
 * kayıt sürecini (8 soru, mentör/menti soruları, profil) ve günlük soruların tamamını çözer, sistemde
 * gezinir. Mentörleri YALNIZ isimsiz özet olarak görür (`GET /api/users/mentor-count`, k-anonim).
 * Eşleşme, mentör listesi/profili, mesaj, talep, randevu ve anlaşma yönetici onayına kadar KAPALI.
 *
 * Neden "varsayılan kapalı + izin listesi": eskiden kapı tek tek uçlara yazılıyordu (approvalGate.ts,
 * userController.listUsers/getUser) ve OAuth ile gelen onay bekleyen kişi bu uçlar dışındaki her şeye
 * (mesaj, randevu, anlaşma) erişebiliyordu (güvenlik açığı B8). Yeni uç eklendiğinde kapı kendiliğinden
 * KAPALI başlar; açmak için buraya bilinçli satır eklenir.
 *
 * Uygulama yeri: `requireTenant` adım 4c (tenant.ts) — üyelik sorgusu zaten `approvalStatus`'u okuyor,
 * istek başına ek sorgu yok. Kurum yöneticisi (ADMIN) bu kapıya girmez (approvalGate.ts ile aynı kural).
 *
 * Listeye yeni satır eklemeden önce: uç yalnız ÇAĞIRANIN KENDİ verisini okumalı/yazmalı ya da kişisel veri
 * içermeyen bir özet dönmeli. Başka kullanıcının adı/fotoğrafı/profili ya da başka kişiyle etkileşim
 * (mesaj, talep, randevu, anlaşma) dönen/yazan uç ASLA eklenmez.
 */

type AllowedRoute = { method: string; pattern: RegExp };

const ID = '[^/]+';

const PENDING_ALLOWED_ROUTES: ReadonlyArray<AllowedRoute> = [
  // Oturum durumu, yeniden rıza, şifre değiştirme (kimlik token'dan).
  { method: 'GET',   pattern: /^\/api\/auth\/me$/ },
  { method: 'POST',  pattern: /^\/api\/auth\/reconsent$/ },
  { method: 'POST',  pattern: /^\/api\/auth\/change-password$/ },
  // Kayıt süreci: profil, 8 soruluk kişilik testi, sosyal profil, eşleşme tercihleri.
  { method: 'POST',  pattern: /^\/api\/users\/profile\/complete$/ },
  { method: 'GET',   pattern: /^\/api\/users\/disc\/questions$/ },
  { method: 'POST',  pattern: /^\/api\/users\/disc\/submit$/ },
  { method: 'PATCH', pattern: /^\/api\/users\/me\/social$/ },
  { method: 'PATCH', pattern: /^\/api\/users\/me\/matching-preferences$/ },
  { method: 'PATCH', pattern: /^\/api\/users\/me\/profile$/ },
  { method: 'POST',  pattern: /^\/api\/users\/me\/avatar$/ },
  { method: 'POST',  pattern: /^\/api\/users\/me\/orientation-completed$/ },
  // Kendi profilini okuma: başkasının kaydı userController.getUser içinde ayrıca 403 (ONAY_BEKLENIYOR).
  { method: 'GET',   pattern: new RegExp(`^/api/users/${ID}$`) },
  // Kişilik soruları — sahiplik rotada requireSelfOrAdmin ile.
  { method: 'POST',  pattern: new RegExp(`^/api/users/${ID}/temperament-test$`) },
  { method: 'PATCH', pattern: new RegExp(`^/api/users/${ID}/self-profile$`) },
  { method: 'GET',   pattern: new RegExp(`^/api/users/${ID}/adaptive-test/(next|preview)$`) },
  { method: 'POST',  pattern: new RegExp(`^/api/users/${ID}/adaptive-test/answer$`) },
  // Günlük/derinleşme soruları (kendi cevapları).
  { method: 'GET',   pattern: /^\/api\/questions$/ },
  { method: 'POST',  pattern: /^\/api\/questions\/respond$/ },
  { method: 'GET',   pattern: /^\/api\/questions\/my-responses$/ },
  { method: 'POST',  pattern: new RegExp(`^/api/questions/${ID}/respond$`) },
  { method: 'POST',  pattern: /^\/api\/tags\/suggest$/ },
  // Mentörlerin İSİMSİZ özeti (sayı + alan dağılımı, k-anonim) ve kurumun haftalık görüşme kuralı.
  { method: 'GET',   pattern: /^\/api\/users\/mentor-count$/ },
  { method: 'GET',   pattern: /^\/api\/meetings\/weekly-limit$/ },
  // Öğrenme yolculuğu: eğitim içeriği + kişinin kendi ilerlemesi (başka kişi verisi yok).
  { method: 'GET',   pattern: /^\/api\/learning-journey\/(stages|status)$/ },
  { method: 'POST',  pattern: /^\/api\/learning-journey\/complete$/ },
  { method: 'POST',  pattern: new RegExp(`^/api/learning-journey/stages/${ID}/select$`) },
  // KVKK md.11 veri sahibi hakları — onay durumundan bağımsız yasal hak (tenantSuspension.ts ile aynı gerekçe).
  { method: 'GET',   pattern: new RegExp(`^/api/users/${ID}/export$`) },
  { method: 'GET',   pattern: /^\/api\/me\/data-export$/ },
  { method: 'POST',  pattern: /^\/api\/me\/delete-account$/ },
];

/**
 * İstek onay bekleyen kullanıcıya açık mı? `originalUrl` kullanılır (router mount'undan bağımsız tam yol);
 * sorgu dizesi atılır, sondaki "/" ve büyük/küçük harf normalize edilir (tenantSuspension.ts ile aynı).
 */
export function isPendingAllowedRequest(method: string, originalUrl: string): boolean {
  // 7b notu: '#' sonrası da atılır — Express '/api/users/#x' isteğini '/api/users'e yönlendirir; atılmazsa
  // yol '/api/users/:id' izin desenine uyup listeye ulaşırdı.
  const rawPath = originalUrl.split(/[?#]/)[0] ?? '';
  const path = (rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath).toLowerCase();
  const upperMethod = method.toUpperCase();
  return PENDING_ALLOWED_ROUTES.some((r) => r.method === upperMethod && r.pattern.test(path));
}

/** Komşu kapı approvalGate.ts ile aynı hata kodu; ön yüz bu kodla "yönetici onayı bekleniyor" kilidini gösterir. */
export const PENDING_APPROVAL_BODY = {
  error:   'ONAY_BEKLENIYOR',
  message: 'Bu bölüm yönetici onayından sonra açılır.',
} as const;
