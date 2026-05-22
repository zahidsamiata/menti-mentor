'use client';

import { useSession } from '@/hooks/useSession';
import { useCandidates, useSetVisibilityOptIn } from '@/hooks/useCandidates';
import { ProfileCard } from '@/components/profile/ProfileCard';
import { Skeleton } from '@/components/ui/skeleton';

export default function CandidatesPage() {
  const { session, loading } = useSession('MENTOR');
  const { data: candidates, isLoading } = useCandidates(session?.userId ?? '');
  const optIn = useSetVisibilityOptIn(session?.userId ?? '');

  if (loading || isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
      </div>
    );
  }
  if (!session) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Aday Mentiler</h1>
        <p className="text-slate-500 text-sm">{candidates?.length ?? 0} aday — uyum skoruna göre sıralandı</p>
      </div>

      {candidates && candidates.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {candidates.map((menti) => (
            <ProfileCard
              key={menti.id}
              menti={menti}
              onOptIn={() => optIn.mutate({ mentiId: menti.id, status: 'APPROVED' })}
              optInLoading={optIn.isPending}
            />
          ))}
        </div>
      ) : (
        <p className="text-center text-slate-400 py-16">Uygun aday bulunamadı.</p>
      )}
    </div>
  );
}
