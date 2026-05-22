import { config } from '../config.js';

// Expectation category label map (Turkish, user-friendly)
const EXPECTATION_LABELS: Record<string, string> = {
  KARIYER_YONLENDIRME: 'kariyer yönlendirmesi',
  TEKNIK_BECERI: 'teknik beceri gelişimi',
  IS_STAJ_BAGLANTISI: 'iş / staj bağlantısı',
  GIRISIMCILIK: 'girişimcilik',
  KISISEL_GELISIM: 'kişisel gelişim',
  SEKTOR_TANIMA: 'sektör tanıma',
};

// DISC combination → communication style hint (Turkish)
function discStyleHint(mentorDisc?: string | null, mentiDisc?: string | null): string | null {
  if (!mentorDisc || !mentiDisc) return null;
  const pair = `${mentorDisc}_${mentiDisc}`;
  const hints: Record<string, string> = {
    D_D: 'doğrudan ve sonuç odaklı bir iletişim',
    D_C: 'doğrudan ve analitik bir iletişim',
    D_I: 'enerjik ve hedef odaklı bir iletişim',
    D_S: 'net ve destekleyici bir iletişim',
    I_I: 'sıcak ve ilham verici bir iletişim',
    I_D: 'dinamik ve odak yüksek bir iletişim',
    I_S: 'sıcak ve empatik bir iletişim',
    I_C: 'yaratıcı ve detay dengeli bir iletişim',
    S_S: 'sabırlı ve güven temelli bir iletişim',
    S_D: 'destekleyici ve verimli bir iletişim',
    S_I: 'sıcak ve pratik bir iletişim',
    S_C: 'dikkatli ve yapılandırılmış bir iletişim',
    C_C: 'analitik ve sistematik bir iletişim',
    C_D: 'veriye dayalı ve kararlı bir iletişim',
    C_I: 'titiz ve ilham dengeli bir iletişim',
    C_S: 'metodolojik ve destekleyici bir iletişim',
  };
  return hints[pair] ?? null;
}

// Tenant vocabulary şeması:
// { greeting?: string; signOff?: string; formalStyle?: boolean }
// Örnek: { greeting: "Selamünaleyküm", signOff: "Saygılarımızla", formalStyle: true }
type TenantVocabulary = {
  greeting?: string;
  signOff?: string;
  formalStyle?: boolean;
};

export async function generateIceBreaker(args: {
  mentorName: string;
  mentiName: string;
  sharedTopics: string[];
  // Optional enrichment (use when available)
  mentiExpectations?: string[];
  mentiSkills?: string[];
  mentorDiscType?: string | null;
  mentiDiscType?: string | null;
  interactionStyleMatch?: boolean;
  // Tenant-aware AI vocabulary
  tenantVocabulary?: TenantVocabulary | null;
}): Promise<string> {
  if (config.llm.provider !== 'openai') {
    return fallbackIceBreaker(args);
  }

  if (!config.llm.openaiApiKey) {
    return fallbackIceBreaker(args);
  }

  const vocab = args.tenantVocabulary ?? {};
  const greeting = vocab.greeting ?? 'Merhaba';
  const signOff = vocab.signOff ?? null;
  const formalStyle = vocab.formalStyle ?? false;

  const lines: string[] = [
    `İki cümlelik, sıcak, kısa bir başlangıç mesajı yaz.`,
    `Selamlama: "${greeting}"`,
    formalStyle ? 'Üslup: resmi ve saygılı' : 'Üslup: samimi ama profesyonel',
    signOff ? `Kapanış: "${signOff}"` : '',
    `Mentor: ${args.mentorName}`,
    `Menti: ${args.mentiName}`,
    `Ortak başlıklar: ${args.sharedTopics.slice(0, 3).join(', ') || 'yok'}`,
  ].filter(Boolean);

  if (args.mentiExpectations && args.mentiExpectations.length > 0) {
    const labels = args.mentiExpectations
      .map(e => EXPECTATION_LABELS[e] ?? e)
      .join(', ');
    lines.push(`Menti hedefleri: ${labels}`);
  }

  if (args.mentiSkills && args.mentiSkills.length > 0) {
    lines.push(`Menti becerileri: ${args.mentiSkills.slice(0, 3).join(', ')}`);
  }

  const styleHint = discStyleHint(args.mentorDiscType, args.mentiDiscType);
  if (styleHint) {
    lines.push(`İletişim tarzı ipucu: ${styleHint}`);
  }

  if (args.interactionStyleMatch === true) {
    lines.push(`Not: İkisi de aynı çalışma stilini tercih ediyor.`);
  }

  lines.push(`Kurallar: 2 cümle, Türkçe, emoji yok.`);

  const prompt = lines.join('\n');

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.llm.openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.llm.openaiModel,
      input: prompt,
      max_output_tokens: 80,
    }),
  });

  if (!res.ok) {
    return fallbackIceBreaker(args);
  }

  const json = (await res.json()) as any;
  const text =
    json?.output?.[0]?.content?.find?.((c: any) => c?.type === 'output_text')?.text ??
    json?.output_text ??
    '';

  const cleaned = String(text).trim();
  return cleaned.length ? cleaned : fallbackIceBreaker(args);
}

function fallbackIceBreaker(args: {
  mentorName: string;
  mentiName: string;
  sharedTopics: string[];
  mentiExpectations?: string[];
  mentiSkills?: string[];
  mentorDiscType?: string | null;
  mentiDiscType?: string | null;
  interactionStyleMatch?: boolean;
  tenantVocabulary?: TenantVocabulary | null;
}): string {
  const vocab = args.tenantVocabulary ?? {};
  const greeting = vocab.greeting ?? 'Merhaba';
  const topic = args.sharedTopics[0];
  const firstExpectation = args.mentiExpectations?.[0];
  const expectationLabel = firstExpectation
    ? EXPECTATION_LABELS[firstExpectation] ?? firstExpectation
    : null;

  if (topic) {
    if (expectationLabel) {
      return `${greeting} ${args.mentiName}, ${args.mentorName} ile ${topic} odağında kısa bir başlangıç yapabilirsiniz. ${expectationLabel} alanındaki hedefini paylaşarak başlayabilirsin.`;
    }
    return `${greeting} ${args.mentiName}, ${args.mentorName} ile ${topic} odağında kısa bir başlangıç yapabilirsiniz. İlk adım olarak mevcut hedefini ve bu alanda neyi netleştirmek istediğini paylaşman çok iyi olur.`;
  }

  if (expectationLabel) {
    return `${greeting} ${args.mentiName}, ${args.mentorName} ile tanıştığın için memnun. ${expectationLabel} alanındaki hedefini paylaşarak başlayabilirsin.`;
  }

  return `${greeting} ${args.mentiName}, ${args.mentorName} ile tanıştığın için memnun. İlk görüşmede hedefini ve bu mentorluktan en somut ne kazanmak istediğini 1-2 maddeyle paylaşarak başlayabilirsin.`;
}
