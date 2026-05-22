import 'dotenv/config';

function require(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Zorunlu environment değişkeni eksik: ${key}`);
  return v;
}

if (process.env.NODE_ENV === 'production' && process.env.DEFAULT_TENANT_ID) {
  throw new Error('DEFAULT_TENANT_ID production ortamında tanımlanamaz.');
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  defaultTenantId: process.env.DEFAULT_TENANT_ID || undefined,

  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production-min-32-chars!!',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '24h',
  },

  // Platform geliştirici yönetim paneli — tenant sisteminin dışında
  platformAdminKey: process.env.PLATFORM_ADMIN_KEY ?? 'platform-dev-key-change-in-production',

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
};
