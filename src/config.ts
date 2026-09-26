import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
// Zod Türkçe varsayılan mesajları (IC-05) — config her giriş noktasının ilk yüklediği modül.
import './zodLocale.js';
// .env, backend kökündedir (backend/.env). Bu dosya backend/src/config.ts olduğundan
// doğru göreli yol '../.env' (bir üst); '../../.env' repo köküne çıkıp dosyayı bulamaz
// ve tüm config sessizce varsayılanlara düşerdi. Prod'da (Docker) dosya yoktur, env
// docker-compose'tan gelir — bu yüzden orada etki yok.
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

const isProd = process.env.NODE_ENV === 'production';

if (isProd && process.env.DEFAULT_TENANT_ID) {
  throw new Error('DEFAULT_TENANT_ID production ortamında tanımlanamaz.');
}

// V-06: koda gömülü yedek JWT anahtarı KALDIRILDI (depo herkese açık — gömülü değer herkesçe
// bilinir). JWT_SECRET her ortamda açıkça verilmeli; yoksa süreç açılmaz (fail-closed).
// Eski herkese açık değer yalnız YASAK listesi olarak durur: canlıda kullanılırsa yine reddedilir.
const KNOWN_PUBLIC_DEV_JWT_SECRET = 'dev-secret-change-in-production-min-32-chars!!';
// Değer olduğu gibi kullanılır (kırpılmaz) — canlıdaki mevcut anahtar birebir aynı kalsın,
// açık oturumlar düşmesin. Yalnız boş / yalnız-boşluk değer reddedilir.
const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret || !jwtSecret.trim()) {
  throw new Error(
    'JWT_SECRET tanımlı değil. backend/.env dosyasına (bkz. .env.example) ya da ortam değişkenlerine ekleyin.',
  );
}
if (isProd && jwtSecret === KNOWN_PUBLIC_DEV_JWT_SECRET) {
  throw new Error('JWT_SECRET production ortamında varsayılan değerle çalışamaz.');
}

const DEV_PLATFORM_KEY = 'platform-dev-key-change-in-production';
const platformAdminKey = process.env.PLATFORM_ADMIN_KEY ?? DEV_PLATFORM_KEY;

if (isProd && platformAdminKey === DEV_PLATFORM_KEY) {
  throw new Error('PLATFORM_ADMIN_KEY production ortamında varsayılan değerle çalışamaz.');
}

// Platform admin e-posta — /platform/login için ikinci faktör
const DEV_PLATFORM_EMAIL = 'admin@platform.local';
const platformAdminEmail = process.env.PLATFORM_ADMIN_EMAIL ?? DEV_PLATFORM_EMAIL;

// KEY'in aksine burada THROW YOK (bilinçli): canlıda bu değişken set edilmemişse süreç
// çökerse tüm site kapanır. Tahmin edilebilir ikinci faktör ciddi bir eksiktir ama
// hizmeti durdurmayı gerektirmez → yalnız uyarı. Uyarı logger yerine console.warn ile
// yazılır: config, modül yüklenirken değerlendirilir ve logger → db → Prisma zinciri
// açılışta DB yazımı tetikler.
if (isProd && platformAdminEmail === DEV_PLATFORM_EMAIL) {
  console.warn(
    '[UYARI] PLATFORM_ADMIN_EMAIL ortam değişkeni set edilmemiş — platform giriş e-postası ' +
      'tahmin edilebilir varsayılan değerde. İkinci faktör koruma sağlamıyor; ' +
      'ortam değişkenlerine PLATFORM_ADMIN_EMAIL eklenmeli.',
  );
}

// Yükleme boyutu sınırı (GV-22). Ayar yanlış yazılırsa (`5MB`, boş, negatif) `Number()` NaN/0
// üretir; multer'ın `fileSize` sınırı NaN ile karşılaştırmada hiç tetiklenmez → sınır sessizce
// kalkar. Geçersiz değerde varsayılana düşülür ve açılışta uyarı yazılır (console.warn: yukarıdaki
// PLATFORM_ADMIN_EMAIL uyarısıyla aynı gerekçe).
export const DEFAULT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export function parseUploadMaxBytes(raw: string | undefined = process.env.UPLOAD_MAX_BYTES): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_UPLOAD_MAX_BYTES;
  const value = Number(raw);
  if (Number.isSafeInteger(value) && value > 0) return value;
  console.warn(
    `[UYARI] UPLOAD_MAX_BYTES geçersiz (bayt cinsinden pozitif tam sayı olmalı) — ` +
      `varsayılan ${DEFAULT_UPLOAD_MAX_BYTES} bayt kullanılıyor.`,
  );
  return DEFAULT_UPLOAD_MAX_BYTES;
}

// Backend base URL — hem config.backendBaseUrl hem de yüklenen avatar'ın public
// URL tabanı için kullanılır. Object içinde iki kez tekrar etmemek için üste alındı.
const backendBaseUrl = process.env.BACKEND_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:3000';

// CORS izinli origin listesi (Y-01). Varsayılan: lokal frontend.
const DEFAULT_ALLOWED_ORIGINS = 'http://localhost:3001,http://127.0.0.1:3001';

/**
 * ALLOWED_ORIGINS env değerini CORS için origin dizisine çevirir.
 * Virgülle ayırır, **her origin'in baş/son boşluğunu temizler** ve boşları atar.
 * Boşluk toleransı olmazsa env'de `a.com, b.com` yazıldığında `" b.com"` origin'i
 * CORS'ta HİÇ eşleşmez → tarayıcı isteği reddedilir, site sessizce açılmaz.
 */
export function parseAllowedOrigins(
  raw: string | undefined = process.env.ALLOWED_ORIGINS,
): string[] {
  return (raw ?? DEFAULT_ALLOWED_ORIGINS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  defaultTenantId: process.env.DEFAULT_TENANT_ID || undefined,

  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  },

  platformAdminKey,
  platformAdminEmail,

  llm: {
    provider: process.env.LLM_PROVIDER ?? 'openai',
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
  },

  email: {
    // Generic SMTP relay (öneri: Resend). service:'gmail' bırakıldı — sağlayıcı
    // değişimi artık yalnızca env ile (host/port/user/pass).
    smtpHost: process.env.SMTP_HOST ?? '',
    smtpPort: Number(process.env.SMTP_PORT ?? 465),
    // 465 → implicit TLS (secure); 587/2525 → STARTTLS. Override: SMTP_SECURE=true|false.
    smtpSecure: process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE === 'true'
      : Number(process.env.SMTP_PORT ?? 465) === 465,
    smtpUser: process.env.SMTP_USER ?? '',
    smtpPass: process.env.SMTP_PASS ?? '',
    // Gönderen kurumsal, SPF/DKIM doğrulanmış domain olmalı. SMTP_USER'a DÜŞME —
    // Resend'de SMTP_USER "resend" gibi bir kullanıcı adıdır, gönderen adresi değil.
    from: process.env.SMTP_FROM ?? 'noreply@sivilkapasite.org',
    // #37: Kurum (STK) başvuru bildirimleri (onay/red/düzeltme-iste) — GÖNDERİM BAYRAĞI.
    // Varsayılan KAPALI (false): altyapı hazır ama gerçek mail GİTMEZ, yalnız log'lanır.
    // Ürün sahibi `destek@` adresini kurup prod env'i bağlayınca `true` yapılıp açılacak.
    // Canlıya istenmeyen mail gitmesi geri alınamaz → bilinçli opt-in.
    tenantNotificationsEnabled: process.env.TENANT_NOTIFICATIONS_ENABLED === 'true',
  },

  // CORS izinli origin listesi (boşluk-toleranslı, Y-01)
  allowedOrigins: parseAllowedOrigins(),

  // Frontend base URL — davet linkleri ve şifre sıfırlama URL'leri için kullanılır
  frontendBaseUrl: process.env.FRONTEND_URL ?? 'http://localhost:3001',

  // Backend base URL — backend API route'larına doğrudan link üretirken kullanılır.
  // Tek-domain deploy'da FRONTEND_URL ile aynı olabilir; ayrı-domain deploy'da farklı set edilir.
  // Örnek: e-posta unsubscribe linki backend'in /api/tenants/unsubscribe endpoint'ine gitmeli.
  backendBaseUrl,

  // Davet token geçerlilik süresi — sosyal girişim kullanıcıları için uzun tutulur
  invitationTokenExpiry: process.env.INVITATION_TOKEN_EXPIRY ?? '90d',

  /**
   * Kullanıcı avatarı yükleme yapılandırması (kendi foto yükleme özelliği).
   * dir: Yüklenen dosyaların yazıldığı klasör. Deploy'da SİLİNMEMESİ için kalıcı
   *   disk (Dokploy persistent volume) olarak mount edilmeli — UPLOAD_DIR ile verilir.
   *   Lokal geliştirmede varsayılan: backend/uploads (process.cwd() = backend kökü).
   * publicBaseUrl: Yüklenen dosyanın erişileceği URL tabanı (avatarUrl bununla üretilir).
   *   Ayrı-domain deploy'da CDN/statik host farklıysa UPLOAD_PUBLIC_BASE_URL ile override edilir;
   *   varsayılan backend'in kendi origin'idir (/uploads express.static ile servis edilir).
   * maxBytes: Kabul edilen azami dosya boyutu (varsayılan 5MB).
   */
  upload: {
    dir: process.env.UPLOAD_DIR ?? resolve(process.cwd(), 'uploads'),
    publicBaseUrl: (process.env.UPLOAD_PUBLIC_BASE_URL ?? backendBaseUrl).replace(/\/+$/, ''),
    maxBytes: parseUploadMaxBytes(),
  },

  /**
   * OAuth provider yapılandırması.
   * redirectUri değerleri, provider console'larında (Google Cloud Console,
   * LinkedIn Developer Portal) Authorized Redirect URI olarak kayıtlı olmalıdır.
   * Boş string, provider'ın devre dışı olduğunu gösterir — buildAuthUrl çağrılırsa
   * runtime'da hata fırlatılır.
   */
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/api/auth/google/callback',
    },
    linkedin: {
      clientId: process.env.LINKEDIN_CLIENT_ID ?? '',
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET ?? '',
      redirectUri: process.env.LINKEDIN_REDIRECT_URI ?? 'http://localhost:3000/api/auth/linkedin/callback',
    },
    /** Başarılı veya başarısız OAuth sonrasında frontend'e yönlendirme adresi. */
    frontendCallbackUrl: process.env.FRONTEND_OAUTH_CALLBACK_URL ?? 'http://localhost:3001/oauth/callback',
    /**
     * AN-30 / KARAR-34 (OAuth ayağı) — açıkken yeni OAuth kaydı kullanıcıyı ANINDA oluşturmaz;
     * bunun yerine kısa ömürlü "bekleyen kayıt" token'ı üretip frontend'e granüler rıza ekranını
     * gösterir (bkz. oauthPendingRegistration.ts). Register (form) ucundaki `granularConsent`
     * alanı FE'nin gönderip göndermediğine göre çalışır; OAuth'ta karar server-side redirect
     * anında verilmesi gerektiği için ayrı bir backend flag'i şart. Varsayılan KAPALI (false) —
     * kapalıyken `handleNewUser` davranışı BİREBİR eskisi gibi kalır (implicit rıza + anında kayıt).
     */
    granularConsentEnabled: process.env.GRANULAR_CONSENT_ENABLED === 'true',
  },
};
