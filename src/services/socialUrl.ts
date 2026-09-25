import { z } from 'zod';

/**
 * K-08: profil sosyal bağlantıları yalnız ilgili platformun http(s) adresi olabilir
 * (LinkedIn alanına başka sitenin bağlantısı kaydedilemez). İki uç aynı kuralı kullanır:
 * `PATCH /api/users/me/profile` (userController) ve `PATCH /api/users/me/social`
 * (onboardingController). Boş dize ve null alanı temizler.
 */
const SOCIAL_PLATFORMS = {
  linkedin: { domain: 'linkedin.com', label: 'LinkedIn' },
  instagram: { domain: 'instagram.com', label: 'Instagram' },
} as const;

export type SocialPlatform = keyof typeof SOCIAL_PLATFORMS;

export function isPlatformUrl(value: string, platform: SocialPlatform): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  const { domain } = SOCIAL_PLATFORMS[platform];
  return host === domain || host.endsWith(`.${domain}`);
}

export function socialUrlSchema(platform: SocialPlatform) {
  const { domain, label } = SOCIAL_PLATFORMS[platform];
  return z.preprocess(
    (v) => (v === '' ? null : v),
    z
      .string()
      .trim()
      .max(300, 'Bağlantı en fazla 300 karakter olabilir.')
      .refine((v) => isPlatformUrl(v, platform), {
        message: `${label} alanına yalnız ${domain} adresi girilebilir (https://… ile başlamalı).`,
      })
      .nullable()
      .optional(),
  );
}
