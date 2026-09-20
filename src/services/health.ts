import { prisma } from '../db.js';
import { config } from '../config.js';
import { logger } from './logger.js';

export interface HealthStatus {
  ok: boolean;
  db: 'up' | 'down';
  env: string;
  ts: string;
  version: string;
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
    env: config.nodeEnv,
    ts: new Date().toISOString(),
    version: process.env.npm_package_version ?? '0.1.0',
    uptime: Math.floor(process.uptime()),
  };
}
