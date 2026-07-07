'use client';

import { useState } from 'react';
import { useSession } from '@/hooks/useSession';
import {
  useJobListings,
  useCreateJobListing,
  useUpdateJobListing,
  type CreateJobListingPayload,
  type UpdateJobListingPayload,
} from '@/hooks/useJobListings';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { JobListing } from '@/types/api';

const EMPTY_FORM: CreateJobListingPayload = {
  title: '',
  description: '',
  location: '',
  tags: [],
};

function JobListingForm({
  initial,
  onSubmit,
  isPending,
  onCancel,
}: {
  initial: CreateJobListingPayload;
  onSubmit: (data: CreateJobListingPayload) => void;
  isPending: boolean;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<CreateJobListingPayload>(initial);
  const [tagInput, setTagInput] = useState('');

  function handleTagAdd() {
    const trimmed = tagInput.trim().toLowerCase();
    if (!trimmed || (form.tags ?? []).includes(trimmed)) return;
    setForm((prev) => ({ ...prev, tags: [...(prev.tags ?? []), trimmed] }));
    setTagInput('');
  }

  function handleTagRemove(tag: string) {
    setForm((prev) => ({ ...prev, tags: (prev.tags ?? []).filter((t) => t !== tag) }));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <Label htmlFor="jl-title">Başlık *</Label>
        <Input
          id="jl-title"
          required
          minLength={2}
          value={form.title}
          onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
          placeholder="Yazılım Mühendisi, Pazarlama Stajyeri…"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="jl-description">Açıklama *</Label>
        <textarea
          id="jl-description"
          required
          minLength={5}
          value={form.description}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          placeholder="Pozisyon hakkında detaylı açıklama…"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="jl-location">Konum</Label>
        <Input
          id="jl-location"
          value={form.location ?? ''}
          onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
          placeholder="İstanbul, Uzaktan…"
        />
      </div>

      <div className="space-y-2">
        <Label>Etiketler</Label>
        <div className="flex gap-2">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleTagAdd(); } }}
            placeholder="teknoloji, finans… Enter ile ekle"
            className="flex-1"
          />
          <Button type="button" variant="outline" size="sm" onClick={handleTagAdd}>
            Ekle
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(form.tags ?? []).map((tag) => (
            <Badge key={tag} variant="secondary" className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground" onClick={() => handleTagRemove(tag)}>
              {tag} ×
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          İptal
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Kaydediliyor…' : 'Kaydet'}
        </Button>
      </div>
    </form>
  );
}

function JobListingRow({
  listing,
  onEdit,
}: {
  listing: JobListing;
  onEdit: (listing: JobListing) => void;
}) {
  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
      <td className="py-3 px-4">
        <p className="text-sm font-medium text-slate-900">{listing.title}</p>
        {listing.location && (
          <p className="text-xs text-slate-400 mt-0.5">{listing.location}</p>
        )}
      </td>
      <td className="py-3 px-4 hidden md:table-cell">
        <p className="text-sm text-slate-600 line-clamp-2">{listing.description}</p>
      </td>
      <td className="py-3 px-4">
        <div className="flex flex-wrap gap-1">
          {listing.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
          {listing.tags.length > 3 && (
            <Badge variant="outline" className="text-xs">+{listing.tags.length - 3}</Badge>
          )}
        </div>
      </td>
      <td className="py-3 px-4">
        <Badge variant={listing.isActive ? 'default' : 'secondary'} className="text-xs">
          {listing.isActive ? 'Aktif' : 'Pasif'}
        </Badge>
      </td>
      <td className="py-3 px-4">
        <Button variant="ghost" size="sm" onClick={() => onEdit(listing)}>
          Düzenle
        </Button>
      </td>
    </tr>
  );
}

export default function JobListingsPage() {
  const { session, loading } = useSession('ADMIN');

  const [currentPage, setCurrentPage] = useState(1);
  const [filterActive, setFilterActive] = useState<boolean | undefined>(undefined);
  const [filterTag, setFilterTag] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingListing, setEditingListing] = useState<JobListing | null>(null);

  const { data, isLoading } = useJobListings({
    isActive: filterActive,
    tag: filterTag || undefined,
    page: currentPage,
    limit: 20,
  });

  const createMutation = useCreateJobListing();
  const updateMutation = useUpdateJobListing(editingListing?.id ?? '');

  function handleCreate(payload: CreateJobListingPayload) {
    createMutation.mutate(payload, {
      onSuccess: () => setIsCreateDialogOpen(false),
    });
  }

  function handleUpdate(payload: UpdateJobListingPayload) {
    if (!editingListing) return;
    updateMutation.mutate(payload, {
      onSuccess: () => setEditingListing(null),
    });
  }

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (!session) return null;

  const listings = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">İş İlanları</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {data?.total ?? 0} ilan · Sayfa {currentPage}/{totalPages}
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>+ Yeni İlan</Button>
      </div>

      {/* Filtreler */}
      <Card>
        <CardContent className="py-3 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <Label className="text-xs">Durum:</Label>
            <div className="flex gap-1">
              {[
                { label: 'Tümü', value: undefined },
                { label: 'Aktif', value: true },
                { label: 'Pasif', value: false },
              ].map(({ label, value }) => (
                <button
                  key={label}
                  onClick={() => { setFilterActive(value); setCurrentPage(1); }}
                  className={[
                    'text-xs px-2.5 py-1 rounded-full border transition-colors',
                    filterActive === value
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-xs">Etiket:</Label>
            <Input
              value={filterTag}
              onChange={(e) => { setFilterTag(e.target.value); setCurrentPage(1); }}
              placeholder="teknoloji…"
              className="h-7 text-xs w-32"
            />
          </div>
        </CardContent>
      </Card>

      {/* Tablo */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">İlan Listesi</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : listings.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-400">
              Filtreye uyan ilan bulunamadı.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 text-xs text-slate-400 uppercase tracking-wider">
                    <th className="py-2 px-4 text-left">Başlık</th>
                    <th className="py-2 px-4 text-left hidden md:table-cell">Açıklama</th>
                    <th className="py-2 px-4 text-left">Etiketler</th>
                    <th className="py-2 px-4 text-left">Durum</th>
                    <th className="py-2 px-4 text-left"></th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((listing) => (
                    <JobListingRow key={listing.id} listing={listing} onEdit={setEditingListing} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sayfalama */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            ← Önceki
          </Button>
          <span className="text-sm text-slate-500">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            Sonraki →
          </Button>
        </div>
      )}

      {/* Yeni İlan Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Yeni İlan Oluştur</DialogTitle>
          </DialogHeader>
          <JobListingForm
            initial={EMPTY_FORM}
            onSubmit={handleCreate}
            isPending={createMutation.isPending}
            onCancel={() => setIsCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Düzenleme Dialog */}
      <Dialog open={!!editingListing} onOpenChange={(open) => { if (!open) setEditingListing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>İlanı Düzenle</DialogTitle>
          </DialogHeader>
          {editingListing && (
            <JobListingForm
              initial={{
                title: editingListing.title,
                description: editingListing.description,
                location: editingListing.location ?? '',
                tags: editingListing.tags,
              }}
              onSubmit={handleUpdate}
              isPending={updateMutation.isPending}
              onCancel={() => setEditingListing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
