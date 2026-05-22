'use client';

import { useState } from 'react';
import { useSession } from '@/hooks/useSession';
import { useUser } from '@/hooks/useUsers';
import { useMeetings, useCreateMeeting } from '@/hooks/useMeetings';
import { useUserClubs } from '@/hooks/useClubs';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useTenantBranding } from '@/contexts/TenantBrandingContext';
import { DiscBadge, DiscVectorBars } from '@/components/ui/DiscBadge';
import { ProgressGauge, ProgressBar } from '@/components/ui/ProgressGauge';
import { OrientationBadge } from '@/components/profile/OrientationBadge';
import { MeetingTimeline } from '@/components/meeting/MeetingTimeline';
import { FeedbackForm } from '@/components/feedback/FeedbackForm';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { Meeting, DiscType } from '@/types/api';

const EXPECTATION_LABELS: Record<string, string> = {
  KARIYER_YONLENDIRME: 'Kariyer Yönlendirme',
  TEKNIK_BECERI: 'Teknik Beceri',
  IS_STAJ_BAGLANTISI: 'İş & Staj',
  GIRISIMCILIK: 'Girişimcilik',
  KISISEL_GELISIM: 'Kişisel Gelişim',
  SEKTOR_TANIMA: 'Sektör Tanıma',
};

const CLUB_TYPE_LABELS: Record<string, string> = {
  AKADEMIK: '📚 Akademik', SOSYAL: '🤝 Sosyal', SPOR: '⚽ Spor',
  SANAT: '🎨 Sanat', TEKNOLOJI: '💻 Teknoloji', DIGER: '📌 Diğer',
};

const COMMITMENT_LABELS: Record<string, string> = {
  AYDA_1: 'Ayda 1×', AYDA_2_3: 'Ayda 2-3×',
  HAFTADA_1: 'Haftada 1×', HAFTADA_2_PLUS: 'Haftada 2+×',
};

function BentoCard({
  children, className = '', label,
}: { children: React.ReactNode; className?: string; label?: string }) {
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

export default function MentiDashboard() {
  const { session, loading } = useSession('MENTI');
  const branding = useTenantBranding();
  const { data: profile } = useUser(session?.userId ?? '');
  const { data: meetings } = useMeetings({ mentiId: session?.userId });
  const { data: clubs } = useUserClubs(session?.userId ?? '');
  const { data: analytics } = useAnalytics(session?.userId ?? '');
  const createMeeting = useCreateMeeting();
  const [feedbackMeeting, setFeedbackMeeting] = useState<Meeting | null>(null);

  if (loading) {
    return (
      <div className="grid grid-cols-12 gap-3">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className={`h-40 rounded-2xl ${i === 0 ? 'col-span-6' : 'col-span-3'}`} />)}
      </div>
    );
  }
  if (!session) return null;

  const isLocked = profile?.needsOrientation ?? false;
  const discVector = analytics?.discVector ?? null;
  const expectations: string[] = (profile as { expectationCategories?: string[] })?.expectationCategories ?? [];
  const pendingMeetings = meetings?.items.filter((m) => m.status === 'PENDING') ?? [];
  const completedMeetings = meetings?.items.filter((m) => m.status === 'COMPLETED') ?? [];
  const discType = profile?.discType as DiscType | null;
  const timeCommitment = (profile as { timeCommitment?: string })?.timeCommitment ?? null;

  return (
    <div className="grid grid-cols-12 gap-3 auto-rows-min">

      {/* ── HERO: Profil Kartı ──────────────────────────────────────── */}
      <BentoCard className="col-span-12 md:col-span-5 row-span-2 p-5 flex flex-col justify-between min-h-52">
        <div className="space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: branding.primaryColor }}>
                MENTİ
              </p>
              <h2 className="text-xl font-bold text-slate-900 mt-0.5 leading-tight">{session.fullName}</h2>
              {profile?.email && <p className="text-xs text-slate-400 mt-0.5">{profile.email}</p>}
            </div>
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg font-black shrink-0"
              style={{ backgroundColor: branding.primaryColor }}
            >
              {session.fullName.charAt(0)}
            </div>
          </div>

          {discType && <DiscBadge discType={discType} size="lg" />}

          {discVector && (
            <div>
              <p className="text-[10px] text-slate-400 mb-1.5 uppercase tracking-wider">DISC Vektörü</p>
              <DiscVectorBars vector={discVector} height={28} />
            </div>
          )}

          {timeCommitment && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span>⏱</span>
              <span>{COMMITMENT_LABELS[timeCommitment] ?? timeCommitment}</span>
            </div>
          )}
        </div>

        {isLocked && (
          <div className="mt-3">
            <OrientationBadge active />
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-400">{branding.name}</p>
        </div>
      </BentoCard>

      {/* ── STAT: Toplantılar ──────────────────────────────────────── */}
      <BentoCard className="col-span-6 md:col-span-3 p-4" label="TOPLANTI">
        <div className="mt-5 text-center">
          <p className="text-4xl font-black" style={{ color: branding.primaryColor }}>
            {meetings?.total ?? 0}
          </p>
          <div className="flex justify-center gap-2 mt-1">
            <span className="text-[10px] text-amber-500">⏳ {pendingMeetings.length}</span>
            <span className="text-[10px] text-emerald-500">✓ {completedMeetings.length}</span>
          </div>
        </div>
      </BentoCard>

      {/* ── STAT: Sektör Etiketleri ───────────────────────────────── */}
      <BentoCard className="col-span-6 md:col-span-4 p-4" label="SEKTÖRLER">
        <div className="mt-5 flex flex-wrap gap-1">
          {(profile?.sectorTags ?? []).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
          ))}
          {(profile?.sectorTags ?? []).length === 0 && (
            <p className="text-xs text-slate-400">Henüz sektör eklenmedi</p>
          )}
        </div>
      </BentoCard>

      {/* ── GAUGE: Analitik Güven Skoru ───────────────────────────── */}
      <BentoCard className="col-span-6 md:col-span-4 p-4 flex flex-col items-center justify-center" label="DISC GÜVEN">
        {discVector ? (
          <>
            <ProgressGauge
              value={Math.round((discVector.confidence ?? 0) * 100)}
              label="profil"
              color={branding.primaryColor}
              size="md"
              className="mt-5"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Dominant: <span className="font-bold">{analytics?.dominantType}</span>
            </p>
          </>
        ) : (
          <div className="mt-6 text-center">
            <p className="text-2xl">🔬</p>
            <p className="text-xs text-slate-400 mt-1">Testi tamamla</p>
            <a href="/dashboard/profile" className="text-[10px] text-indigo-500 hover:underline">
              Mizaç testi →
            </a>
          </div>
        )}
      </BentoCard>

      {/* ── BEKLENTI KATEGORİLERİ ─────────────────────────────────── */}
      <BentoCard className="col-span-12 md:col-span-5 p-4" label="BEKLENTİLER">
        <div className="mt-5 space-y-2">
          {expectations.length > 0 ? expectations.map((cat) => (
            <div key={cat} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: branding.primaryColor }} />
              <span className="text-xs text-slate-700">{EXPECTATION_LABELS[cat] ?? cat}</span>
            </div>
          )) : (
            <p className="text-xs text-slate-400">Henüz beklenti kategorisi eklenmedi</p>
          )}
        </div>
      </BentoCard>

      {/* ── BECERILER + KULÜPLER ─────────────────────────────────── */}
      <BentoCard className="col-span-12 md:col-span-5 p-4" label="BECERİLER">
        <div className="mt-5 flex flex-wrap gap-1.5">
          {(profile?.skills ?? []).map((skill) => (
            <span
              key={skill}
              className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-600"
            >
              {skill}
            </span>
          ))}
          {(profile?.skills ?? []).length === 0 && (
            <p className="text-xs text-slate-400">Henüz beceri eklenmedi</p>
          )}
        </div>
      </BentoCard>

      {/* ── KULÜPLER ─────────────────────────────────────────────── */}
      {(clubs?.total ?? 0) > 0 && (
        <BentoCard className="col-span-12 md:col-span-4 p-4" label="KULÜPLERİM">
          <div className="mt-5 space-y-2">
            {clubs!.items.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-700 truncate">{m.club?.name}</p>
                  <p className="text-[10px] text-slate-400">
                    {m.club ? CLUB_TYPE_LABELS[m.club.type] : ''}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">{m.role}</Badge>
              </div>
            ))}
          </div>
        </BentoCard>
      )}

      {/* ── TOPLANTILER: Tam Genişlik Timeline ──────────────────── */}
      <div className="col-span-12">
        <h2 className="text-sm font-semibold text-slate-700 mb-2 px-1">Toplantı Geçmişi</h2>
        <BentoCard className="p-4">
          <MeetingTimeline
            meetings={meetings?.items ?? []}
            role="MENTI"
            onFeedback={(m) => setFeedbackMeeting(m)}
          />
        </BentoCard>
      </div>

      {feedbackMeeting && (
        <FeedbackForm
          meeting={feedbackMeeting}
          role="MENTI"
          onClose={() => setFeedbackMeeting(null)}
        />
      )}
    </div>
  );
}
