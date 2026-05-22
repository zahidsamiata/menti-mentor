'use client';

import { useSession } from '@/hooks/useSession';
import { useAnalytics, type DimKey } from '@/hooks/useAnalytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const DIM_LABEL: Record<DimKey, string> = {
  D: 'Dominant', I: 'Etkili', S: 'Kararlı/Sabit', C: 'Vicdanlı',
};

const DIM_COLOR: Record<DimKey, string> = {
  D: 'bg-red-500', I: 'bg-yellow-400', S: 'bg-green-500', C: 'bg-blue-500',
};

const DIM_TEXT: Record<DimKey, string> = {
  D: 'text-red-600', I: 'text-yellow-600', S: 'text-green-600', C: 'text-blue-600',
};

function VectorBar({ dimKey, value }: { dimKey: DimKey; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-3">
      <span className={`w-6 text-xs font-bold shrink-0 ${DIM_TEXT[dimKey]}`}>{dimKey}</span>
      <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${DIM_COLOR[dimKey]} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-500 w-8 text-right">{pct}%</span>
    </div>
  );
}

export default function IdealPersonaPage() {
  const { session, loading } = useSession();
  const { data, isLoading, error } = useAnalytics(session?.userId ?? '');

  if (loading || isLoading) return <Skeleton className="h-96 w-full" />;
  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center gap-2">
        <p className="text-lg font-semibold text-slate-700">DISC verisi bulunamadı</p>
        <p className="text-sm text-slate-500">Lütfen soru bankasını tamamlayın.</p>
      </div>
    );
  }

  const { complementaryPersona, discVector, dominantType, subDimensions } = data;
  const { idealVector, label, rationale, topDimensions, synergies } = complementaryPersona;

  const selfSorted = (['D', 'I', 'S', 'C'] as DimKey[]).slice().sort(
    (a, b) => discVector[b] - discVector[a],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Stratejik İK & İdeal Personel Eşleşme Profili</h1>
        <p className="text-sm text-slate-500 mt-1">{rationale}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Kendi profil özeti */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kendi DISC Profiliniz</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selfSorted.map((k) => (
              <VectorBar key={k} dimKey={k} value={discVector[k]} />
            ))}
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge className={`${DIM_COLOR[dominantType]} text-white`}>
                Dominant: {dominantType}
              </Badge>
              {subDimensions
                .find((s) => s.key === dominantType)
                ?.strengths.slice(0, 2).map((str) => (
                  <Badge key={str} variant="outline" className="text-xs">{str}</Badge>
                ))}
            </div>
          </CardContent>
        </Card>

        {/* İdeal tamamlayıcı profil */}
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-base text-blue-800">İdeal Tamamlayıcı Persona</CardTitle>
            <p className="text-xs text-blue-600 font-medium mt-1">{label}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {(['D', 'I', 'S', 'C'] as DimKey[]).sort(
              (a, b) => idealVector[b] - idealVector[a],
            ).map((k) => (
              <VectorBar key={k} dimKey={k} value={idealVector[k]} />
            ))}
            <div className="mt-4 flex flex-wrap gap-2">
              {topDimensions.map((k) => (
                <Badge key={k} className={`${DIM_COLOR[k]} text-white`}>
                  {k} — {DIM_LABEL[k]}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sinerji açıklamaları */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sinerji Kanalları</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {synergies.map((syn, i) => (
              <div key={i} className="p-4 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-xs text-slate-500 font-medium mb-1">Kanal {i + 1}</p>
                <p className="text-sm text-slate-700">{syn}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Blueprint: Hangi takım pozisyonları tamamlar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Takım Tamamlama Matriksi</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600 mb-4">
            Aşağıdaki DISC dağılımına sahip kişilerle kurulan ekipler en yüksek sinerjik çıktıyı üretir.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(['D', 'I', 'S', 'C'] as DimKey[]).map((k) => {
              const isTop = topDimensions.includes(k);
              const pct = Math.round(idealVector[k] * 100);
              return (
                <div
                  key={k}
                  className={`rounded-xl p-4 border text-center transition-all ${
                    isTop ? 'border-blue-300 bg-blue-100 shadow-sm' : 'border-slate-200 bg-white'
                  }`}
                >
                  <p className={`text-3xl font-black ${DIM_TEXT[k]}`}>{k}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{DIM_LABEL[k]}</p>
                  <p className={`text-lg font-bold mt-2 ${isTop ? 'text-blue-700' : 'text-slate-600'}`}>
                    {pct}%
                  </p>
                  {isTop && (
                    <Badge className="mt-2 text-xs bg-blue-600 text-white">Öncelikli</Badge>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
