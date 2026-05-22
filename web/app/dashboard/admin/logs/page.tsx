'use client';

import { useState } from 'react';
import { useSession } from '@/hooks/useSession';
import { useSystemLogs } from '@/hooks/useSystemLogs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SystemLog } from '@/types/api';

const levelColors: Record<string, string> = {
  INFO: 'bg-blue-100 text-blue-700',
  WARN: 'bg-yellow-100 text-yellow-700',
  ERROR: 'bg-red-100 text-red-700',
};

function LogRow({ log }: { log: SystemLog }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${levelColors[log.level]}`}>
        {log.level}
      </span>
      <span className="text-xs font-semibold text-slate-500 shrink-0 w-16">{log.category}</span>
      <span className="text-sm text-slate-700 flex-1">{log.message}</span>
      <span className="text-xs text-slate-400 shrink-0">
        {new Date(log.createdAt).toLocaleString('tr-TR')}
      </span>
    </div>
  );
}

export default function AdminLogsPage() {
  const { session, loading } = useSession('ADMIN');
  const [level, setLevel] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const { data, isLoading } = useSystemLogs(level || undefined, category || undefined);

  if (loading) return <Skeleton className="h-32 w-full" />;
  if (!session) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Sistem Logları</h1>
        <p className="text-slate-500 text-sm">Her 15 saniyede otomatik yenilenir</p>
      </div>

      <div className="flex gap-3">
        <Select value={level} onValueChange={(v) => setLevel(v ?? '')}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Tüm seviyeler" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Tümü</SelectItem>
            <SelectItem value="INFO">INFO</SelectItem>
            <SelectItem value="WARN">WARN</SelectItem>
            <SelectItem value="ERROR">ERROR</SelectItem>
          </SelectContent>
        </Select>

        <Select value={category} onValueChange={(v) => setCategory(v ?? '')}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Tüm kategoriler" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Tümü</SelectItem>
            <SelectItem value="EMAIL">EMAIL</SelectItem>
            <SelectItem value="ML">ML</SelectItem>
            <SelectItem value="AUTH">AUTH</SelectItem>
            <SelectItem value="SYSTEM">SYSTEM</SelectItem>
            <SelectItem value="HTTP">HTTP</SelectItem>
          </SelectContent>
        </Select>

        <Badge variant="outline" className="ml-auto self-center">
          {data?.total ?? 0} kayıt
        </Badge>
      </div>

      <div className="rounded-lg border bg-white p-2">
        {isLoading ? (
          <div className="space-y-2 p-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : data?.items.length === 0 ? (
          <p className="text-center text-slate-400 py-8 text-sm">Kayıt bulunamadı.</p>
        ) : (
          data?.items.map((log) => <LogRow key={log.id} log={log} />)
        )}
      </div>
    </div>
  );
}
