'use client';

import { useSession } from '@/hooks/useSession';
import { useMeetings } from '@/hooks/useMeetings';
import { useCandidates, useSetVisibilityOptIn } from '@/hooks/useCandidates';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useUserClubs } from '@/hooks/useClubs';
import { useTenantBranding } from '@/contexts/TenantBrandingContext';
import { DiscBadge, DiscVectorBars } from '@/components/ui/DiscBadge';
import { ProgressGauge } from '@/components/ui/ProgressGauge';
import { OrientationBadge } from '@/components/profile/OrientationBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { DiscType } from '@/types/api';

// ─── Bento hücre sarmalayıcısı ──────────────────────────────────────────────
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

export default function MentorDashboard() {
  const { session, loading } = useSession('MENTOR');
  const branding = useTenantBranding();
  const { data: candidates, isLoading: loadingCandidates } = useCandidates(session?.userId ?? '');
  const { data: meetings } = useMeetings({ mentorId: session?.userId });
  const { data: analytics } = useAnalytics(session?.userId ?? '');
  const { data: clubs } = useUserClubs(session?.userId ?? '');
  const optIn = useSetVisibilityOptIn(session?.userId ?? '');

  if (loading) {
    return (
      <div className="grid grid-cols-12 gap-3 p-1">
        {[...Array(8)].map((_, i) => <Skeleton key={i} className={`h-36 rounded-2xl ${i < 2 ? 'col-span-6' : 'col-span-3'}`} />)}
      </div>
    );
  }
  if (!session) return null;

  const pendingMeetings = meetings?.items.filter((m) => m.status === 'PENDING') ?? [];
  const completedMeetings = meetings?.items.filter((m) => m.status === 'COMPLETED') ?? [];
  const discVector = analytics?.discVector ?? null;
  const topCandidates = candidates?.slice(0, 6) ?? [];

  return (
    <div className="grid grid-cols-12 gap-3 auto-rows-min">

      {/* ── HERO: Profil Kartı (col 5, row 2) ─────────────────────────── */}
      <BentoCard className="col-span-12 md:col-span-5 row-span-2 p-5 flex flex-col justify-between min-h-52">
        <div className="space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: branding.primaryColor }}>
                MENTOR
              </p>
              <h2 className="text-xl font-bold text-slate-900 mt-0.5 leading-tight">{session.fullName}</h2>
            </div>
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg font-black"
              style={{ backgroundColor: branding.primaryColor }}
            >
              {session.fullName.charAt(0)}
            </div>
          </div>

          {(session as { discType?: DiscType }).discType && (
            <DiscBadge discType={(session as { discType?: DiscType }).discType!} size="lg" />
          )}

          {discVector && (
            <div className="mt-2">
              <p className="text-[10px] text-slate-400 mb-1.5 uppercase tracking-wider">DISC Vektörü</p>
              <DiscVectorBars vector={discVector} height={32} />
              <p className="text-[10px] text-slate-400 mt-1">
                Güven: {Math.round((discVector.confidence ?? 0) * 100)}%
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-400">{branding.name}</p>
          <p className="text-xs text-slate-300 font-mono">{session.userId.slice(0, 18)}…</p>
        </div>
      </BentoCard>

      {/* ── STAT: Bekleyen Toplantılar ───────────────────────────────── */}
      <BentoCard className="col-span-6 md:col-span-3 p-4" label="BEKLEYEN">
        <div className="mt-5 text-center">
          <p className="text-4xl font-black text-amber-500">{pendingMeetings.length}</p>
          <p className="text-xs text-slate-500 mt-1">Toplantı talebi</p>
          {pendingMeetings.length > 0 && (
            <a
              href="/dashboard/mentor/meetings"
              className="mt-2 inline-block text-[10px] font-medium text-amber-600 hover:underline"
            >
              Görüntüle →
            </a>
          )}
        </div>
      </BentoCard>

      {/* ── STAT: Tamamlanan Toplantılar ─────────────────────────────── */}
      <BentoCard className="col-span-6 md:col-span-4 p-4" label="TAMAMLANAN">
        <div className="mt-5 text-center">
          <p className="text-4xl font-black text-emerald-500">{completedMeetings.length}</p>
          <p className="text-xs text-slate-500 mt-1">Toplantı</p>
        </div>
      </BentoCard>

      {/* ── STAT: Aday Mentiler ──────────────────────────────────────── */}
      <BentoCard className="col-span-6 md:col-span-3 p-4" label="ADAYLAR">
        <div className="mt-5 text-center">
          <p className="text-4xl font-black" style={{ color: branding.primaryColor }}>
            {loadingCandidates ? '…' : (candidates?.length ?? 0)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Uyumlu menti</p>
        </div>
      </BentoCard>

      {/* ── ANALYTICS: Dominant Tip Gauge ───────────────────────────── */}
      <BentoCard className="col-span-6 md:col-span-4 p-4 flex flex-col items-center justify-center" label="ANALİTİK SKOR">
        {analytics ? (
          <>
            <ProgressGauge
              value={Math.round((analytics.discVector?.confidence ?? 0) * 100)}
              label="güven"
              color={branding.primaryColor}
              size="md"
              className="mt-4"
            />
            <p className="text-xs text-slate-500 mt-1">
              Dominant: <span className="font-bold">{analytics.dominantType}</span>
            </p>
          </>
        ) : (
          <p className="text-xs text-slate-400 mt-6">Analitik yok</p>
        )}
      </BentoCard>

      {/* ── KULÜPLER ────────────────────────────────────────────────── */}
      <BentoCard className="col-span-12 md:col-span-5 p-4" label="KULÜPLERİM">
        <div className="mt-4 space-y-1.5">
          {(clubs?.items ?? []).slice(0, 3).map((m) => (
            <div key={m.id} className="flex items-center justify-between">
              <span className="text-sm text-slate-700 truncate">{m.club?.name}</span>
              <Badge variant="outline" className="text-[10px] shrink-0">{m.role}</Badge>
            </div>
          ))}
          {(clubs?.total ?? 0) === 0 && (
            <p className="text-xs text-slate-400">Henüz kulüp üyeliği yok</p>
          )}
        </div>
      </BentoCard>

      {/* ── ADAY MENTİLER: Tam Genişlik Liste ───────────────────────── */}
      <div className="col-span-12">
        <h2 className="text-sm font-semibold text-slate-700 mb-2 px-1">Aday Mentiler</h2>
        {loadingCandidates ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}
          </div>
        ) : topCandidates.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {topCandidates.map((menti) => {
              const scoreColor = menti.score >= 80 ? '#10b981' : menti.score >= 60 ? '#f59e0b' : '#ef4444';
              return (
                <BentoCard key={menti.id} className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{menti.fullName}</p>
                      <p className="text-xs text-slate-400 truncate">{menti.email}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-2xl font-black" style={{ color: scoreColor }}>{menti.score}</p>
                      <p className="text-[10px] text-slate-400">uyum</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {menti.discType && <DiscBadge discType={menti.discType} size="sm" />}
                    {menti.needsOrientation && <OrientationBadge active compact />}

                    {menti.bioSummary && (
                      <p className="text-xs text-slate-500 line-clamp-2">{menti.bioSummary}</p>
                    )}

                    {menti.sectorTags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {menti.sectorTags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                        ))}
                      </div>
                    )}

                    {menti.iceBreaker ? (
                      <div className="rounded-lg bg-blue-50 border border-blue-100 p-2">
                        <p className="text-[11px] text-blue-700 italic line-clamp-2">💬 {menti.iceBreaker}</p>
                      </div>
                    ) : (
                      <button
                        className="w-full text-xs border border-dashed rounded-lg py-1.5 text-slate-400 hover:bg-slate-50 transition-colors disabled:opacity-40"
                        onClick={() => optIn.mutate({ mentiId: menti.id, status: 'APPROVED' })}
                        disabled={optIn.isPending || menti.needsOrientation}
                      >
                        {optIn.isPending ? '…' : '+ Görünürlük Opt-in'}
                      </button>
                    )}
                  </div>
                </BentoCard>
              );
            })}
          </div>
        ) : (
          <BentoCard className="p-8 text-center text-slate-400 text-sm col-span-12">
            Şu an uyumlu aday bulunamadı.
          </BentoCard>
        )}
      </div>

    </div>
  );
}
