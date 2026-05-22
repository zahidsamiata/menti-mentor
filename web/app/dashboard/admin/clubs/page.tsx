'use client';

import { useState } from 'react';
import { useSession } from '@/hooks/useSession';
import { useClubs, useCreateClub, useClubMembers, useAddClubMember, useRemoveClubMember } from '@/hooks/useClubs';
import { useUsers } from '@/hooks/useUsers';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { Club } from '@/types/api';

const clubTypeLabels: Record<string, string> = {
  AKADEMIK: '📚 Akademik', SOSYAL: '🤝 Sosyal', SPOR: '⚽ Spor',
  SANAT: '🎨 Sanat', TEKNOLOJI: '💻 Teknoloji', DIGER: '📌 Diğer',
};

function ClubCard({ club, onManage }: { club: Club; onManage: () => void }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base">{club.name}</CardTitle>
          <Badge variant="secondary" className="text-xs">{clubTypeLabels[club.type]}</Badge>
        </div>
        {club.description && (
          <p className="text-xs text-slate-500 line-clamp-2">{club.description}</p>
        )}
      </CardHeader>
      <CardContent>
        <Button size="sm" variant="outline" onClick={onManage}>Üyeleri Yönet</Button>
      </CardContent>
    </Card>
  );
}

function MembersDialog({ clubId, onClose }: { clubId: string; onClose: () => void }) {
  const { data: members } = useClubMembers(clubId);
  const { data: users } = useUsers();
  const addMember = useAddClubMember(clubId);
  const removeMember = useRemoveClubMember(clubId);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [memberRole, setMemberRole] = useState('UYE');

  const memberIds = new Set(members?.items.map((m) => m.userId));
  const nonMembers = users?.items.filter((u) => !memberIds.has(u.id)) ?? [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Üye Yönetimi</DialogTitle></DialogHeader>

        {/* Üye ekle */}
        <div className="flex gap-2">
          <Select value={selectedUserId} onValueChange={(v) => setSelectedUserId(v ?? '')}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Kullanıcı seç" />
            </SelectTrigger>
            <SelectContent>
              {nonMembers.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.fullName} ({u.role})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={memberRole} onValueChange={(v) => setMemberRole(v ?? 'UYE')}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BASKAN">Başkan</SelectItem>
              <SelectItem value="YONETIM">Yönetim</SelectItem>
              <SelectItem value="UYE">Üye</SelectItem>
              <SelectItem value="DANISMAN">Danışman</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!selectedUserId || addMember.isPending}
            onClick={() => {
              addMember.mutate({ userId: selectedUserId, role: memberRole });
              setSelectedUserId('');
            }}
          >
            Ekle
          </Button>
        </div>

        {/* Üye listesi */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {members?.items.map((m) => (
            <div key={m.id} className="flex items-center justify-between py-2 border-b last:border-0">
              <div>
                <p className="text-sm font-medium">{m.user?.fullName}</p>
                <p className="text-xs text-slate-500">{m.user?.role}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">{m.role}</Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-500 hover:text-red-700 h-7 px-2"
                  onClick={() => removeMember.mutate(m.userId)}
                >
                  Çıkar
                </Button>
              </div>
            </div>
          ))}
          {members?.total === 0 && (
            <p className="text-center text-slate-400 text-sm py-4">Henüz üye yok.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminClubsPage() {
  const { session, loading } = useSession('ADMIN');
  const { data, isLoading } = useClubs();
  const createClub = useCreateClub();

  const [managingClubId, setManagingClubId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newType, setNewType] = useState('TEKNOLOJI');
  const [newDesc, setNewDesc] = useState('');

  if (loading || isLoading) return <Skeleton className="h-64 w-full" />;
  if (!session) return null;

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createClub.mutate(
      { name: newName, slug: newSlug, type: newType, description: newDesc || undefined },
      { onSuccess: () => { setShowCreate(false); setNewName(''); setNewSlug(''); setNewDesc(''); } },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Kulüpler</h1>
          <p className="text-slate-500 text-sm">{data?.total ?? 0} kulüp</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>+ Yeni Kulüp</Button>
      </div>

      {/* Kulüp oluşturma formu */}
      {showCreate && (
        <Card>
          <CardContent className="pt-4">
            <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Ad</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label>Slug</Label>
                <Input value={newSlug} onChange={(e) => setNewSlug(e.target.value)} required placeholder="yazilim-kulubu" />
              </div>
              <div className="space-y-1">
                <Label>Tür</Label>
                <Select value={newType} onValueChange={(v) => setNewType(v ?? 'TEKNOLOJI')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(clubTypeLabels).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Açıklama</Label>
                <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
              </div>
              <div className="col-span-2 flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>İptal</Button>
                <Button type="submit" disabled={createClub.isPending}>Oluştur</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Kulüp kartları */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data?.items.map((club) => (
          <ClubCard key={club.id} club={club} onManage={() => setManagingClubId(club.id)} />
        ))}
      </div>

      {managingClubId && (
        <MembersDialog clubId={managingClubId} onClose={() => setManagingClubId(null)} />
      )}
    </div>
  );
}
