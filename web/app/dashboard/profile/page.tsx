'use client';

import { useState, useEffect } from 'react';
import { useSession } from '@/hooks/useSession';
import { useUser } from '@/hooks/useUsers';
import { usePatchSelfProfile } from '@/hooks/useAnalytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type Attribute = { key: string; value: string };

function parseProfile(raw: unknown): Attribute[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>).map(([key, value]) => ({
    key,
    value: String(value),
  }));
}

function serializeAttributes(attrs: Attribute[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const a of attrs) {
    if (a.key.trim()) obj[a.key.trim()] = a.value;
  }
  return obj;
}

export default function ProfilePage() {
  const { session, loading } = useSession();
  const { data: user, isLoading } = useUser(session?.userId ?? '');
  const patchProfile = usePatchSelfProfile(session?.userId ?? '');

  const [attrs, setAttrs] = useState<Attribute[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (user?.selfProfile !== undefined) {
      setAttrs(parseProfile(user.selfProfile));
      setDirty(false);
    }
  }, [user?.selfProfile]);

  if (loading || isLoading) return <Skeleton className="h-96 w-full" />;
  if (!session) return null;

  const addRow = () => {
    setAttrs((prev) => [...prev, { key: '', value: '' }]);
    setDirty(true);
  };

  const removeRow = (i: number) => {
    setAttrs((prev) => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  };

  const updateKey = (i: number, val: string) => {
    setAttrs((prev) => prev.map((a, idx) => (idx === i ? { ...a, key: val } : a)));
    setDirty(true);
  };

  const updateVal = (i: number, val: string) => {
    setAttrs((prev) => prev.map((a, idx) => (idx === i ? { ...a, value: val } : a)));
    setDirty(true);
  };

  const save = () => {
    const payload = serializeAttributes(attrs);
    patchProfile.mutate(payload);
    setDirty(false);
  };

  const reset = () => {
    setAttrs(parseProfile(user?.selfProfile));
    setDirty(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dinamik Profil Yönetimi</h1>
        <p className="text-sm text-slate-500 mt-1">
          Serbest biçim metadata alanları — istediğiniz anahtar-değer çiftini ekleyin, düzenleyin veya silin.
        </p>
      </div>

      {/* Sabit profil özeti */}
      <Card className="bg-slate-50">
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-slate-500 text-xs uppercase tracking-wide">Ad Soyad</span>
              <p className="font-medium">{user?.fullName}</p>
            </div>
            <div>
              <span className="text-slate-500 text-xs uppercase tracking-wide">Rol</span>
              <p className="font-medium">{session.role}</p>
            </div>
            <div>
              <span className="text-slate-500 text-xs uppercase tracking-wide">E-posta</span>
              <p className="font-medium">{user?.email}</p>
            </div>
            {user?.discType && (
              <div>
                <span className="text-slate-500 text-xs uppercase tracking-wide">DISC Tipi</span>
                <Badge className="ml-1">{user.discType}</Badge>
              </div>
            )}
          </div>
          {user?.bioSummary && (
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">{user.bioSummary}</p>
          )}
        </CardContent>
      </Card>

      {/* Serbest metadata editörü */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Serbest Metadata Alanları</CardTitle>
            <div className="flex gap-2">
              {dirty && (
                <Button size="sm" variant="outline" onClick={reset}>
                  Sıfırla
                </Button>
              )}
              <Button size="sm" onClick={save} disabled={!dirty || patchProfile.isPending}>
                {patchProfile.isPending ? 'Kaydediliyor...' : 'Kaydet'}
              </Button>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Örnek alanlar: <code>GitHub</code>, <code>LinkedIn</code>, <code>HobbyProject</code>, <code>Certification</code>, <code>TargetCompany</code>...
          </p>
        </CardHeader>
        <CardContent>
          {attrs.length === 0 && (
            <p className="text-sm text-slate-400 italic mb-4">Henüz hiç alan eklenmemiş.</p>
          )}
          <div className="space-y-2 mb-4">
            {attrs.map((attr, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  value={attr.key}
                  onChange={(e) => updateKey(i, e.target.value)}
                  placeholder="Alan adı (ör: GitHub)"
                  className="flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
                <span className="text-slate-400 shrink-0">:</span>
                <input
                  value={attr.value}
                  onChange={(e) => updateVal(i, e.target.value)}
                  placeholder="Değer"
                  className="flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
                <button
                  onClick={() => removeRow(i)}
                  className="shrink-0 text-slate-400 hover:text-red-500 transition-colors px-1 text-lg"
                  aria-label="Sil"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={addRow} className="w-full border-dashed">
            + Alan Ekle
          </Button>
        </CardContent>
      </Card>

      {/* Mevcut JSON önizlemesi */}
      {attrs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-slate-500">JSON Önizleme</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-slate-50 rounded-md p-3 overflow-x-auto text-slate-700">
              {JSON.stringify(serializeAttributes(attrs), null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Sektör & beceri bilgileri */}
      {((user?.sectorTags?.length ?? 0) > 0 || (user?.skills?.length ?? 0) > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Etiketler & Beceriler</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(user?.sectorTags?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-1.5">Sektör Etiketleri</p>
                <div className="flex flex-wrap gap-1.5">
                  {user?.sectorTags.map((t) => (
                    <Badge key={t} variant="outline">{t}</Badge>
                  ))}
                </div>
              </div>
            )}
            {(user?.skills?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-1.5">Beceriler</p>
                <div className="flex flex-wrap gap-1.5">
                  {user?.skills.map((s) => (
                    <Badge key={s} className="bg-slate-100 text-slate-700">{s}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
