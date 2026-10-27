/**
 * U-13C (KARAR-83 C) — rol tarihçesi: önceki ve yeni rol, tarih, değiştiren yönetici.
 *
 * Yazım NON-FATAL: rol değişikliği asıl işlemdir; tarihçe satırı yazılamazsa rol değişikliği geri
 * alınmaz, yalnız kayıt defterine not düşülür (ensureMembershipSafe ile aynı yaklaşım).
 */
import type { UserRole } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from './logger.js';

export async function recordRoleChange(args: {
  tenantId: string;
  userId: string;
  previousRole: UserRole;
  newRole: UserRole;
  changedById: string | undefined;
}): Promise<void> {
  if (args.previousRole === args.newRole) return;
  try {
    await prisma.roleChange.create({
      data: {
        tenantId:     args.tenantId,
        userId:       args.userId,
        previousRole: args.previousRole,
        newRole:      args.newRole,
        changedById:  args.changedById ?? null,
      },
    });
  } catch (err) {
    void logger.warn('AUTH', 'Rol tarihçesi yazılamadı (rol değişikliği geçerli)', {
      tenantId: args.tenantId,
      targetId: args.userId,
      error:    err instanceof Error ? err.message : String(err),
    });
  }
}

/** Tarihçe listesinde gösterilen en çok kayıt. */
export const ROLE_HISTORY_LIMIT = 50;
