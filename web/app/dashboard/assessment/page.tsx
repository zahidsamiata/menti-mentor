'use client';

import { useState, useEffect } from 'react';
import { useSession } from '@/hooks/useSession';
import {
  useQuestions,
  useMyProgress,
  useSubmitResponses,
  type Question,
  type DiscVector,
} from '@/hooks/useAssessment';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

type DimKey = 'D' | 'I' | 'S' | 'C' | 'GENERAL';

const DIM_LABEL: Record<DimKey, string> = {
  D: 'Dominant — Karar Verme & Liderlik',
  I: 'Influential — İletişim & İkna',
  S: 'Steady — Sabır & Güvenilirlik',
  C: 'Conscientious — Analiz & Kalite',
  GENERAL: 'Genel Profil',
};

const DIM_COLOR: Record<DimKey, string> = {
  D: 'bg-red-500',
  I: 'bg-yellow-400',
  S: 'bg-green-500',
  C: 'bg-blue-500',
  GENERAL: 'bg-slate-400',
};

const DIM_TEXT: Record<DimKey, string> = {
  D: 'text-red-600',
  I: 'text-yellow-600',
  S: 'text-green-600',
  C: 'text-blue-600',
  GENERAL: 'text-slate-600',
};

const BATCH_SIZE = 5;

function ProgressBar({ answered, total }: { answered: number; total: number }) {
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-slate-500">
        <span>{answered} / {total} soru tamamlandı</span>
        <span>%{pct}</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function LikertScale({
  question,
  selectedValue,
  onSelect,
}: {
  question: Question;
  selectedValue: number | undefined;
  onSelect: (value: number) => void;
}) {
  const dim = question.discDimension as DimKey;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <span className={`inline-block w-2 h-2 rounded-full mt-1.5 shrink-0 ${DIM_COLOR[dim]}`} />
        <div>
          <p className="text-sm font-medium text-slate-800 leading-snug">{question.text}</p>
          <p className={`text-xs mt-0.5 ${DIM_TEXT[dim]}`}>{DIM_LABEL[dim]}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-400 text-center leading-tight w-16 shrink-0">
          Hiç katılmıyorum
        </span>
        <div className="flex gap-2 flex-1 justify-center">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onSelect(n)}
              className={[
                'w-10 h-10 rounded-full text-sm font-bold border-2 transition-all duration-150',
                selectedValue === n
                  ? `${DIM_COLOR[dim].replace('bg-', 'bg-')} text-white border-transparent scale-110 shadow-md`
                  : 'bg-white text-slate-500 border-slate-200 hover:border-blue-400 hover:text-blue-600',
              ].join(' ')}
            >
              {n}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400 text-center leading-tight w-16 shrink-0">
          Tamamen katılıyorum
        </span>
      </div>
    </div>
  );
}

function DiscVectorResult({ vector }: { vector: DiscVector }) {
  const dims: Array<{ key: keyof Omit<DiscVector, 'confidence'>; label: string; color: string }> = [
    { key: 'D', label: 'Dominant', color: '#ef4444' },
    { key: 'I', label: 'Influential', color: '#ca8a04' },
    { key: 'S', label: 'Steady', color: '#16a34a' },
    { key: 'C', label: 'Conscientious', color: '#2563eb' },
  ];

  const dominant = dims.reduce((max, d) => (vector[d.key] > vector[max.key] ? d : max), dims[0]);

  return (
    <Card className="border-2 border-blue-100 bg-blue-50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Güncel DISC Profil Tahmini</CardTitle>
        <p className="text-xs text-slate-500">
          Güven seviyesi: %{Math.round(vector.confidence * 100)} · Dominant:{' '}
          <strong style={{ color: dominant.color }}>{dominant.key} — {dominant.label}</strong>
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {dims.map(({ key, label, color }) => {
          const pct = Math.round(vector[key] * 100);
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="text-xs font-bold w-4" style={{ color }}>{key}</span>
              <div className="flex-1 h-3 bg-white rounded-full overflow-hidden border border-slate-200">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
              <span className="text-xs text-slate-500 w-10 text-right">{pct}%</span>
              <span className="text-xs text-slate-400 hidden sm:inline">{label}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default function AssessmentPage() {
  const { session, loading } = useSession();
  const { data: progressData, isLoading: progressLoading } = useMyProgress();
  const { data: questionsData, isLoading: questionsLoading } = useQuestions();
  const submitMutation = useSubmitResponses();

  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [currentBatchOffset, setCurrentBatchOffset] = useState(0);
  const [lastDiscVector, setLastDiscVector] = useState<DiscVector | null>(null);
  const [batchSubmitCount, setBatchSubmitCount] = useState(0);

  const isPageLoading = loading || progressLoading || questionsLoading;

  const sortedQuestions: Question[] = questionsData
    ? [...questionsData.items].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'CORE' ? -1 : 1;
        return a.order - b.order;
      })
    : [];

  const unansweredQuestions = sortedQuestions.filter((q) => answers[q.id] === undefined);
  const currentBatch = unansweredQuestions.slice(currentBatchOffset, currentBatchOffset + BATCH_SIZE);
  const isCurrentBatchComplete = currentBatch.length > 0 && currentBatch.every((q) => answers[q.id] !== undefined);
  const isAllDone = progressData ? progressData.completionRate >= 100 && batchSubmitCount === 0 : false;

  useEffect(() => {
    setCurrentBatchOffset(0);
  }, [batchSubmitCount]);

  async function handleBatchSubmit() {
    const payload = currentBatch.map((q) => ({ questionId: q.id, value: answers[q.id] }));
    const result = await submitMutation.mutateAsync(payload);
    setLastDiscVector(result.discVector);
    setBatchSubmitCount((n) => n + 1);
    const newAnswers = { ...answers };
    payload.forEach(({ questionId }) => delete newAnswers[questionId]);
    setAnswers(newAnswers);
  }

  if (isPageLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full" />
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">DISC Mizaç Değerlendirmesi</h1>
        <p className="text-sm text-slate-500 mt-1">
          Her soruya ne kadar katıldığınızı 1–5 arasında işaretleyin. Yanıtlarınız eşleşme
          kalitesini doğrudan etkiler.
        </p>
      </div>

      {progressData && (
        <ProgressBar answered={progressData.answered} total={progressData.total} />
      )}

      {lastDiscVector && <DiscVectorResult vector={lastDiscVector} />}

      {isAllDone ? (
        <Card className="border-2 border-emerald-200 bg-emerald-50">
          <CardContent className="py-8 text-center">
            <p className="text-4xl mb-2">🎉</p>
            <p className="text-lg font-semibold text-emerald-800">Tüm sorular tamamlandı!</p>
            <p className="text-sm text-emerald-600 mt-1">
              DISC profiliniz güncellendi. Analitik sayfasında detaylı raporunuzu görebilirsiniz.
            </p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => { window.location.href = '/dashboard/analytics'; }}
            >
              Analitikleri Görüntüle →
            </Button>
          </CardContent>
        </Card>
      ) : currentBatch.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-slate-400 text-sm">
            Yükleniyor veya tamamlanacak soru kalmadı.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Soru Grubu {Math.floor(currentBatchOffset / BATCH_SIZE) + 1}
              </CardTitle>
              <Badge variant="outline" className="text-xs">
                {currentBatch.filter((q) => answers[q.id] !== undefined).length}/{currentBatch.length} yanıtlandı
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {currentBatch.map((question) => (
              <LikertScale
                key={question.id}
                question={question}
                selectedValue={answers[question.id]}
                onSelect={(value) =>
                  setAnswers((prev) => ({ ...prev, [question.id]: value }))
                }
              />
            ))}

            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-400">
                {unansweredQuestions.length - currentBatch.length} soru daha kaldı
              </p>
              <Button
                disabled={!isCurrentBatchComplete || submitMutation.isPending}
                onClick={handleBatchSubmit}
              >
                {submitMutation.isPending
                  ? 'Kaydediliyor…'
                  : unansweredQuestions.length <= BATCH_SIZE
                  ? 'Tamamla →'
                  : 'Kaydet & Devam →'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
