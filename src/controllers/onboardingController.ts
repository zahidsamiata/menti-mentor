import { z } from 'zod';
import type { Response } from 'express';
import type { RequestWithTenant } from '../types.js';
import { prisma } from '../db.js';

// ─── Sektor Tag Sanitizasyonu (userController.ts ile aynı kural seti) ─────────
const SECTOR_TAG_SCHEMA = z
  .string()
  .min(1)
  .max(50)
  .regex(
    /^[a-zA-Z0-9ğüşıöçĞÜŞİÖÇ\s\-&\/\.]+$/,
    'Etiket yalnızca harf, rakam, boşluk ve - & / . karakterlerini içerebilir.',
  )
  .transform((t) => t.trim().toLowerCase());

// ─── Türkçe Mizaç Arketip Kartları ───────────────────────────────────────────
// "Aha Anı" verisi — DISC testi sonrası kullanıcıya anında gösterilir.
// LinkedIn'de paylaşılabilir, kısa ve güçlü dil kullanılır.

const DISC_RESULT_CARDS: Record<string, {
  archetype:     string;
  icon:          string;
  superPower:    string;
  description:   string;
  shareHeadline: string;
  strengths:     string[];
  growthArea:    string;
  compatibleWith: string[];
}> = {
  D: {
    archetype:      'Öncü',
    icon:           '🦅',
    superPower:     'Kararları hızla alır ve harekete geçersin',
    description:    'Sen bir Öncüsün! Cesur, sonuç odaklı ve liderliği doğal bulan birisin. Engellerden yılmaz, hedefine emin adımlarla ilerlersin.',
    shareHeadline:  'DISC testine göre ben bir Öncüyüm! 🦅 #MentiMentor',
    strengths:      ['Hızlı karar verme', 'Liderlik', 'Sonuç odaklılık', 'Cesaret'],
    growthArea:     'Sabır ve aktif dinleme becerilerini geliştirerek daha güçlü, uzun soluklu ilişkiler kurabilirsin.',
    compatibleWith: ['S', 'C'],
  },
  I: {
    archetype:      'Ateşleyici',
    icon:           '🔥',
    superPower:     'İnsanlara ilham verir ve enerjin her ortamı dönüştürür',
    description:    'Sen bir Ateşleyicisin! Karizmatik, sosyal ve ilham verici birisin. Çevreni pozitif enerjinle doldurmak sana doğal gelir.',
    shareHeadline:  'DISC testine göre ben bir Ateşleyiciyim! 🔥 #MentiMentor',
    strengths:      ['İletişim', 'İkna', 'Motivasyon', 'Yaratıcılık'],
    growthArea:     'Detaylara odaklanma ve takip alışkanlıkları geliştirmek verimliliğini artırır.',
    compatibleWith: ['C', 'S'],
  },
  S: {
    archetype:      'Yapı Taşı',
    icon:           '🌿',
    superPower:     'Güven inşa eder ve çevrendekilere huzur verirsin',
    description:    'Sen bir Yapı Taşısın! Sabırlı, güvenilir ve uyum yaratan birisin. Olduğun yere istikrar ve sıcaklık getirirsin.',
    shareHeadline:  'DISC testine göre ben bir Yapı Taşıyım! 🌿 #MentiMentor',
    strengths:      ['Sabır', 'Güvenilirlik', 'Ekip uyumu', 'Dinleme'],
    growthArea:     'Kendi ihtiyaçlarını da öne çıkararak daha dengeli bir dinamik yaratabilirsin.',
    compatibleWith: ['D', 'I'],
  },
  C: {
    archetype:      'Kâşif',
    icon:           '🧭',
    superPower:     'Derinlemesine analiz eder ve gerçeği bulursun',
    description:    'Sen bir Kâşifsin! Meraklı, analitik ve mükemmeli arayan birisin. Karmaşık problemleri çözmek senin için heyecan vericidir.',
    shareHeadline:  'DISC testine göre ben bir Kâşifim! 🧭 #MentiMentor',
    strengths:      ['Analitik düşünce', 'Doğruluk', 'Problem çözme', 'Araştırma'],
    growthArea:     'Zaman zaman "yeterince iyi"yi kabul ederek harekete geçme hızını artırabilirsin.',
    compatibleWith: ['I', 'D'],
  },
};

// ─── Onboarding DISC Soru Bankası (8 Soru) ───────────────────────────────────
// Her seçenek bir DISC boyutuna karşılık gelir.
// Bu sorular bağımsız ve kendi içinde tamdır; Question DB modeli kullanılmaz.

const ONBOARDING_DISC_QUESTIONS = [
  {
    id: 1,
    text: 'Bir grup projesinde genellikle ne yaparsın?',
    options: {
      A: { disc: 'D' as const, text: 'Liderliği üstlenir, hızlıca hedef koyarım' },
      B: { disc: 'I' as const, text: 'Ekibi motive eder, enerji katarım' },
      C: { disc: 'S' as const, text: 'Grubun ihtiyaçlarını destekler, uyum sağlarım' },
      D: { disc: 'C' as const, text: 'Planı analiz eder, en doğru kararı veririm' },
    },
  },
  {
    id: 2,
    text: 'Birisi sana hata yaptığını söylediğinde ilk tepkin ne olur?',
    options: {
      A: { disc: 'D' as const, text: 'Doğruysa hemen kabul eder, çözüme odaklanırım' },
      B: { disc: 'I' as const, text: 'Tartışmak yerine ortamı yumuşatmaya çalışırım' },
      C: { disc: 'S' as const, text: 'Sakince dinler, kendi hissimi içimde işlerim' },
      D: { disc: 'C' as const, text: 'Detayları inceler, haklı olup olmadığımı değerlendiririm' },
    },
  },
  {
    id: 3,
    text: 'Boş zamanında ne yapmayı tercih edersin?',
    options: {
      A: { disc: 'D' as const, text: 'Yeni bir hedef koyar, onu tamamlarım' },
      B: { disc: 'I' as const, text: 'Arkadaşlarla vakit geçirir, yeni insanlar tanırım' },
      C: { disc: 'S' as const, text: 'Sevdiklerimle huzurlu bir ortamda dinlenirim' },
      D: { disc: 'C' as const, text: 'Merak ettiğim bir konuyu derinlemesine araştırırım' },
    },
  },
  {
    id: 4,
    text: 'Bir karar verirken en çok neye önem verirsin?',
    options: {
      A: { disc: 'D' as const, text: 'Hızlı ve sonuç odaklı hareket etmeye' },
      B: { disc: 'I' as const, text: 'Çevremdeki insanlar üzerindeki etkisine' },
      C: { disc: 'S' as const, text: 'İstikrar ve güven sağlayıp sağlamadığına' },
      D: { disc: 'C' as const, text: 'Verilerin ve mantığın neyi söylediğine' },
    },
  },
  {
    id: 5,
    text: 'Seni en iyi tanıyan arkadaşların seni nasıl tanımlar?',
    options: {
      A: { disc: 'D' as const, text: 'Kararlı, cesur, hedef odaklı' },
      B: { disc: 'I' as const, text: 'Enerjik, neşeli, sosyal' },
      C: { disc: 'S' as const, text: 'Sakin, güvenilir, sabırlı' },
      D: { disc: 'C' as const, text: 'Titiz, meraklı, analitik' },
    },
  },
  {
    id: 6,
    text: 'Bir sorunla karşılaştığında ilk adımın ne olur?',
    options: {
      A: { disc: 'D' as const, text: 'Hemen harekete geçer, çözüme odaklanırım' },
      B: { disc: 'I' as const, text: 'Çevremdekilerle konuşur, beyin fırtınası yaparım' },
      C: { disc: 'S' as const, text: 'Sakinleşir, adım adım ilerlerim' },
      D: { disc: 'C' as const, text: 'Tüm olasılıkları listeler, en doğru yolu bulurum' },
    },
  },
  {
    id: 7,
    text: 'Bir mentor olsaydın, en çok ne yapardın?',
    options: {
      A: { disc: 'D' as const, text: 'Menti için net hedefler koyar, hesap sorardım' },
      B: { disc: 'I' as const, text: 'Mentiyi ilham vererek motive eder, coşku katardım' },
      C: { disc: 'S' as const, text: 'Sabırla dinler, güvenli bir alan yaratırdım' },
      D: { disc: 'C' as const, text: 'Sistemli geri bildirimler verir, detayları gözden geçirirdim' },
    },
  },
  {
    id: 8,
    text: 'Hangi ödül seni daha çok mutlu eder?',
    options: {
      A: { disc: 'D' as const, text: '"Projeni en hızlı sen tamamladın!"' },
      B: { disc: 'I' as const, text: '"Seninle çalışmak çok keyifliydi!"' },
      C: { disc: 'S' as const, text: '"Sana her zaman güvenebilirim."' },
      D: { disc: 'C' as const, text: '"Analiz ettiğin her şey doğruydu."' },
    },
  },
] as const;

type QuestionId    = (typeof ONBOARDING_DISC_QUESTIONS)[number]['id'];
type OptionKey     = 'A' | 'B' | 'C' | 'D';
type DiscDimension = 'D' | 'I' | 'S' | 'C';

const VALID_QUESTION_IDS = new Set<number>(ONBOARDING_DISC_QUESTIONS.map((q) => q.id));

// ─── DISC Puanlama Motoru ─────────────────────────────────────────────────────

interface DiscResult {
  vector:   Record<DiscDimension, number>; // 0.00-1.00 normalize
  dominant: DiscDimension;
  scores:   Record<DiscDimension, number>; // ham sayım
}

// Eşit skor durumunda tiebreak sırası: D > I > S > C (temperamentAnalysis.ts ile tutarlı).
// Sabit sıra, JavaScript sort kararlılığına güvenmemek için explicit olarak uygulanır.
const DISC_TIEBREAK_ORDER: DiscDimension[] = ['D', 'I', 'S', 'C'];

function calculateDiscResult(
  answers: Array<{ questionId: number; selectedOption: string }>,
): DiscResult {
  const scores: Record<DiscDimension, number> = { D: 0, I: 0, S: 0, C: 0 };

  for (const answer of answers) {
    const question = ONBOARDING_DISC_QUESTIONS.find((q) => q.id === answer.questionId);
    if (!question) continue;

    const option = question.options[answer.selectedOption as OptionKey];
    if (!option) continue;

    scores[option.disc]++;
  }

  // Division-by-zero koruması: geçerli cevap yoksa 1 ile normalize et.
  // Zod min(6) bu durumu normalde engeller; bu guard ek bir kenet sağlar.
  const total = Object.values(scores).reduce((s, n) => s + n, 0) || 1;

  // NaN guard: normalleştirilmiş değerler sonlu (finite) değilse sıfıra sabitle.
  const safe = (n: number) => (Number.isFinite(n) ? n : 0);

  const vector: Record<DiscDimension, number> = {
    D: safe(Math.round((scores.D / total) * 100) / 100),
    I: safe(Math.round((scores.I / total) * 100) / 100),
    S: safe(Math.round((scores.S / total) * 100) / 100),
    C: safe(Math.round((scores.C / total) * 100) / 100),
  };

  // Explicit tiebreak: D > I > S > C (eşit puan durumunda deterministik sonuç)
  const dominant = DISC_TIEBREAK_ORDER.reduce<DiscDimension>(
    (best, dim) => (scores[dim]! > scores[best]! ? dim : best),
    'D',
  );

  return { vector, dominant, scores };
}

// ─── POST /api/users/profile/complete ────────────────────────────────────────

const EXPECTATION_CATEGORIES = [
  'KARIYER_YONLENDIRME',
  'TEKNIK_BECERI',
  'IS_STAJ_BAGLANTISI',
  'GIRISIMCILIK',
  'KISISEL_GELISIM',
  'SEKTOR_TANIMA',
] as const;

const TIME_COMMITMENTS = ['AYDA_1', 'AYDA_2_3', 'HAFTADA_1', 'HAFTADA_2_PLUS'] as const;
const INTERACTION_STYLES = ['GOREV_BAZLI', 'SOHBET_BAZLI'] as const;

const CompleteProfileSchema = z.object({
  sector:                SECTOR_TAG_SCHEMA,
  skills:                z.array(z.string().min(1).max(100)).max(30).default([]),
  experienceYears:       z.number().int().min(0).max(60),
  // Rol-spesifik alanlar (opsiyonel — menti ve mentor akışları bu endpoint'i paylaşır)
  expectationCategories: z.array(z.enum(EXPECTATION_CATEGORIES)).max(6).optional(),
  timeCommitment:        z.enum(TIME_COMMITMENTS).optional(),
  interactionStyle:      z.enum(INTERACTION_STYLES).optional(),
});

export async function completeProfile(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({
      error:   'KIMLIK_DOGRULANMADI',
      message: 'Bu işlem için giriş yapmanız gerekmektedir.',
    });
  }

  const parsed = CompleteProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const { sector, skills, experienceYears, expectationCategories, timeCommitment, interactionStyle } = parsed.data;

  const user = await prisma.user.findUnique({
    where:  { id: req.auth.userId },
    select: { id: true, sectorTags: true, selfProfile: true },
  });
  if (!user) {
    return res.status(404).json({ error: 'KULLANICI_BULUNAMADI', message: 'Kullanıcı bulunamadı.' });
  }

  // Sektörü mevcut etiket listesine ekle (tekrar varsa seti temizle)
  const mergedTags = [...new Set([...user.sectorTags, sector])];

  // experienceYears → selfProfile JSON bloğuna yaz (User modelinde ayrı alan yok)
  const existingSelf = (user.selfProfile as Record<string, unknown>) ?? {};
  const updatedSelf  = { ...existingSelf, experienceYears };

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      sectorTags:  mergedTags,
      skills,
      selfProfile: updatedSelf,
      // Rol-spesifik alanlar: yalnızca gönderilmişse güncelle
      ...(expectationCategories !== undefined && { expectationCategories }),
      ...(timeCommitment        !== undefined && { timeCommitment        }),
      ...(interactionStyle      !== undefined && { interactionStyle      }),
    },
    select: {
      id:                    true,
      fullName:              true,
      sectorTags:            true,
      skills:                true,
      selfProfile:           true,
      expectationCategories: true,
      timeCommitment:        true,
      interactionStyle:      true,
      updatedAt:             true,
    },
  });

  return res.json({
    message: 'Profil başarıyla tamamlandı.',
    user:    updated,
  });
}

// ─── POST /api/users/disc/submit ─────────────────────────────────────────────

const AnswerSchema = z.object({
  questionId:     z.number().int().refine(
    (id): id is QuestionId => VALID_QUESTION_IDS.has(id),
    { message: 'Geçersiz soru ID\'si.' },
  ),
  selectedOption: z.enum(['A', 'B', 'C', 'D']),
});

const SubmitDiscSchema = z.object({
  answers: z
    .array(AnswerSchema)
    .min(6, 'En az 6 soruyu yanıtlamanız gerekmektedir.')
    .max(8, 'En fazla 8 soru gönderilebilir.')
    .refine(
      (arr) => new Set(arr.map((a) => a.questionId)).size === arr.length,
      { message: 'Her soru yalnızca bir kez yanıtlanabilir.' },
    ),
});

export async function submitDiscTest(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({
      error:   'KIMLIK_DOGRULANMADI',
      message: 'Bu işlem için giriş yapmanız gerekmektedir.',
    });
  }

  const parsed = SubmitDiscSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const result     = calculateDiscResult(parsed.data.answers);
  const resultCard = DISC_RESULT_CARDS[result.dominant];

  // discResultCard: "Aha Anı" kartı + ham skorlar (debug ve analytics için)
  const discResultCard = {
    ...resultCard,
    dominant:    result.dominant,
    discVector:  result.vector,
    rawScores:   result.scores,
    completedAt: new Date().toISOString(),
  };

  const updated = await prisma.user.update({
    where: { id: req.auth.userId },
    data: {
      discType:       result.dominant,
      discVector:     result.vector,
      discResultCard,
    },
    select: {
      id:            true,
      fullName:      true,
      discType:      true,
      discVector:    true,
      discResultCard: true,
      updatedAt:     true,
    },
  });

  return res.json({
    message: `Mizaç profilin hazır! Sen bir ${resultCard!.archetype}sın ${resultCard!.icon}`,
    resultCard: discResultCard,
    user: {
      id:         updated.id,
      fullName:   updated.fullName,
      discType:   updated.discType,
      discVector: updated.discVector,
    },
  });
}

// ─── GET /api/users/disc/questions ───────────────────────────────────────────
// Onboarding testinin sorularını döndürür (frontend bunu render eder).
// Seçeneklerin DISC boyutları kasıtlı olarak gizlenir — sonucu öngörmeyi önler.

export async function getDiscQuestions(_req: RequestWithTenant, res: Response) {
  const questions = ONBOARDING_DISC_QUESTIONS.map((q) => ({
    id:   q.id,
    text: q.text,
    options: Object.fromEntries(
      Object.entries(q.options).map(([key, opt]) => [key, opt.text]),
    ),
  }));

  return res.json({ questions, total: questions.length });
}

// ─── PATCH /api/users/me/social ──────────────────────────────────────────────
const SocialProfileSchema = z.object({
  linkedinUrl:  z.string().url().max(300).optional().nullable(),
  instagramUrl: z.string().url().max(300).optional().nullable(),
}).strict();

export async function updateSocialProfile(req: RequestWithTenant, res: Response) {
  if (!req.auth) {
    return res.status(401).json({ error: 'KIMLIK_DOGRULANMADI' });
  }

  const parsed = SocialProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION', details: parsed.error.flatten() });
  }

  const updated = await prisma.user.update({
    where: { id: req.auth.userId },
    data: parsed.data,
    select: { id: true, linkedinUrl: true, instagramUrl: true, avatarUrl: true },
  });

  return res.json(updated);
}
