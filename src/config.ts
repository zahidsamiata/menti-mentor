import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const isProd = process.env.NODE_ENV === 'production';

if (isProd && process.env.DEFAULT_TENANT_ID) {
  throw new Error('DEFAULT_TENANT_ID production ortamında tanımlanamaz.');
}

const DEV_JWT_SECRET = 'dev-secret-change-in-production-min-32-chars!!';
const jwtSecret = process.env.JWT_SECRET ?? DEV_JWT_SECRET;

if (isProd && jwtSecret === DEV_JWT_SECRET) {
  throw new Error('JWT_SECRET production ortamında varsayılan değerle çalışamaz.');
}

const DEV_PLATFORM_KEY = 'platform-dev-key-change-in-production';
const platformAdminKey = process.env.PLATFORM_ADMIN_KEY ?? DEV_PLATFORM_KEY;

if (isProd && platformAdminKey === DEV_PLATFORM_KEY) {
  throw new Error('PLATFORM_ADMIN_KEY production ortamında varsayılan değerle çalışamaz.');
}

// Platform admin e-posta — /platform/login için ikinci faktör
const platformAdminEmail = process.env.PLATFORM_ADMIN_EMAIL ?? 'admin@platform.local';

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
    smtpUser: process.env.SMTP_USER ?? '',
    smtpPass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'noreply@example.com',
  },

  // Frontend base URL — davet linkleri ve şifre sıfırlama URL'leri için kullanılır
  frontendBaseUrl: process.env.FRONTEND_URL ?? 'http://localhost:3001',

  // Backend base URL — backend API route'larına doğrudan link üretirken kullanılır.
  // Tek-domain deploy'da FRONTEND_URL ile aynı olabilir; ayrı-domain deploy'da farklı set edilir.
  // Örnek: e-posta unsubscribe linki backend'in /api/tenants/unsubscribe endpoint'ine gitmeli.
  backendBaseUrl: process.env.BACKEND_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:3000',

  // Davet token geçerlilik süresi — sosyal girişim kullanıcıları için uzun tutulur
  invitationTokenExpiry: process.env.INVITATION_TOKEN_EXPIRY ?? '90d',

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
  },
};
