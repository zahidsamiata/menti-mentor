'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSession, clearSession, type Session } from '@/lib/session';

export function useSession(requiredRole?: 'ADMIN' | 'MENTOR' | 'MENTI') {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const s = getSession();
    setSession(s);
    setLoading(false);

    if (!s) {
      router.replace('/login');
      return;
    }
    if (requiredRole && s.role !== requiredRole && s.role !== 'ADMIN') {
      router.replace('/dashboard');
    }
  }, [router, requiredRole]);

  function logout() {
    clearSession();
    router.replace('/login');
  }

  return { session, loading, logout };
}
