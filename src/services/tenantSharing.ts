import { prisma } from '../db.js';

// Kural (Rule 1):
// Cross-tenant erişim sadece iki tenant da shared pool açıksa mümkün.
export async function canCrossTenantMatch(args: { requesterTenantId: string; targetTenantId: string }) {
  if (args.requesterTenantId === args.targetTenantId) return true;

  const [a, b] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: args.requesterTenantId }, select: { isSharedPoolActive: true } }),
    prisma.tenant.findUnique({ where: { id: args.targetTenantId }, select: { isSharedPoolActive: true } }),
  ]);

  return Boolean(a?.isSharedPoolActive && b?.isSharedPoolActive);
}

