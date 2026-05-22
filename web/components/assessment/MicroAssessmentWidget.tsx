'use client';

import { useState, useEffect } from 'react';
import { useQuestions, useMyProgress, useSubmitResponses, type Question } from '@/hooks/useAssessment';
import { getSession } from '@/lib/session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Oturum yoksa veya tüm sorular cevaplanmışsa widget görünmez.
// Her oturumda tek bir soru gösterilir — "yüzükteki taş" prensibi.

const DISC_LABELS: Record<string, string> = {
  D: '🔴', I: '🟡', S: '🟢', C: '🔵', GENERAL: '⚪',
};

function ProgressRing({ pct }: { pct: number }) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width="52" height="52" viewBox="0 0 52 52">
      <circle cx="26" cy="26" r={r} fill="none" stroke="#e2e8f0" strokeWidth="5" />
      <circle
        cx="26" cy="26" r={r} fill="none"
        stroke="#3b82f6" strokeWidth="5"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 26 26)"
      />
      <text x="26" y="30" textAnchor="middle" fontSize="10" fontWeight="600" fill="#1e293b">
        %{pct}
      </text>
    </svg>
  );
}

function LikertRow({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-700 leading-snug">
        <span className="mr-1">{DISC_LABELS[question.discDimension]}</span>
        {question.text}
      </p>
      <div className="flex gap-2 items-center">
        <span className="text-xs text-slate-400 w-20 shrink-0">Hiç katılmam</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={[
              'w-8 h-8 rounded-full text-xs font-semibold border transition-all',
              value === n
                ? 'bg-blue-600 text-white border-blue-600 scale-110 shadow'
                : 'bg-white text-slate-500 border-slate-300 hover:border-blue-400',
            ].join(' ')}
          >
            {n}
          </button>
        ))}
        <span className="text-xs text-slate-400 w-20 shrink-0 text-right">Tamamen katılırım</span>
      </div>
    </div>
  );
}

export function MicroAssessmentWidget() {
  const session = getSession();
  const { data: progress } = useMyProgress();
  const { data: allQuestions } = useQuestions();
  const submit = useSubmitResponses();

  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});

  // Tamamlanmamış ilk 3 CORE soruyu göster (micro-batch)
  const BATCH = 3;
  const unanswered: Question[] = [];
  if (allQuestions && progress !== undefined) {
    const answeredCount = progress.answered;
    // Sırasıyla CORE soruları önce, ardından DEEPENING
    const sorted = [...allQuestions.items].sort(
      (a, b) => (a.type === b.type ? a.order - b.order : a.type === 'CORE' ? -1 : 1),
    );
    // answered ID'lerini bilmiyoruz — basit heuristic: ilk BATCH unanswered'ı al
    // (gerçek prod'da /my-responses'dan ID'ler de dönmeli)
    for (const q of sorted) {
      if (unanswered.length >= BATCH) break;
      if (!answers[q.id]) unanswered.push(q);
    }
  }

  // Profil %100 ise ya da oturum yoksa render etme
  if (!session || (progress && progress.completionRate >= 100)) return null;

  // Auto-open: 3 saniye sonra bir kez
  useEffect(() => {
    const t = setTimeout(() => {
      if (!dismissed) setOpen(true);
    }, 3000);
    return () => clearTimeout(t);
  }, [dismissed]);

  const allAnswered = unanswered.length > 0 && unanswered.every((q) => answers[q.id] !== undefined);

  async function handleSubmit() {
    const payload = Object.entries(answers).map(([questionId, value]) => ({ questionId, value }));
    if (payload.length === 0) return;
    await submit.mutateAsync(payload);
    setAnswers({});
    setOpen(false);
  }

  return (
    <>
      {/* Floating trigger butonu */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-lg transition-all"
        >
          <span>🧠</span>
          <span>Mizaç Derinleştirme</span>
          {progress && (
            <span className="bg-white/20 rounded-full px-1.5 text-xs">
              %{progress.completionRate}
            </span>
          )}
        </button>
      )}

      {/* Widget paneli */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[420px] max-w-[calc(100vw-2rem)]">
          <Card className="shadow-2xl border-blue-100">
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-3">
                {progress && <ProgressRing pct={progress.completionRate} />}
                <div>
                  <CardTitle className="text-sm">Mizaç Derinleştirme</CardTitle>
                  <p className="text-xs text-slate-500">
                    {progress
                      ? `${progress.remaining} soru kaldı — her yanıt eşleşme skorunuzu geliştirir`
                      : 'Profil yükleniyor...'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => { setOpen(false); setDismissed(true); }}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none ml-2"
              >
                ×
              </button>
            </CardHeader>

            <CardContent className="space-y-4 pt-2">
              {unanswered.length === 0 ? (
                <p className="text-sm text-center text-slate-400 py-4">
                  Tüm sorular tamamlandı! 🎉
                </p>
              ) : (
                <>
                  {unanswered.map((q) => (
                    <LikertRow
                      key={q.id}
                      question={q}
                      value={answers[q.id]}
                      onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
                    />
                  ))}

                  <div className="flex gap-2 justify-end pt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setOpen(false); setDismissed(true); }}
                    >
                      Daha sonra
                    </Button>
                    <Button
                      size="sm"
                      disabled={!allAnswered || submit.isPending}
                      onClick={handleSubmit}
                    >
                      {submit.isPending ? 'Kaydediliyor...' : 'Kaydet →'}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
