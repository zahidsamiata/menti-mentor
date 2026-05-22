'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { Toaster } from '@/components/ui/sonner';
import { TenantBrandingProvider } from '@/contexts/TenantBrandingContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TenantBrandingProvider>
        {children}
        <Toaster richColors position="top-right" />
      </TenantBrandingProvider>
    </QueryClientProvider>
  );
}
