'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useSession } from '@/hooks/useSession';
import { useTenantBranding } from '@/contexts/TenantBrandingContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { DiscBadge } from '@/components/ui/DiscBadge';
import type { DiscType } from '@/types/api';

const adminLinks = [
  { href: '/dashboard/admin', label: '🏠 Genel Bakış' },
  { href: '/dashboard/admin/users', label: '👥 Kullanıcılar' },
  { href: '/dashboard/admin/clubs', label: '🏛️ Kulüpler' },
  { href: '/dashboard/admin/logs', label: '📋 Sistem Logları' },
];

const mentorLinks = [
  { href: '/dashboard/mentor', label: '🏠 Genel Bakış' },
  { href: '/dashboard/mentor/candidates', label: '🔍 Aday Mentiler' },
  { href: '/dashboard/mentor/meetings', label: '📅 Toplantılarım' },
  { href: '/dashboard/analytics', label: '📊 Mizaç Analizi' },
  { href: '/dashboard/analytics/ideal', label: '🤝 İdeal Persona' },
  { href: '/dashboard/analytics/friction', label: '⚡ Çatışma Analizi' },
  { href: '/dashboard/profile', label: '⚙️ Profil Yönetimi' },
];

const mentiLinks = [
  { href: '/dashboard/menti', label: '🏠 Genel Bakış' },
  { href: '/dashboard/menti/meetings', label: '📅 Toplantılarım' },
  { href: '/dashboard/analytics', label: '📊 Mizaç Analizi' },
  { href: '/dashboard/analytics/ideal', label: '🤝 İdeal Persona' },
  { href: '/dashboard/analytics/friction', label: '⚡ Çatışma Analizi' },
  { href: '/dashboard/profile', label: '⚙️ Profil Yönetimi' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { session, logout } = useSession();
  const branding = useTenantBranding();

  if (!session) return null;

  const links =
    session.role === 'ADMIN' ? adminLinks
    : session.role === 'MENTOR' ? mentorLinks
    : mentiLinks;

  return (
    <aside className="w-60 shrink-0 border-r bg-slate-50 flex flex-col h-full">
      {/* Tenant Branding Header */}
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          {branding.logoUrl ? (
            <Image
              src={branding.logoUrl}
              alt={branding.name}
              width={32}
              height={32}
              className="rounded-lg object-contain"
            />
          ) : (
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0"
              style={{ backgroundColor: branding.primaryColor }}
            >
              {branding.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-700 truncate leading-tight">{branding.name}</p>
            <p className="text-[10px] text-slate-400">Mentor Ekosistemi</p>
          </div>
        </div>

        <Separator />

        {/* Kullanıcı bilgisi */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600 shrink-0">
            {session.fullName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-700 truncate">{session.fullName}</p>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-slate-400">{session.role}</span>
              {(session as { discType?: DiscType }).discType && (
                <DiscBadge
                  discType={(session as { discType?: DiscType }).discType!}
                  size="xs"
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <Separator />

      {/* Navigasyon */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {links.map((link) => (
          <Link key={link.href} href={link.href}>
            <span
              className={cn(
                'block rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                pathname === link.href
                  ? 'text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-200',
              )}
              style={pathname === link.href ? { backgroundColor: branding.primaryColor } : undefined}
            >
              {link.label}
            </span>
          </Link>
        ))}
      </nav>

      <Separator />
      <div className="p-3">
        <Button variant="outline" size="sm" className="w-full text-xs" onClick={logout}>
          Çıkış Yap
        </Button>
      </div>
    </aside>
  );
}
