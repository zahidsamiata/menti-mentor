import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Meeting, MeetingStatus } from '@/types/api';

const statusMeta: Record<MeetingStatus, { label: string; color: string }> = {
  PENDING:   { label: 'Bekliyor',   color: 'bg-yellow-100 text-yellow-700' },
  APPROVED:  { label: 'Onaylandı',  color: 'bg-blue-100 text-blue-700' },
  COMPLETED: { label: 'Tamamlandı', color: 'bg-green-100 text-green-700' },
  CANCELLED: { label: 'İptal',      color: 'bg-red-100 text-red-700' },
};

interface Props {
  meetings: Meeting[];
  role: 'ADMIN' | 'MENTOR' | 'MENTI';
  onUpdateStatus?: (id: string, status: string) => void;
  onFeedback?: (meeting: Meeting) => void;
  updatingId?: string;
}

export function MeetingTimeline({ meetings, role, onUpdateStatus, onFeedback, updatingId }: Props) {
  if (meetings.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400 text-sm">
        Henüz toplantı bulunmuyor.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {meetings.map((m) => {
        const meta = statusMeta[m.status];
        const date = new Date(m.scheduledAt).toLocaleString('tr-TR', {
          day: 'numeric', month: 'long', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });

        return (
          <Card key={m.id}>
            <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center gap-3">
              {/* Sol: tarih + taraflar */}
              <div className="flex-1 space-y-1">
                <p className="text-sm font-semibold text-slate-800">{date}</p>
                <p className="text-xs text-slate-500">
                  Mentor: <span className="font-medium">{m.mentor.fullName}</span>
                  {' · '}
                  Menti: <span className="font-medium">{m.menti.fullName}</span>
                </p>
              </div>

              {/* Durum rozeti */}
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${meta.color}`}>
                {meta.label}
              </span>

              {/* Aksiyon butonları */}
              <div className="flex gap-2 shrink-0">
                {role === 'MENTOR' && m.status === 'PENDING' && (
                  <>
                    <Button
                      size="sm"
                      disabled={updatingId === m.id}
                      onClick={() => onUpdateStatus?.(m.id, 'APPROVED')}
                    >
                      Onayla
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updatingId === m.id}
                      onClick={() => onUpdateStatus?.(m.id, 'CANCELLED')}
                    >
                      Reddet
                    </Button>
                  </>
                )}
                {(role === 'MENTOR' || role === 'ADMIN') && m.status === 'APPROVED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={updatingId === m.id}
                    onClick={() => onUpdateStatus?.(m.id, 'COMPLETED')}
                  >
                    Tamamla
                  </Button>
                )}
                {m.status === 'COMPLETED' && !m.hasFeedback && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onFeedback?.(m)}
                  >
                    Geri Bildirim
                  </Button>
                )}
                {m.status === 'COMPLETED' && m.hasFeedback && (
                  <Badge variant="secondary" className="text-xs">✓ Feedback Verildi</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
