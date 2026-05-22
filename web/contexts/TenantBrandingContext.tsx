'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { getSession } from '@/lib/session';

export interface TenantBranding {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
}

const DEFAULT_BRANDING: TenantBranding = {
  name: 'Menti-Mentor',
  logoUrl: null,
  primaryColor: '#6366f1',
};

const TenantBrandingContext = createContext<TenantBranding>(DEFAULT_BRANDING);

export function TenantBrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<TenantBranding>(DEFAULT_BRANDING);

  useEffect(() => {
    const session = getSession();
    if (!session) return;

    const resolved: TenantBranding = {
      name: session.tenantName ?? DEFAULT_BRANDING.name,
      logoUrl: session.tenantLogoUrl ?? null,
      primaryColor: session.tenantPrimaryColor ?? DEFAULT_BRANDING.primaryColor,
    };
    setBranding(resolved);

    // CSS değişkeni olarak birincil rengi uygula
    document.documentElement.style.setProperty('--brand-primary', resolved.primaryColor);
  }, []);

  return (
    <TenantBrandingContext.Provider value={branding}>
      {children}
    </TenantBrandingContext.Provider>
  );
}

export function useTenantBranding(): TenantBranding {
  return useContext(TenantBrandingContext);
}
