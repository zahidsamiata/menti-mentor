'use client';

import { useSession } from '@/hooks/useSession';
import { useAnalytics, type DimKey } from '@/hooks/useAnalytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const DIM_COLOR: Record<DimKey, string> = {
  D: 'bg-red-500',
  I: 'bg-yellow-400',
  S: 'bg-green-500',
  C: 'bg-blue-500',
};

const DIM_TEXT: Record<DimKey, string> = {
  D: 'text-red-600',
  I: 'text-yellow-600',
  S: 'text-green-600',
  C: 'text-blue-600',
};

const DIM_BG_LIGHT: Record<DimKey, string> = {
  D: 'bg-red-50 border-red-200',
  I: 'bg-yellow-50 border-yellow-200',
  S: 'bg-green-50 border-green-200',
  C: 'bg-blue-50 border-blue-200',
};

const PERCENTILE_BADGE: Record<string, string> = {
  Yüksek: 'bg-emerald-100 text-emerald-800',
  Orta: 'bg-slate-100 text-slate-700',
  Düşük: 'bg-orange-100 text-orange-700',
};

// SVG Radar Chart (pure SVG, no library)
function RadarChart({ dims }: { dims: Array<{ key: DimKey; score: number }> }) {
  const cx = 120;
  const cy = 120;
  const r = 90;
  const levels = [0.25, 0.5, 0.75, 1];

  // 4 axes: top=D, right=I, bottom=S, left=C
  const AXIS_ANGLES: Record<DimKey, number> = { D: -90, I: 0, S: 90, C: 180 };

  const toXY = (dim: DimKey, ratio: number) => {
    const angle = (AXIS_ANGLES[dim] * Math.PI) / 180;
    return {
      x: cx + r * ratio * Math.cos(angle),
      y: cy + r * ratio * Math.sin(angle),
    };
  };

  const gridPoints = (ratio: number) =>
    (['D', 'I', 'S', 'C'] as DimKey[]).map((d) => toXY(d, ratio));

  const polygonPts = (pts: Array<{ x: number; y: number }>) =>
    pts.map((p) => `${p.x},${p.y}`).join(' ');

  const dataPoints = dims.map((d) => toXY(d.key, d.score / 100));

  return (
    <svg viewBox="0 0 240 240" className="w-full max-w-[220px] mx-auto">
      {/* Grid rings */}
      {levels.map((lvl) => (
        <polygon
          key={lvl}
          points={polygonPts(gridPoints(lvl))}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="1"
        />
      ))}
      {/* Axes */}
      {(['D', 'I', 'S', 'C'] as DimKey[]).map((d) => {
        const tip = toXY(d, 1);
        return <line key={d} x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke="#e2e8f0" strokeWidth="1" />;
      })}
      {/* Data polygon */}
      <polygon
        points={polygonPts(dataPoints)}
        fill="rgba(59,130,246,0.2)"
        stroke="#3b82f6"
        strokeWidth="2"
      />
      {/* Axis labels */}
      {(['D', 'I', 'S', 'C'] as DimKey[]).map((d) => {
        const tip = toXY(d, 1.18);
        return (
          <text
            key={d}
            x={tip.x}
            y={tip.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="13"
            fontWeight="600"
            fill={d === 'D' ? '#ef4444' : d === 'I' ? '#ca8a04' : d === 'S' ? '#16a34a' : '#2563eb'}
          >
            {d}
          </text>
        );
      })}
    </svg>
  );
}

export default function AnalyticsCockpit() {
  const { session, loading } = useSession();
  const { data, isLoading, error } = useAnalytics(session?.userId ?? '');

  if (loading || isLoading) return <Skeleton className="h-96 w-full" />;

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
        <p className="text-lg font-semibold text-slate-700">DISC verisi bulunamadı</p>
        <p className="text-sm text-slate-500">
          Analitik profili görmek için soru bankasını tamamlayın.
          <br />
          Sağ alttaki <strong>değerlendirme widget</strong>'ını kullanabilirsiniz.
        </p>
      </div>
    );
  }

  const { subDimensions, discVector, dominantType, compositeInsight, roleAlignment } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Kişisel Mizaç & Karakter Analiz Kokpiti</h1>
        <p className="text-sm text-slate-500 mt-1">{compositeInsight}</p>
      </div>

      {/* Dominant type + confidence */}
      <div className="flex flex-wrap gap-3 items-center">
        <Badge className={`text-base px-4 py-1 ${DIM_COLOR[dominantType]} text-white`}>
          Dominant: {dominantType} — {subDimensions.find((s) => s.key === dominantType)?.label}
        </Badge>
        <Badge variant="outline" className="text-xs">
          Güven seviyesi: %{Math.round(discVector.confidence * 100)}
        </Badge>
        <Badge variant="outline" className="text-xs">
          Rol: {roleAlignment.primaryRole}
        </Badge>
      </div>

      {/* Radar + bar grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Radar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">DISC Vektör Radar</CardTitle>
          </CardHeader>
          <CardContent>
            <RadarChart dims={subDimensions.map((s) => ({ key: s.key, score: s.score }))} />
            <div className="grid grid-cols-2 gap-2 mt-4">
              {(['D', 'I', 'S', 'C'] as DimKey[]).map((k) => {
                const val = Math.round(discVector[k] * 100);
                return (
                  <div key={k} className="flex items-center gap-2 text-xs">
                    <span className={`w-3 h-3 rounded-sm ${DIM_COLOR[k]}`} />
                    <span className="font-medium">{k}</span>
                    <span className="text-slate-500">{val}%</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Bar breakdown */}
        <div className="space-y-3">
          {subDimensions.map((sub) => (
            <Card key={sub.key} className={`border ${DIM_BG_LIGHT[sub.key]}`}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-sm font-semibold ${DIM_TEXT[sub.key]}`}>
                    {sub.key} — {sub.label}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PERCENTILE_BADGE[sub.percentile]}`}>
                    {sub.percentile}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden mb-2">
                  <div
                    className={`h-full rounded-full ${DIM_COLOR[sub.key]} transition-all`}
                    style={{ width: `${sub.score}%` }}
                  />
                </div>
                <p className="text-xs text-slate-600 mb-2">{sub.description}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {sub.strengths.slice(0, 2).map((s) => (
                    <p key={s} className="text-xs text-emerald-700 flex items-start gap-1">
                      <span className="shrink-0 mt-0.5">✓</span>{s}
                    </p>
                  ))}
                  {sub.growthAreas.slice(0, 2).map((g) => (
                    <p key={g} className="text-xs text-orange-700 flex items-start gap-1">
                      <span className="shrink-0 mt-0.5">↑</span>{g}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Full strength & growth detail */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {subDimensions.map((sub) => (
          <Card key={sub.key}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-sm font-bold ${DIM_TEXT[sub.key]}`}>
                {sub.key} · Tüm Güçler & Gelişim
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {sub.strengths.map((s) => (
                <p key={s} className="text-xs text-emerald-700">✓ {s}</p>
              ))}
              <hr className="my-1" />
              {sub.growthAreas.map((g) => (
                <p key={g} className="text-xs text-orange-700">↑ {g}</p>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
