import { prisma } from '../db.js';
import { logger } from './logger.js';

/**
 * Kullanıcının son kimlik-doğrulama aktivitesini kaydeder (lastLoginAt = şimdi).
 *
 * Retention/pasiflik metriklerinin TEMEL verisidir; hem tenant admin paneli hem de
 * (ileride) platform admin bu alanı kullanır — bu yüzden auth katmanında tek bir
 * yeniden kullanılabilir yardımcıya toplanmıştır.
 *
 * "Login" değil "aktivite": sadece açık girişte değil, token yenilemede de güncellenir.
 * Aksi hâlde refresh ile 7 gün ayakta kalan oturumlar (kullanıcı aktifken) pasif
 * görünürdü — yanlış pasiflik sinyali. Böylece lastLoginAt "son kimlik-doğrulama anı"nı yansıtır.
 *
 * NON-FATAL: Aktiflik takibi ASLA giriş/oturum akışını bozmamalı. Hata yutulur ve loglanır;
 * çağıranlar `void` ile fire-and-forget kullanabilir (yanıt gecikmesin).
 */
export async function recordUserActivity(userId: string): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  } catch (err) {
    // Sadece userId loglanır (KVKK: log'da PII yok).
    void logger.error('AUTH', 'lastLoginAt güncellenemedi', {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
