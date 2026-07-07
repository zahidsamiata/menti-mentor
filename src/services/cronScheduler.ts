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
import { prisma } from '../db.js';
import { tuneScoringWeights } from './algorithmTuner.js';
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

/**
 * Her tenant'ın reportingFrequency ayarını kontrol ederek sadece
 * uygun olanlar için tuning çalıştırır.
 * WEEKLY: her Pazar çalışır
 * BIWEEKLY: 1. ve 3. Pazar çalışır
 * MONTHLY: sadece ayın 1. Pazar'ı çalışır
 */
async function runWeeklyTuning(): Promise<void> {
  void logger.info('SYSTEM', 'Cron: Algoritma ağırlık ayarlaması başladı');
  try {
    const now = new Date();
    const weekOfMonth = Math.ceil(now.getDate() / 7); // 1-5

    const tenants = (await prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    })) as Array<{ id: string; name: string; reportingFrequency?: string }>;

    let processed = 0;
    let skipped = 0;

    for (const tenant of tenants) {
      const freq = tenant.reportingFrequency ?? 'WEEKLY';
      const shouldRun =
        freq === 'WEEKLY' ||
        (freq === 'BIWEEKLY' && (weekOfMonth === 1 || weekOfMonth === 3)) ||
        (freq === 'MONTHLY'  && weekOfMonth === 1);

      if (!shouldRun) { skipped++; continue; }

      try {
        await tuneScoringWeights(tenant.id);
        processed++;
      } catch (err) {
        void logger.error('ML', `Tenant ${tenant.id} tuning başarısız`, { error: String(err) });
      }
    }

    void logger.info('SYSTEM', 'Cron: Ağırlık ayarlaması tamamlandı', { processed, skipped });
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
