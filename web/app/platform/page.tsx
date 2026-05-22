'use client';

import { usePlatformStats, usePlatformHealth } from '@/hooks/usePlatform';
import { Skeleton } from '@/components/ui/skeleton';

function DarkCard({
  children,
  className = '',
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div className={`relative bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden ${className}`}>
      {label && (
        <div className="absolute top-3 left-3 z-10">
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
        </div>
      )}
      {children}
    </div>
  );
}

const LOG_COLORS: Record<string, string> = {
  INFO: 'text-blue-400',
  WARN: 'text-amber-400',
  ERROR: 'text-red-400',
};

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}s ${m}d`;
}

export default function PlatformOverview() {
  const { data: stats, isLoading } = usePlatformStats();
  const { data: health } = usePlatformHealth();

  if (isLoading) {
    return (
      <div className="grid grid-cols-12 gap-3">
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} className={`h-32 rounded-2xl bg-slate-800 ${i < 4 ? 'col-span-3' : 'col-span-6'}`} />
        ))}
      </div>
    );
  }

  const t = stats?.totals;

  return (
    <div className="grid grid-cols-12 gap-3 auto-rows-min">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="col-span-12 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Genel Bakış</h1>
          <p className="text-slate-500 text-xs">{new Date().toLocaleString('tr-TR')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full animate-pulse ${
              health?.status === 'ok' ? 'bg-emerald-400' : 'bg-red-500'
            }`}
          />
          <span className="text-xs text-slate-400">
            {health?.status === 'ok' ? 'Sistem normal' : 'Sistem hatası'}
          </span>
        </div>
      </div>

      {/* ── Stat: Tenants ─────────────────────────────────────────────────── */}
      <DarkCard className="col-span-6 md:col-span-3 p-4" label="TENANT">
        <div className="mt-5 text-center">
          <p className="text-4xl font-black text-white">{t?.tenants ?? '—'}</p>
          <p className="text-xs text-slate-400 mt-1">Kayıtlı kuruluş</p>
        </div>
      </DarkCard>

      {/* ── Stat: Users ───────────────────────────────────────────────────── */}
      <DarkCard className="col-span-6 md:col-span-3 p-4" label="KULLANICI">
        <div className="mt-5 text-center">
          <p className="text-4xl font-black text-indigo-400">{t?.users ?? '—'}</p>
          <div className="flex justify-center gap-3 mt-1">
            <span className="text-[10px] text-slate-400">Mentor: {t?.mentors ?? 0}</span>
            <span className="text-[10px] text-slate-400">Menti: {t?.mentis ?? 0}</span>
          </div>
        </div>
      </DarkCard>

      {/* ── Stat: Meetings ────────────────────────────────────────────────── */}
      <DarkCard className="col-span-6 md:col-span-3 p-4" label="TOPLANTI">
        <div className="mt-5 text-center">
          <p className="text-4xl font-black text-emerald-400">{t?.meetings ?? '—'}</p>
          <div className="flex justify-center gap-3 mt-1">
            <span className="text-[10px] text-amber-400">⏳ {t?.pendingMeetings ?? 0}</span>
            <span className="text-[10px] text-emerald-400">✓ {t?.completedMeetings ?? 0}</span>
          </div>
        </div>
      </DarkCard>

      {/* ── Stat: System Health ───────────────────────────────────────────── */}
      <DarkCard className="col-span-6 md:col-span-3 p-4" label="SYSTEM">
        <div className="mt-5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">DB</span>
            <span className={`text-xs font-semibold ${health?.db === 'connected' ? 'text-emerald-400' : 'text-red-400'}`}>
              {health?.db === 'connected' ? '● bağlı' : '● kopuk'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Uptime</span>
            <span className="text-xs text-slate-300">{health ? formatUptime(health.uptime) : '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">RAM</span>
            <span className="text-xs text-slate-300">{health ? `${health.memory.heapUsed} MB` : '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Node</span>
            <span className="text-xs text-slate-300">{health?.nodeVersion ?? '—'}</span>
          </div>
        </div>
      </DarkCard>

      {/* ── Tenants Grid ──────────────────────────────────────────────────── */}
      <div className="col-span-12">
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-sm font-semibold text-slate-300">Kuruluşlar</h2>
          <a href="/platform/tenants" className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors">
            Tümünü yönet →
          </a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {(stats?.tenants ?? []).map((tenant) => (
            <DarkCard key={tenant.id} className="p-4">
              <div className="flex items-start gap-3">
                {tenant.logoUrl ? (
                  <img
                    src={tenant.logoUrl}
                    alt={tenant.name}
                    className="w-10 h-10 rounded-xl object-cover shrink-0"
                  />
                ) : (
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-sm shrink-0"
                    style={{ backgroundColor: tenant.primaryColor ?? '#6366f1' }}
                  >
                    {(tenant.displayName ?? tenant.name).charAt(0)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-semibold truncate">
                    {tenant.displayName ?? tenant.name}
                  </p>
                  <p className="text-slate-500 text-xs font-mono">{tenant.slug}</p>
                  <div className="flex flex-wrap gap-3 mt-1.5">
                    <span className="text-[10px] text-slate-400">{tenant._count.users} kullanıcı</span>
                    <span className="text-[10px] text-slate-400">{tenant._count.meetings} toplantı</span>
                    {tenant.isSharedPoolActive && (
                      <span className="text-[10px] text-indigo-400">Paylaşımlı havuz</span>
                    )}
                  </div>
                </div>
              </div>
            </DarkCard>
          ))}
          {(stats?.tenants ?? []).length === 0 && (
            <DarkCard className="p-8 text-center col-span-3">
              <p className="text-slate-500 text-sm">Henüz kuruluş yok</p>
            </DarkCard>
          )}
        </div>
      </div>

      {/* ── Recent Logs ───────────────────────────────────────────────────── */}
      <div className="col-span-12">
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-sm font-semibold text-slate-300">Son Loglar</h2>
          <a href="/platform/logs" className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors">
            Tümü →
          </a>
        </div>
        <DarkCard>
          <div className="divide-y divide-slate-700/40">
            {(stats?.recentLogs ?? []).map((log) => (
              <div key={log.id} className="px-4 py-2.5 flex items-center gap-3">
                <span className={`text-[10px] font-bold w-10 shrink-0 ${LOG_COLORS[log.level] ?? 'text-slate-400'}`}>
                  {log.level}
                </span>
                <span className="text-[10px] text-slate-500 w-20 shrink-0 truncate">{log.category}</span>
                <span className="text-xs text-slate-300 truncate flex-1">{log.message}</span>
                <span className="text-[10px] text-slate-600 shrink-0">
                  {new Date(log.createdAt).toLocaleTimeString('tr-TR')}
                </span>
              </div>
            ))}
            {(stats?.recentLogs ?? []).length === 0 && (
              <div className="px-4 py-5 text-center text-slate-500 text-xs">Log bulunamadı</div>
            )}
          </div>
        </DarkCard>
      </div>

    </div>
  );
}
