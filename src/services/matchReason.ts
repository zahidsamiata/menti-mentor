/**
 * Eşleşme Gerekçesi Servisi
 * Fallback: deterministic template
 * Retry: üstel geri çekilme (llmRetry.ts)
 * Tip güvenli: OpenAI yanıt şekli arayüzlerle modellendi
 */

import { config } from '../config.js';
import { logger } from './logger.js';
import { fetchWithRetry } from './llmRetry.js';
import type { ScoreBreakdown } from './scoring.js';

export type MatchReasonArgs = {
  mentorName: string;
  mentiName: string;
  mentorSectorTags: string[];
  mentiSectorTags: string[];
  mentorDiscType?: string | null;
  mentiDiscType?: string | null;
  scoreBreakdown: ScoreBreakdown;
  tenantVocabulary?: { formalStyle?: boolean; greeting?: string } | null;
};

export type MatchReasonResult = {
  reason: string;
  generatedBy: 'llm' | 'fallback';
  sectorOverlapCount: number;
  sharedTags: string[];
};

interface OpenAiContentItem { type: string; text?: string; }
interface OpenAiResponseBody {
  output?: Array<{ content?: OpenAiContentItem[] }>;
  output_text?: string;
}

function findSharedTags(a: string[], b: string[]): string[] {
  const bSet = new Set(b.map((t) => t.toLowerCase()));
  return a.filter((t) => bSet.has(t.toLowerCase()));
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'çok yüksek';
  if (score >= 60) return 'yüksek';
  if (score >= 40) return 'orta';
  return 'düşük';
}

function buildFallbackReason(args: MatchReasonArgs): MatchReasonResult {
  const sharedTags = findSharedTags(args.mentiSectorTags, args.mentorSectorTags);
  const formal = args.tenantVocabulary?.formalStyle ?? false;
  const sectorPart = sharedTags.length > 0
    ? `${sharedTags.slice(0, 3).join(', ')} alanlarında %${args.scoreBreakdown.sectorScore.toFixed(0)} sektörel örtüşme`
    : 'genel kariyer hedefleri uyumu';
  const discPart = args.mentorDiscType && args.mentiDiscType
    ? `${args.mentorDiscType}-${args.mentiDiscType} mizaç uyumu (%${args.scoreBreakdown.discScore.toFixed(0)})`
    : `mizaç uyumu skoru: %${args.scoreBreakdown.discScore.toFixed(0)}`;
  const totalLabel = scoreLabel(args.scoreBreakdown.totalScore);
  const reason = formal
    ? `Bu eşleştirme, ${sectorPart} ve ${discPart} temelinde ${totalLabel} uyum skoru (${args.scoreBreakdown.totalScore.toFixed(1)}/100) ile gerçekleştirilmiştir.`
    : `${args.mentorName} ile eşleşmeniz ${sectorPart} ve ${discPart} değerlendirildiğinde ${totalLabel} uyum gösteriyor (toplam skor: ${args.scoreBreakdown.totalScore.toFixed(1)}/100).`;
  return { reason, generatedBy: 'fallback', sectorOverlapCount: sharedTags.length, sharedTags };
}

export async function generateMatchReason(args: MatchReasonArgs): Promise<MatchReasonResult> {
  const sharedTags = findSharedTags(args.mentiSectorTags, args.mentorSectorTags);
  if (config.llm.provider !== 'openai' || !config.llm.openaiApiKey) {
    return buildFallbackReason(args);
  }
  const formal = args.tenantVocabulary?.formalStyle ?? false;
  const prompt = [
    `Mentor-menti eşleştirme karar gerekçesini 2-3 cümleyle Türkçe açıkla.`,
    formal ? 'Üslup: resmi ve saygılı.' : 'Üslup: samimi ama profesyonel.',
    `Ortak sektörler: ${sharedTags.slice(0, 3).join(', ') || 'yok'}`,
    `Sektör uyum: %${args.scoreBreakdown.sectorScore.toFixed(0)} (60% ağırlık)`,
    `Mizaç: Mentor ${args.mentorDiscType ?? '?'} / Menti ${args.mentiDiscType ?? '?'} → %${args.scoreBreakdown.discScore.toFixed(0)} (40% ağırlık)`,
    `Toplam: ${args.scoreBreakdown.totalScore.toFixed(1)}/100`,
    `Kural: isim kullanma, emoji yok, sayıları dahil et.`,
  ].join('\n');

  let res: Response;
  try {
    res = await fetchWithRetry(() =>
      fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.llm.openaiApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.llm.openaiModel, input: prompt, max_output_tokens: 120 }),
      }),
    );
  } catch (networkErr) {
    void logger.warn('ML', 'MatchReason LLM ağ hatası — fallback', { error: String(networkErr) });
    return buildFallbackReason(args);
  }

  if (!res.ok) {
    void logger.warn('ML', 'MatchReason LLM HTTP hatası — fallback', { status: res.status });
    return buildFallbackReason(args);
  }

  const json = (await res.json()) as OpenAiResponseBody;
  const text = json.output?.[0]?.content?.find((c) => c.type === 'output_text')?.text ?? json.output_text ?? '';
  const cleaned = String(text).trim();
  if (!cleaned.length) {
    void logger.warn('ML', 'MatchReason LLM boş yanıt — fallback');
    return buildFallbackReason(args);
  }
  return { reason: cleaned, generatedBy: 'llm', sectorOverlapCount: sharedTags.length, sharedTags };
}
