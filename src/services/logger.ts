import { prisma } from '../db.js';
import type { LogLevel } from '@prisma/client';
import { sanitizeLogMeta, scrubText } from './logSanitizer.js';

// Desteklenen log kategorileri
// AUDIT: KVKK Md.12 — platform admin'in hassas veri erişimini izlenebilir kılan denetim kaydı.
type LogCategory = 'EMAIL' | 'ML' | 'AUTH' | 'DB' | 'HTTP' | 'SYSTEM' | 'AUDIT';

/**
 * Her log girişini hem konsola hem de SystemLog tablosuna yazar.
 * DB yazım hatası konsol çıktısını engellemez.
 *
 * KVKK (backend/CLAUDE.md PII kuralı #5): mesaj ve meta yazılmadan ÖNCE `logSanitizer`'dan geçer —
 * çağrı yeri yanlışlıkla e-posta/ad/token koysa bile kalıcı SystemLog'a ham hâli inmez.
 */
async function writeLog(
  level: LogLevel,
  category: LogCategory,
  rawMessage: string,
  rawMeta?: Record<string, unknown>,
): Promise<void> {
  const message = scrubText(rawMessage);
  const meta = rawMeta ? sanitizeLogMeta(rawMeta) : undefined;

  // Konsola yaz
  console.log(`[${level}] [${category}] ${message}`);

  // DB'ye asenkron yaz — hata yakalanır, ana akışı kesmez
  try {
    await prisma.systemLog.create({
      data: {
        level,
        category,
        message,
        meta: meta ? (meta as object) : undefined,
      },
    });
  } catch (dbErr) {
    // DB hatası sadece konsola düşer, log akışını durdurmaz
    console.error('[LOGGER] SystemLog DB yazımı başarısız:', dbErr);
  }
}

export const logger = {
  info(category: LogCategory, message: string, meta?: Record<string, unknown>): Promise<void> {
    return writeLog('INFO', category, message, meta);
  },

  warn(category: LogCategory, message: string, meta?: Record<string, unknown>): Promise<void> {
    return writeLog('WARN', category, message, meta);
  },

  error(category: LogCategory, message: string, meta?: Record<string, unknown>): Promise<void> {
    return writeLog('ERROR', category, message, meta);
  },
};
