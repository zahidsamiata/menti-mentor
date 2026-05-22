import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { OrientationBadge } from './OrientationBadge';
import type { RankedMenti } from '@/types/api';

const discMeta = {
  D: { label: 'Dominant', color: 'bg-red-100 text-red-700', emoji: '🔴' },
  I: { label: 'Etkili', color: 'bg-yellow-100 text-yellow-700', emoji: '🟡' },
  S: { label: 'Kararlı', color: 'bg-green-100 text-green-700', emoji: '🟢' },
  C: { label: 'Vicdanlı', color: 'bg-blue-100 text-blue-700', emoji: '🔵' },
};

interface Props {
  menti: RankedMenti;
  onOptIn?: () => void;
  optInLoading?: boolean;
}

export function ProfileCard({ menti, onOptIn, optInLoading }: Props) {
  const disc = menti.discType ? discMeta[menti.discType] : null;
  const scoreColor =
    menti.score >= 80 ? 'text-green-600' : menti.score >= 60 ? 'text-yellow-600' : 'text-red-500';

  return (
    <Card className="w-full max-w-sm hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{menti.fullName}</CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">{menti.email}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`text-2xl font-bold ${scoreColor}`}>{menti.score}</span>
            <span className="text-xs text-slate-400">uyum skoru</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* DISC Rozet */}
        {disc && (
          <div className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${disc.color}`}>
            {disc.emoji} DISC-{menti.discType} — {disc.label}
          </div>
        )}

        {/* Oryantasyon kilidi */}
        {menti.needsOrientation && <OrientationBadge active compact />}

        {/* Bio */}
        {menti.bioSummary && (
          <p className="text-xs text-slate-600 line-clamp-2">{menti.bioSummary}</p>
        )}

        {/* Sektör etiketleri */}
        {menti.sectorTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {menti.sectorTags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
            ))}
          </div>
        )}

        {/* Beceriler */}
        {menti.skills.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {menti.skills.slice(0, 4).map((s) => (
              <span key={s} className="text-xs bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{s}</span>
            ))}
          </div>
        )}

        {/* Ice-breaker */}
        {menti.iceBreaker ? (
          <div className="rounded-md bg-blue-50 border border-blue-100 p-2">
            <p className="text-xs text-blue-700 italic">💬 {menti.iceBreaker}</p>
          </div>
        ) : (
          <button
            className="w-full text-xs text-slate-500 border border-dashed rounded-md py-2 hover:bg-slate-50 transition-colors disabled:opacity-50"
            onClick={onOptIn}
            disabled={optInLoading || menti.needsOrientation}
          >
            {optInLoading ? 'İşleniyor...' : '+ Görünürlük Opt-in Başlat'}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
