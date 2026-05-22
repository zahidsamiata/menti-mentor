'use client';

import { useSession } from '@/hooks/useSession';
import { useUsers } from '@/hooks/useUsers';
import { useMeetings } from '@/hooks/useMeetings';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-500">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

export default function AdminOverview() {
  const { session, loading } = useSession('ADMIN');
  const { data: users } = useUsers();
  const { data: pendingFeedback } = useMeetings({ pendingFeedback: true });
  const { data: activeMeetings } = useMeetings({ status: 'APPROVED' });

  if (loading) return <Skeleton className="h-32 w-full" />;
  if (!session) return null;

  const lockedCount = users?.items.filter((u) => u.needsOrientation).length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Yönetici Paneli</h1>
        <p className="text-slate-500 text-sm">Sistem genel bakışı</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Toplam Kullanıcı" value={users?.total ?? '—'} />
        <StatCard label="Aktif Toplantı" value={activeMeetings?.total ?? '—'} />
        <StatCard label="Feedback Bekliyor" value={pendingFeedback?.total ?? '—'} />
        <StatCard label="Kilitli Menti" value={lockedCount} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hızlı Erişim</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3 flex-wrap">
          <a href="/dashboard/admin/users" className="text-sm text-blue-600 hover:underline">→ Kullanıcıları Yönet</a>
          <a href="/dashboard/admin/clubs" className="text-sm text-blue-600 hover:underline">→ Kulüpleri Yönet</a>
          <a href="/dashboard/admin/logs" className="text-sm text-blue-600 hover:underline">→ Sistem Logları</a>
        </CardContent>
      </Card>
    </div>
  );
}
