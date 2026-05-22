import type { UserRole } from '@/types/api';

export interface Session {
  userId: string;
  tenantId: string;
  role: UserRole;
  fullName: string;
  accessToken: string;
  // Tenant branding (login sırasında backend'den alınır)
  tenantName?: string;
  tenantLogoUrl?: string | null;
  tenantPrimaryColor?: string | null;
}

const SESSION_KEY = 'genc_session';

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  // Cookie'ler middleware routing için (JWT ile auth yapılıyor, cookie sadece yönlendirme için)
  document.cookie = `role=${session.role}; path=/; max-age=86400`;
  document.cookie = `tenantId=${session.tenantId}; path=/; max-age=86400`;
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  document.cookie = 'role=; path=/; max-age=0';
  document.cookie = 'tenantId=; path=/; max-age=0';
}
