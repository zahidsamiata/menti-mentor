/**
 * Şifre sıfırlama bağlantısı — tek kaynak.
 *
 * İki üretici aynı tokenı kullanır:
 *  - `POST /api/auth/forgot-password` → bağlantı kişinin kendi e-postasına gider;
 *  - `POST /api/platform/tenants/:id/users/:userId/password-reset-link` (U-15, KARAR-84 B) → e-posta
 *    çalışmadığında bağlantıyı YALNIZ platform yöneticisi üretir ve kişiye kendisi iletir (her üretim iz kaydına).
 *
 * Güvenlik modeli değişmedi: 256-bit entropi, DB'de yalnız SHA-256 özeti, 60 dakika, tek kullanımlık
 * (kullanımda token silinir ve tüm oturumlar düşer — authController.resetPassword). Yeni token önceki
 * tüm sıfırlama tokenlarını geçersiz kılar.
 */
import crypto from 'node:crypto';
import { prisma } from '../db.js';

export const RESET_TOKEN_EXPIRY_MINUTES = 60;

export function resetTokenExpiresAt(): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() + RESET_TOKEN_EXPIRY_MINUTES);
  return d;
}

export function hashResetToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Kişinin eski sıfırlama tokenlarını siler, yenisini yazar; ham tokenı döndürür (DB'de yalnız özeti durur). */
export async function issuePasswordResetToken(userId: string): Promise<string> {
  await prisma.passwordResetToken.deleteMany({ where: { userId } });
  const rawToken = crypto.randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({
    data: {
      tokenHash: hashResetToken(rawToken),
      userId,
      expiresAt: resetTokenExpiresAt(),
    },
  });
  return rawToken;
}

/** Ön yüzdeki sıfırlama sayfasının bağlantısı (e-posta ve platform yöneticisi aynı adresi verir). */
export function buildPasswordResetUrl(rawToken: string): string {
  return `${process.env.FRONTEND_URL ?? 'http://localhost:3001'}/reset-password?token=${encodeURIComponent(rawToken)}`;
}
