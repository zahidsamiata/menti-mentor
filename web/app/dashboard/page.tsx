'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSession } from '@/lib/session';

export default function DashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    const s = getSession();
    if (!s) { router.replace('/login'); return; }
    if (s.role === 'ADMIN') router.replace('/dashboard/admin');
    else if (s.role === 'MENTOR') router.replace('/dashboard/mentor');
    else router.replace('/dashboard/menti');
  }, [router]);
  return null;
}
