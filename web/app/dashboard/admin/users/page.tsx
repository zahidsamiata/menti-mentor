'use client';

import { useSession } from '@/hooks/useSession';
import { useUsers, useClearOrientationLock } from '@/hooks/useUsers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { User } from '@/types/api';

const roleColors: Record<string, string> = {
  ADMIN: 'bg-purple-100 text-purple-700',
  MENTOR: 'bg-blue-100 text-blue-700',
  MENTI: 'bg-green-100 text-green-700',
};

const discColors: Record<string, string> = {
  D: 'bg-red-100 text-red-700',
  I: 'bg-yellow-100 text-yellow-700',
  S: 'bg-green-100 text-green-700',
  C: 'bg-blue-100 text-blue-700',
};

export default function AdminUsersPage() {
  const { session, loading } = useSession('ADMIN');
  const { data, isLoading } = useUsers();
  const clearLock = useClearOrientationLock();

  if (loading || isLoading) return <Skeleton className="h-64 w-full" />;
  if (!session) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Kullanıcı Yönetimi</h1>
        <p className="text-slate-500 text-sm">{data?.total ?? 0} kullanıcı</p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ad Soyad</TableHead>
            <TableHead>E-posta</TableHead>
            <TableHead>Rol</TableHead>
            <TableHead>DISC</TableHead>
            <TableHead>Durum</TableHead>
            <TableHead>İşlem</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.items.map((user: User) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">{user.fullName}</TableCell>
              <TableCell className="text-slate-500 text-xs">{user.email}</TableCell>
              <TableCell>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${roleColors[user.role]}`}>
                  {user.role}
                </span>
              </TableCell>
              <TableCell>
                {user.discType ? (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${discColors[user.discType]}`}>
                    {user.discType}
                  </span>
                ) : (
                  <span className="text-slate-300 text-xs">—</span>
                )}
              </TableCell>
              <TableCell>
                {user.needsOrientation ? (
                  <Badge variant="destructive" className="text-xs">🔒 Kilitli</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">Aktif</Badge>
                )}
              </TableCell>
              <TableCell>
                {user.needsOrientation && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={clearLock.isPending}
                    onClick={() => clearLock.mutate(user.id)}
                  >
                    Kilidi Kaldır
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
