import { prisma } from '../db.js';
import type { LogLevel } from '@prisma/client';

// Desteklenen log kategorileri
type LogCategory = 'EMAIL' | 'ML' | 'AUTH' | 'DB' | 'HTTP' | 'SYSTEM';

/**
 * Her log girişini hem konsola hem de SystemLog tablosuna yazar.
 * DB yazım hatası konsol çıktısını engellemez.
 */
async function writeLog(
  level: LogLevel,
  category: LogCategory,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
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
