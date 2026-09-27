import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';

/**
 * Onay kapısı (U-08, AJ-20) — yöneticisi olmayan çağıran bu kurumda APPROVED değilse
 * eşleşme/sıralama verisi dönmez. Komşu uç userController.listUsers ile aynı kural ve aynı
 * yanıt (403 ONAY_BEKLENIYOR). Eşleşme verisi veren her uç (matchingController aday/öneri
 * listeleri, POST /api/scoring/rank-mentors) bu TEK yardımcıyı kullanır — kural bir yerde.
 * true dönerse yanıt yazılmıştır, çağıran return etmeli.
 */
export async function rejectIfCallerNotApproved(req: RequestWithTenant, res: Response): Promise<boolean> {
  if (!req.auth || req.auth.role === 'ADMIN') return false;
  const caller = await prisma.user.findFirst({
    where:  { id: req.auth.userId, tenantId: req.tenant.tenantId },
    select: { approvalStatus: true },
  });
  if (caller?.approvalStatus === 'APPROVED') return false;
  res.status(403).json({
    error: 'ONAY_BEKLENIYOR',
    message: 'Eşleşme önerilerini görmek için yönetici onayı gerekli.',
  });
  return true;
}
