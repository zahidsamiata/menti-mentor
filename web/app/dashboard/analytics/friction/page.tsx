'use client';

import { useSession } from '@/hooks/useSession';
import { useAnalytics, type DimKey } from '@/hooks/useAnalytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const SEVERITY_STYLE: Record<string, string> = {
  Yüksek: 'bg-red-100 border-red-300 text-red-800',
  Orta:   'bg-yellow-100 border-yellow-300 text-yellow-800',
  Düşük:  'bg-green-100 border-green-300 text-green-700',
};

const SEVERITY_BADGE: Record<string, string> = {
  Yüksek: 'bg-red-600 text-white',
  Orta:   'bg-yellow-500 text-white',
  Düşük:  'bg-green-600 text-white',
};

const RISK_BG: Record<string, string> = {
  Yüksek: 'bg-red-50 border-red-200',
  Orta:   'bg-yellow-50 border-yellow-200',
  Düşük:  'bg-green-50 border-green-200',
};

const DIM_LABEL: Record<DimKey, string> = {
  D: 'Dominant', I: 'Etkili', S: 'Kararlı/Sabit', C: 'Vicdanlı',
};

export default function FrictionPage() {
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

  const { frictionMatrix, dominantType } = data;
  const { selfExtremes, partnerClashes, overallRisk } = frictionMatrix;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Kör Noktalar & Çatışma Analiz Kartı</h1>
        <p className="text-sm text-slate-500 mt-1">
          Dominant {dominantType} ({DIM_LABEL[dominantType]}) profilinizin davranışsal uç noktaları ve ortam bazlı sürtüşme riskleri.
        </p>
      </div>

      {/* Genel risk skoru */}
      <div className={`rounded-xl border p-5 flex items-center gap-4 ${RISK_BG[overallRisk]}`}>
        <div className="text-center shrink-0">
          <p className="text-xs text-slate-500 font-medium">Genel Risk</p>
          <Badge className={`text-base px-4 py-1 mt-1 ${SEVERITY_BADGE[overallRisk]}`}>
            {overallRisk}
          </Badge>
        </div>
        <div className="text-sm text-slate-700">
          {overallRisk === 'Yüksek'
            ? 'Profiliniz birden fazla yüksek-öncelik sürtüşme noktası içeriyor. Aşağıdaki müdahale stratejileri kritik önemdedir.'
            : overallRisk === 'Orta'
            ? 'Belirli durumlarda gözlemlenebilir sürtüşme noktaları mevcut. Proaktif müdahale sürtüşmeyi önemli ölçüde azaltır.'
            : 'Profiliniz düşük genel risk taşıyor. Farkındalık yeterli; büyük yapısal değişiklik gerekmez.'}
        </div>
      </div>

      {/* Kendi davranışsal uç noktaları */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Kendi Davranışsal Uç Noktaları</h2>
        {selfExtremes.length === 0 ? (
          <p className="text-sm text-slate-500">Anlamlı uç nokta tespit edilmedi.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {selfExtremes.map((fp, i) => (
              <div
                key={i}
                className={`rounded-xl border p-4 space-y-2 ${SEVERITY_STYLE[fp.severity]}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    {fp.dimension} — {DIM_LABEL[fp.dimension]}
                  </span>
                  <Badge className={`text-xs ${SEVERITY_BADGE[fp.severity]}`}>
                    {fp.severity}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide opacity-70 mb-0.5">Tetikleyici</p>
                  <p className="text-sm">{fp.trigger}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide opacity-70 mb-0.5">Tezahür</p>
                  <p className="text-sm">{fp.manifestation}</p>
                </div>
                <div className="border-t border-current border-opacity-20 pt-2">
                  <p className="text-xs font-medium uppercase tracking-wide opacity-70 mb-0.5">Müdahale Stratejisi</p>
                  <p className="text-sm font-medium">{fp.mitigation}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Partner çatışma riskleri */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Partner DISC Tipi Çatışma Riskleri</h2>
        {partnerClashes.length === 0 ? (
          <p className="text-sm text-slate-500">Bilinen yüksek riskli çatışma çifti yok.</p>
        ) : (
          <div className="space-y-3">
            {partnerClashes.map((clash, i) => (
              <Card key={i}>
                <CardContent className="py-4">
                  <div className="flex items-start gap-4">
                    <div className="shrink-0 text-center">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
                        <span className="text-lg font-black text-slate-600">
                          {dominantType}↔{clash.partnerDim}
                        </span>
                      </div>
                      <Badge className={`mt-1 text-xs ${SEVERITY_BADGE[clash.severity]}`}>
                        {clash.severity}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-700 mb-1">
                        {DIM_LABEL[dominantType]} × {DIM_LABEL[clash.partnerDim]}
                      </p>
                      <p className="text-sm text-slate-600">{clash.clashDescription}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Farkındalık notu */}
      <Card className="bg-slate-50">
        <CardHeader>
          <CardTitle className="text-sm">Farkındalık Notu</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600 leading-relaxed">
            Bu analiz, profilinizin <em>potansiyel</em> sürtüşme noktalarını öngörür. Her sürtüşme mutlaka
            gerçekleşmez; ortam, ilişki kalitesi ve bilinçli müdahale belirleyicidir. Buradaki veriler
            kişisel farkındalığı artırmak ve önleyici stratejiler geliştirmek için tasarlanmıştır.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
