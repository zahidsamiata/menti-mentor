/**
 * Cron Scheduler
 *
 * Haftalık otomasyon görevleri:
 *   1. algorithmTuner.runGlobalTuning() — Her Pazar 02:00 UTC
 *      NPS verilerine göre 60/40 sektör/DISC ağırlıklarını tenant bazında ayarlar.
 *   2. gdprService.purgeExpiredData()   — Her Pazar 03:00 UTC
 *      90 günden eski SystemLog kayıtlarını temizler (KVKK Md.7).
 *
 * Env: CRON_ENABLED=false ile tüm cron'lar devre dışı bırakılır (test/dev ortamları).
 */

import cron from 'node-cron';
import { runGlobalTuning } from './algorithmTuner.js';
import { purgeExpiredData } from './gdprService.js';
import { logger } from './logger.js';

/**
 * Cron etkinleştirme koşulları (AND mantığı):
 *  1. NODE_ENV !== 'test'   → test ortamında cron asla çalışmaz; Vitest izolasyonu korunur
 *  2. CRON_ENABLED !== 'false' → geliştirici ortamında manuel kapatma imkânı
 */
const CRON_ENABLED =
  process.env.NODE_ENV !== 'test' &&
  process.env.CRON_ENABLED !== 'false';

// ─── Görev: Algoritma Ağırlık Ayarlaması ─────────────────────────────────────

async function runWeeklyTuning(): Promise<void> {
  void logger.info('SYSTEM', 'Cron: Algoritma ağırlık ayarlaması başladı');
  try {
    const results = await runGlobalTuning();
    const adjusted = results.filter((r) => r.adjusted).length;
    void logger.info('SYSTEM', `Cron: Ağırlık ayarlaması tamamlandı`, {
      tenantsProcessed: results.length,
      tenantsAdjusted: adjusted,
    });
  } catch (err) {
    void logger.error('SYSTEM', 'Cron: Ağırlık ayarlaması başarısız', { error: String(err) });
  }
}

// ─── Görev: Süresi Dolan Veri Temizliği ──────────────────────────────────────

async function runWeeklyPurge(): Promise<void> {
  void logger.info('SYSTEM', 'Cron: KVKK veri temizliği başladı');
  try {
    const result = await purgeExpiredData();
    void logger.info('SYSTEM', `Cron: KVKK temizliği tamamlandı`, {
      systemLogsDeleted: result.systemLogsDeleted,
    });
  } catch (err) {
    void logger.error('SYSTEM', 'Cron: KVKK veri temizliği başarısız', { error: String(err) });
  }
}

// ─── Scheduler başlatma ───────────────────────────────────────────────────────

export function startCronScheduler(): void {
  if (!CRON_ENABLED) {
    console.log('[CRON] CRON_ENABLED=false — tüm zamanlanmış görevler devre dışı.');
    return;
  }

  // Her Pazar 02:00 UTC — Algoritma ayarlaması
  cron.schedule('0 2 * * 0', () => {
    void runWeeklyTuning();
  }, { timezone: 'UTC' });

  // Her Pazar 03:00 UTC — KVKK veri temizliği
  cron.schedule('0 3 * * 0', () => {
    void runWeeklyPurge();
  }, { timezone: 'UTC' });

  console.log('[CRON] Haftalık görevler zamanlandı: Pazar 02:00 (tuning) + 03:00 (purge) UTC');
}

// ─── Manuel tetikleme (admin endpoint'inden çağrılır) ────────────────────────

export { runWeeklyTuning, runWeeklyPurge };
