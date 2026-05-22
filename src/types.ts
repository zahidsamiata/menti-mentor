import type { Request } from 'express';

export type TenantContext = {
  tenantId: string;
};

// Kimlik doğrulaması başarılı olan kullanıcının oturum bilgisi.
// tenant.ts middleware'i tarafından req.auth'a yazılır.
export type AuthContext = {
  userId: string;
  role: 'ADMIN' | 'MENTOR' | 'MENTI';
  fullName: string;
} | null;

export type RequestWithTenant = Request & {
  tenant: TenantContext;
  // X-User-Id header'ı yoksa veya kullanıcı geçersizse null kalır.
  auth: AuthContext;
};

