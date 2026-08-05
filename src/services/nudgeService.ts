/**
 * Yönetici "dürtme" (nudge) servisi — pasif üye / hareketsiz eşleşmeye elle hatırlatma.
 *
 * TASARIM:
 *  - Kötüye kullanım koruması: aynı hedefe COOLDOWN içinde tek dürtme (spam engeli).
 *  - Denetim izi: her dürtme SystemLog'a (AUDIT) yazılır — kim, kimi, ne zaman, ne tür.
 *    Ayrı model/migration yerine mevcut SystemLog kullanılır (spam-limit sorgusu da buradan).
 *  - Mevcut e-posta altyapısı (emailService.send) kullanılır; yeni sağlayıcı kurulmaz.
 *
 * NOT (otomatik dürtme): Pasif üyelere OTOMATİK toplu e-posta göndermek, gerçek kullanıcılara
 * istenmeden re-engagement maili demektir (KVKK/rıza ağırlığı) → bu tur SADECE elle dürtme
 * uygulanır. Otomatik dürtme, rıza/opt-out tasarımıyla ayrı bir iş olarak bırakıldı (bkz. rapor).
 */

import { prisma } from '../db.js';
import { logger } from './logger.js';
import { sendNudgeReminderEmail } from './emailService.js';

export const NUDGE_COOLDOWN_HOURS = 24;
const NUDGE_LOG_MESSAGE = 'NUDGE_SENT';

/** Bu hedefe COOLDOWN içinde daha önce dürtme yapıldı mı? (spam limiti — SystemLog'dan) */
export async function wasRecentlyNudged(tenantId: string, targetUserId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - NUDGE_COOLDOWN_HOURS * 60 * 60 * 1000);
  const existing = await prisma.systemLog.findFirst({
    where: {
      category: 'AUDIT',
      message: NUDGE_LOG_MESSAGE,
      createdAt: { gt: cutoff },
      meta: { path: ['targetUserId'], equals: targetUserId },
      // tenantId de meta'da tutulur; targetUserId zaten tenant'a özgü olduğundan tek filtre yeterli.
    },
    select: { id: true },
  });
  return existing !== null;
}

/** Dürtme e-postasını gönderir ve denetim kaydını yazar. */
export async function sendNudge(args: {
  tenantId: string;
  targetUserId: string;
  targetEmail: string;
  targetName: string;
  byUserId: string;
  tenantName: string;
  kind: 'PASSIVE' | 'DEAD_MATCH' | 'GENERIC';
  message?: string;
}): Promise<void> {
  await sendNudgeReminderEmail({
    toEmail: args.targetEmail,
    recipientName: args.targetName,
    tenantName: args.tenantName,
    message: args.message,
  });

  // Denetim izi + spam-limit kaynağı. KVKK: e-posta/isim loglanmaz, yalnızca ID'ler.
  await logger.info('AUDIT', NUDGE_LOG_MESSAGE, {
    tenantId: args.tenantId,
    targetUserId: args.targetUserId,
    byUserId: args.byUserId,
    kind: args.kind,
  });
}
