import type { Request } from 'express';
import { logger } from './logger.js';

/**
 * Platform admin denetim izi (KVKK Md.12) — tek yeniden kullanılabilir yardımcı.
 *
 * Platform admin sistem sahibidir ve tüm kurum/kullanıcı verisine inebilir; "kim, ne zaman,
 * neye baktı / ne yaptı" izlenebilir olmalı. Kayıt mevcut `SystemLog` tablosuna AUDIT
 * kategorisiyle yazılır (ayrı tablo/migration gerekmez — nudge/erişim loglaması ile aynı desen).
 *
 * ⚠️ HASSAS VERİ YAZMA: Yalnızca "ne yapıldı" loglanır — action + hedef ID(ler) + IP.
 *   DISC/PII değerleri (discVector, e-posta, isim, skor) ASLA log meta'sına konmaz.
 *   Örn: "admin, kurum X'in üyelerine baktı" ✅ · "üye Y'nin DISC skoru Z'ydi" ❌.
 *
 * NON-FATAL: `logger` DB yazım hatasını kendi içinde yutar; denetim kaydı ana akışı bozmaz.
 */

const PLATFORM_ACTOR = 'platform-admin';

export async function auditPlatformAction(
  action: string,
  req: Request,
  extra?: {
    targetType?: string;
    targetId?: string;
    targetTenantId?: string;
    [key: string]: unknown;
  },
): Promise<void> {
  await logger.info('AUDIT', action, {
    actorId: PLATFORM_ACTOR,
    action,
    ip: req.ip ?? 'unknown',
    ...extra,
  });
}
