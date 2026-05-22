'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useSubmitFeedback } from '@/hooks/useMeetings';
import type { Meeting } from '@/types/api';

interface ScoreInputProps {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
}

function ScoreInput({ label, value, onChange }: ScoreInputProps) {
  return (
    <div className="space-y-1">
      <Label className="text-sm">{label}</Label>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`w-8 h-8 rounded-full text-sm font-semibold border transition-colors
              ${value === n
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-500 border-slate-300 hover:border-slate-500'
              }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

interface Props {
  meeting: Meeting;
  role: 'ADMIN' | 'MENTOR' | 'MENTI';
  onClose: () => void;
}

export function FeedbackForm({ meeting, role, onClose }: Props) {
  const submit = useSubmitFeedback(meeting.id);

  // Mentor → Menti puanları
  const [preparednessScore, setPreparednessScore] = useState<number | undefined>();
  const [proactivityScore, setProactivityScore] = useState<number | undefined>();

  // Menti → Mentor puanları
  const [guidanceScore, setGuidanceScore] = useState<number | undefined>();
  const [resourceSharingScore, setResourceSharingScore] = useState<number | undefined>();
  const [trustScore, setTrustScore] = useState<number | undefined>();

  const [keyLearnings, setKeyLearnings] = useState('');
  const [specificComments, setSpecificComments] = useState('');

  const isMentor = role === 'MENTOR' || role === 'ADMIN';
  const isMenti = role === 'MENTI' || role === 'ADMIN';

  const lowPreparedness = preparednessScore !== undefined && preparednessScore <= 2;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {};
    if (isMentor) {
      if (preparednessScore !== undefined) payload.preparednessScore = preparednessScore;
      if (proactivityScore !== undefined) payload.proactivityScore = proactivityScore;
    }
    if (isMenti) {
      if (guidanceScore !== undefined) payload.guidanceScore = guidanceScore;
      if (resourceSharingScore !== undefined) payload.resourceSharingScore = resourceSharingScore;
      if (trustScore !== undefined) payload.trustScore = trustScore;
    }
    if (keyLearnings) payload.keyLearnings = keyLearnings;
    if (specificComments) payload.specificComments = specificComments;

    await submit.mutateAsync(payload);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Geri Bildirim Formu</DialogTitle>
          <p className="text-xs text-slate-500">
            {meeting.menti.fullName} & {meeting.mentor.fullName}
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Mentor → Menti */}
          {isMentor && (
            <div className="space-y-3 rounded-lg bg-blue-50 p-3">
              <p className="text-xs font-semibold text-blue-700 uppercase">Mentor → Menti Değerlendirmesi</p>
              <ScoreInput label="Hazırlık Puanı" value={preparednessScore} onChange={setPreparednessScore} />
              <ScoreInput label="Proaktiflik Puanı" value={proactivityScore} onChange={setProactivityScore} />
              {lowPreparedness && (
                <p className="text-xs text-red-600 bg-red-50 rounded p-2">
                  ⚠️ Hazırlık puanı ≤ 2: Bu menti oryantasyon kilidine alınacak.
                </p>
              )}
            </div>
          )}

          {/* Menti → Mentor */}
          {isMenti && (
            <div className="space-y-3 rounded-lg bg-green-50 p-3">
              <p className="text-xs font-semibold text-green-700 uppercase">Menti → Mentor Değerlendirmesi</p>
              <ScoreInput label="Yönlendirme Puanı" value={guidanceScore} onChange={setGuidanceScore} />
              <ScoreInput label="Kaynak Paylaşımı" value={resourceSharingScore} onChange={setResourceSharingScore} />
              <ScoreInput label="Güven Puanı" value={trustScore} onChange={setTrustScore} />
            </div>
          )}

          {/* Nitel */}
          <div className="space-y-2">
            <Label htmlFor="keyLearnings" className="text-sm">Önemli Çıkarımlar</Label>
            <textarea
              id="keyLearnings"
              className="w-full rounded-md border border-slate-200 p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-slate-300"
              rows={2}
              maxLength={1000}
              value={keyLearnings}
              onChange={(e) => setKeyLearnings(e.target.value)}
              placeholder="Bu toplantıdan ne öğrendim..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="comments" className="text-sm">Ek Yorumlar</Label>
            <textarea
              id="comments"
              className="w-full rounded-md border border-slate-200 p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-slate-300"
              rows={2}
              maxLength={1000}
              value={specificComments}
              onChange={(e) => setSpecificComments(e.target.value)}
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>İptal</Button>
            <Button type="submit" disabled={submit.isPending}>
              {submit.isPending ? 'Gönderiliyor...' : 'Gönder'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
