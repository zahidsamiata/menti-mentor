'use client';

import { useSession } from '@/hooks/useSession';
import { useUsers, useClearOrientationLock } from '@/hooks/useUsers';
import { useMeetings } from '@/hooks/useMeetings';
import { useClubs } from '@/hooks/useClubs';
import { useTenantBranding } from '@/contexts/TenantBrandingContext';
import { DiscBadge } from '@/components/ui/DiscBadge';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { DiscType } from '@/types/api';

function BentoCard({
  children,
  className = '',
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div className={`relative bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden ${className}`}>
      {label && (
        <div className="absolute top-3 left-3 z-10">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
        </div>
      )}
      {children}
    </div>
  );
}

const DISC_COLORS: Record<string, string> = {
  D: '#ef4444',
  I: '#f59e0b',
  S: '#10b981',
  C: '#3b82f6',
};

const CLUB_TYPE_LABELS: Record<string, string> = {
  AKADEMIK: 'Akademik',
  SOSYAL: 'Sosyal',
  SPOR: 'Spor',
  SANAT: 'Sanat',
  TEKNOLOJI: 'Teknoloji',
  DIGER: 'Diğer',
};

export default function AdminDashboard() {
  const { session, loading, logout } = useSession('ADMIN');
  const branding = useTenantBranding();
  const { data: allUsers } = useUsers();
  const { data: mentors } = useUsers('MENTOR');
  const { data: mentis } = useUsers('MENTI');
  const { data: activeMeetings } = useMeetings({ status: 'APPROVED' });
  const { data: pendingMeetings } = useMeetings({ status: 'PENDING' });
  const { data: pendingFeedback } = useMeetings({ pendingFeedback: true });
  const { data: clubs } = useClubs();
  const clearLock = useClearOrientationLock();

  if (loading) {
    return (
      <div className="grid grid-cols-12 gap-3">
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} className={`h-36 rounded-2xl ${i < 2 ? 'col-span-6' : 'col-span-3'}`} />
        ))}
      </div>
    );
  }
  if (!session) return null;

  const totalUsers = allUsers?.total ?? 0;
  const lockedMentis = (mentis?.items ?? []).filter((u) => u.needsOrientation);
  const activeClubs = (clubs?.items ?? []).filter((c) => c.isActive);

  // DISC dağılımı
  const discCounts: Record<string, number> = { D: 0, I: 0, S: 0, C: 0 };
  for (const user of allUsers?.items ?? []) {
    if (user.discType) discCounts[user.discType] = (discCounts[user.discType] ?? 0) + 1;
  }
  const discTotal = Object.values(discCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="grid grid-cols-12 gap-3 auto-rows-min">

      {/* ── HERO: Kuruluş Kartı ───────────────────────────────────────────── */}
      <BentoCard className="col-span-12 md:col-span-5 row-span-2 p-5 flex flex-col justify-between min-h-52">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: branding.primaryColor }}>
                YÖNETİCİ
              </p>
              <h2 className="text-xl font-bold text-slate-900 mt-0.5 leading-tight">{session.fullName}</h2>
              <p className="text-xs text-slate-400 mt-0.5 truncate">{branding.name}</p>
            </div>
            {branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt={branding.name}
                className="w-10 h-10 rounded-xl object-cover shrink-0"
              />
            ) : (
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg font-black shrink-0"
                style={{ backgroundColor: branding.primaryColor }}
              >
                {branding.name.charAt(0)}
              </div>
            )}
          </div>

          {/* Kullanıcı dağılımı */}
          <div className="grid grid-cols-3 gap-2 mt-2">
            {[
              { label: 'Mentor', value: mentors?.total ?? 0, color: '#6366f1' },
              { label: 'Menti', value: mentis?.total ?? 0, color: '#10b981' },
              { label: 'Yönetici', value: allUsers?.items.filter((u) => u.role === 'ADMIN').length ?? 0, color: '#f59e0b' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-slate-50 rounded-xl p-2 text-center">
                <p className="text-lg font-black" style={{ color }}>{value}</p>
                <p className="text-[10px] text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-400">Toplam: {totalUsers} kullanıcı</p>
          <button
            onClick={logout}
            className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
          >
            Çıkış →
          </button>
        </div>
      </BentoCard>

      {/* ── STAT: Aktif Toplantılar ───────────────────────────────────────── */}
      <BentoCard className="col-span-6 md:col-span-3 p-4" label="AKTİF">
        <div className="mt-5 text-center">
          <p className="text-4xl font-black text-emerald-500">{activeMeetings?.total ?? 0}</p>
          <p className="text-xs text-slate-500 mt-1">Devam eden toplantı</p>
        </div>
      </BentoCard>

      {/* ── STAT: Bekleyen Talepler ───────────────────────────────────────── */}
      <BentoCard className="col-span-6 md:col-span-4 p-4" label="BEKLEYEN">
        <div className="mt-5 text-center">
          <p className="text-4xl font-black text-amber-500">{pendingMeetings?.total ?? 0}</p>
          <p className="text-xs text-slate-500 mt-1">Onay bekleyen</p>
          {(pendingMeetings?.total ?? 0) > 0 && (
            <a href="/dashboard/admin/users" className="mt-1.5 inline-block text-[10px] text-amber-600 hover:underline">
              İncele →
            </a>
          )}
        </div>
      </BentoCard>

      {/* ── STAT: Geri Bildirim ───────────────────────────────────────────── */}
      <BentoCard className="col-span-6 md:col-span-3 p-4" label="GERİ BİLDİRİM">
        <div className="mt-5 text-center">
          <p className="text-4xl font-black" style={{ color: branding.primaryColor }}>
            {pendingFeedback?.total ?? 0}
          </p>
          <p className="text-xs text-slate-500 mt-1">Değerlendirme bekliyor</p>
        </div>
      </BentoCard>

      {/* ── DISC Dağılımı ─────────────────────────────────────────────────── */}
      <BentoCard className="col-span-12 md:col-span-4 p-4" label="DISC DAĞILIMI">
        <div className="mt-5 space-y-2">
          {discTotal === 0 ? (
            <p className="text-xs text-slate-400">Henüz DISC verisi yok</p>
          ) : (
            Object.entries(discCounts).map(([type, count]) => {
              const pct = discTotal > 0 ? Math.round((count / discTotal) * 100) : 0;
              return (
                <div key={type} className="flex items-center gap-2">
                  <span className="text-xs font-bold w-4 shrink-0" style={{ color: DISC_COLORS[type] }}>
                    {type}
                  </span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: DISC_COLORS[type] }}
                    />
                  </div>
                  <span className="text-xs text-slate-400 w-8 text-right">{count}</span>
                </div>
              );
            })
          )}
        </div>
      </BentoCard>

      {/* ── Kilitli Mentiler ──────────────────────────────────────────────── */}
      <BentoCard className="col-span-12 md:col-span-5 p-4" label="ORİYANTASYON BEKLEYENLERİ">
        <div className="mt-5 space-y-1.5">
          {lockedMentis.length === 0 ? (
            <p className="text-xs text-slate-400">Kilitli menti yok ✓</p>
          ) : (
            lockedMentis.slice(0, 5).map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-700 truncate">{u.fullName}</p>
                  <p className="text-[10px] text-slate-400 truncate">{u.email}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {u.discType && <DiscBadge discType={u.discType as DiscType} size="xs" />}
                  <button
                    className="text-[10px] text-indigo-500 hover:underline disabled:opacity-40"
                    onClick={() => clearLock.mutate(u.id)}
                    disabled={clearLock.isPending}
                  >
                    Kilidi Kaldır
                  </button>
                </div>
              </div>
            ))
          )}
          {lockedMentis.length > 5 && (
            <p className="text-[10px] text-slate-400">+{lockedMentis.length - 5} daha</p>
          )}
        </div>
      </BentoCard>

      {/* ── Topluluklar ───────────────────────────────────────────────────── */}
      <BentoCard className="col-span-12 md:col-span-7 p-4" label="TOPLULUKLAR & STK'LAR">
        <div className="mt-5 grid grid-cols-2 gap-2">
          {activeClubs.slice(0, 6).map((club) => (
            <div
              key={club.id}
              className="bg-slate-50 rounded-xl px-3 py-2 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-700 truncate">{club.name}</p>
                <p className="text-[10px] text-slate-400">{CLUB_TYPE_LABELS[club.type] ?? club.type}</p>
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0">
                {club.isActive ? 'Aktif' : 'Pasif'}
              </Badge>
            </div>
          ))}
          {activeClubs.length === 0 && (
            <div className="col-span-2 text-xs text-slate-400">Henüz kulüp yok</div>
          )}
        </div>
        {activeClubs.length > 0 && (
          <a href="/dashboard/admin/clubs" className="block mt-3 text-[10px] text-indigo-500 hover:underline">
            Tüm toplulukları yönet →
          </a>
        )}
      </BentoCard>

      {/* ── Hızlı Erişim ─────────────────────────────────────────────────── */}
      <BentoCard className="col-span-12 p-4">
        <div className="flex flex-wrap gap-2">
          {[
            { href: '/dashboard/admin/users', label: '👥 Kullanıcıları Yönet' },
            { href: '/dashboard/admin/clubs', label: '🏛️ Topluluk Yönetimi' },
            { href: '/dashboard/admin/logs', label: '📋 Sistem Logları' },
            { href: '/dashboard/analytics', label: '📊 Analitikler' },
          ].map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-100 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            >
              {label}
            </a>
          ))}
        </div>
      </BentoCard>

    </div>
  );
}
