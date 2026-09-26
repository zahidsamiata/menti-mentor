import { prisma } from '../db.js';
import { config } from '../config.js';
import { logger } from './logger.js';
import { getSmtpStatus, type SmtpStatus } from './emailService.js';
import { isCronEnabled } from './cronScheduler.js';

export interface HealthStatus {
  ok: boolean;
  db: 'up' | 'down';
  // V-01: son SMTP verify sonucu (önbellekli); V-11: zamanlanmış görevler açık mı.
  smtp: SmtpStatus;
  cron: 'enabled' | 'disabled';
  env: string;
  ts: string;
  version: string;
  // V-16: canlıda hangi backend commit'inin koştuğunu gösterir. `GIT_SHA` build-arg'ı
  // Dockerfile'da ENV'e yazılır; wire edilmemişse (ör. Dokploy build-arg'ı henüz
  // ayarlanmadıysa) 'unknown' döner — sabit ama yanlış bir sürüm göstermekten iyidir.
  commit: string;
  uptime: number;
}

/**
 * Sağlık durumu — HAFİF DB canlılık kontrolü (SELECT 1) dahil. (W denetimi §4#8)
 *
 * Neden: `/health` Docker healthcheck (`docker-compose.yml`) tarafından kullanılıyor ve
 * frontend `depends_on: service_healthy` ona güveniyor. Eskiden uç DB'ye HİÇ bakmıyordu →
 * Postgres düşse bile konteyner "healthy" görünüyor, kimse uyarılmıyordu (yalancı sağlık).
 *
 * - Sorgu HAFİF tutulur (`SELECT 1`) — healthcheck sık çağrılır, ağır sorgu YAZILMAZ.
 * - DB erişilemezse uygulama ÇÖKMEZ (try/catch); yalnız `db:'down'` + `ok:false` döner,
 *   çağıran uç 503 verir → orchestrator gerçek durumu görür.
 */
export async function getHealthStatus(): Promise<HealthStatus> {
  let db: 'up' | 'down' = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = 'up';
  } catch (err) {
    void logger.warn('DB', 'health-check DB canlılık sorgusu başarısız', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return {
    ok: db === 'up',
    db,
    smtp: getSmtpStatus(),
    cron: isCronEnabled() ? 'enabled' : 'disabled',
    env: config.nodeEnv,
    ts: new Date().toISOString(),
    version: process.env.npm_package_version ?? '0.1.0',
    commit: process.env.GIT_SHA ?? 'unknown',
    uptime: Math.floor(process.uptime()),
  };
}
