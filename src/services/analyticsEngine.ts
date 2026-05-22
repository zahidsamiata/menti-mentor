import type { DiscType } from '@prisma/client';
import type { DiscVector } from './scoring.js';

// ─── Tip tanımları ────────────────────────────────────────────────────────────

export type DimKey = 'D' | 'I' | 'S' | 'C';

export type SubDimension = {
  key: DimKey;
  label: string;
  score: number;           // 0-100
  percentile: string;      // "Yüksek" | "Orta" | "Düşük"
  description: string;
  strengths: string[];
  growthAreas: string[];
};

export type ComplementaryPersona = {
  idealVector: Record<DimKey, number>;   // 0-1 normalize
  label: string;                          // "Stratejik Uygulayıcı" vb.
  rationale: string;
  topDimensions: DimKey[];
  synergies: string[];
};

export type FrictionPoint = {
  dimension: DimKey;
  trigger: string;
  manifestation: string;
  severity: 'Yüksek' | 'Orta' | 'Düşük';
  mitigation: string;
};

export type FrictionMatrix = {
  selfExtremes: FrictionPoint[];
  partnerClashes: Array<{
    partnerDim: DimKey;
    clashDescription: string;
    severity: 'Yüksek' | 'Orta' | 'Düşük';
  }>;
  overallRisk: 'Yüksek' | 'Orta' | 'Düşük';
};

export type RoleAlignment = {
  leadershipScore: number;      // 0-100
  executionScore: number;       // 0-100
  facilitationScore: number;    // 0-100
  primaryRole: 'Lider' | 'Uzman/Uygulayıcı' | 'Koordinatör/Kolaylaştırıcı';
  secondaryRole: string;
  roleDescription: string;
  suitablePositions: string[];
};

export type FullAnalyticsProfile = {
  userId: string;
  discVector: DiscVector;
  dominantType: DimKey;
  subDimensions: SubDimension[];
  complementaryPersona: ComplementaryPersona;
  frictionMatrix: FrictionMatrix;
  roleAlignment: RoleAlignment;
  compositeInsight: string;    // Tek cümlelik karakter özeti
};

// ─── Sabitler ─────────────────────────────────────────────────────────────────

const DIM_META: Record<DimKey, { label: string; color: string }> = {
  D: { label: 'Dominant',       color: '#ef4444' },
  I: { label: 'Etkili',         color: '#eab308' },
  S: { label: 'Kararlı/Sabit',  color: '#22c55e' },
  C: { label: 'Vicdanlı',       color: '#3b82f6' },
};

// Her boyutun uç değerde yarattığı sürtüşme noktaları
const FRICTION_CATALOG: Record<DimKey, FrictionPoint[]> = {
  D: [
    { dimension: 'D', trigger: 'Yavaş karar süreçleri', manifestation: 'Sabırsızlık, sözü kesme, tek taraflı karar alma', severity: 'Yüksek', mitigation: 'Zaman sınırlı tartışma formatları ve yapılandırılmış toplantılar' },
    { dimension: 'D', trigger: 'Detay odaklı iş arkadaşları', manifestation: 'Mikroyönetim eleştirisi, prosedür atlama', severity: 'Orta', mitigation: 'C tipi ile "kalite kapıları" belirleme' },
  ],
  I: [
    { dimension: 'I', trigger: 'Sıkı süreç ve kural kültürü', manifestation: 'Söz verip yerine getirmeme, zaman yönetimi zayıflığı', severity: 'Orta', mitigation: 'Görsel takvimler ve hesap verebilirlik partneri' },
    { dimension: 'I', trigger: 'Teknik/analitik tartışmalar', manifestation: 'Yüzeysel analiz, duygusal kararlar', severity: 'Yüksek', mitigation: 'C tipinin veri özetleri sunmasına alan açmak' },
  ],
  S: [
    { dimension: 'S', trigger: 'Ani değişim ve belirsizlik', manifestation: 'Pasif direnç, üretkenlik düşüşü, sessiz sabotaj', severity: 'Yüksek', mitigation: 'Değişimi önceden duyurma, geçiş süreçleri tasarlama' },
    { dimension: 'S', trigger: 'Çatışma anı', manifestation: 'Geri çekilme, sorunu biriktirir, patlar', severity: 'Orta', mitigation: 'Güvenli 1-1 konuşma kanalları ve düzenli retrospektifler' },
  ],
  C: [
    { dimension: 'C', trigger: 'Yetersiz veri ile karar alma baskısı', manifestation: 'Analiz felci, kararı erteleme, aşırı dokümantasyon', severity: 'Yüksek', mitigation: 'Minimum kabul edilebilir veri eşiği ve karar son tarihi' },
    { dimension: 'C', trigger: 'Hatalı veya düşük kaliteli çalışmalar', manifestation: 'Aşırı eleştiri, ilişki zedelenmesi', severity: 'Orta', mitigation: 'Yapıcı geri bildirim protokolü ve "yeterince iyi" standardı' },
  ],
};

// Boyutlar arası çatışma çiftleri
const CLASH_PAIRS: Array<{ a: DimKey; b: DimKey; description: string; severity: 'Yüksek' | 'Orta' | 'Düşük' }> = [
  { a: 'D', b: 'S', description: 'D\'nin hız ve risk toleransı, S\'nin istikrar ihtiyacıyla çakışır. Tempo uyumsuzluğu en yaygın gerilim kaynağıdır.', severity: 'Yüksek' },
  { a: 'I', b: 'C', description: 'I\'nın ilişki ve his odağı, C\'nin veri ve prosedür talebini basitleştirici bulur; C ise I\'yı yüzeysel görür.', severity: 'Yüksek' },
  { a: 'D', b: 'D', description: 'İki güçlü D birlikte çalışırken güç mücadelesi ve ego çatışması kaçınılmazdır.', severity: 'Orta' },
  { a: 'S', b: 'I', description: 'S\'nin rutini, I\'nın sürekli değişim enerjisinden bunalabilir; ancak tamamlayıcı potansiyel yüksektir.', severity: 'Düşük' },
  { a: 'C', b: 'D', description: 'C\'nin detay ihtiyacı, D\'nin eylem önceliğiyle gerilir; ancak kalite-hız dengesi sağlandığında ideal çifttir.', severity: 'Düşük' },
];

// ─── Yardımcı fonksiyonlar ─────────────────────────────────────────────────────

function r(n: number): number { return Math.round(n * 1000) / 1000; }
function pct(v: number): string { return v >= 0.65 ? 'Yüksek' : v >= 0.35 ? 'Orta' : 'Düşük'; }

function toDominantType(vec: DiscVector): DimKey {
  const dims: DimKey[] = ['D', 'I', 'S', 'C'];
  return dims.reduce((a, b) => (vec[a] >= vec[b] ? a : b));
}

// ─── Alt boyut analizi ────────────────────────────────────────────────────────

const SUB_DIM_CONTENT: Record<DimKey, {
  strengths: Record<'Yüksek' | 'Orta' | 'Düşük', string[]>;
  growth:    Record<'Yüksek' | 'Orta' | 'Düşük', string[]>;
  description: Record<'Yüksek' | 'Orta' | 'Düşük', string>;
}> = {
  D: {
    description: {
      Yüksek: 'Güçlü yürütme motivasyonu; hız ve sonuç odaklı liderlik sergiler.',
      Orta:   'Dengelenmiş otorite; hem yönlendirir hem başkalarını dinler.',
      Düşük:  'İşbirliği öncelikli; kararları paylaşımcı bir süreçle alır.',
    },
    strengths: {
      Yüksek: ['Hızlı karar verme', 'Engelleri aşma', 'Sorumluluk üstlenme', 'Baskı altında performans'],
      Orta:   ['Esnek liderlik', 'Duruma göre direktif/katılımcı denge', 'Risk değerlendirme'],
      Düşük:  ['Ekip uyumu', 'Konsensüs oluşturma', 'Diğerlerini güçlendirme'],
    },
    growth: {
      Yüksek: ['Aktif dinleme geliştirme', 'Süreç sabrı', 'Başkalarının katkısına yer açma'],
      Orta:   ['Daha net sınır belirleme', 'Gerektiğinde daha kararlı duruş'],
      Düşük:  ['Kendi görüşünü daha güçlü savunma', 'Liderlik fırsatları arama'],
    },
  },
  I: {
    description: {
      Yüksek: 'Yüksek sosyal enerji; ilham verici iletişimci ve ilişki kurucudur.',
      Orta:   'Sosyal becerileri ile analitik disiplinini dengeler.',
      Düşük:  'Derinlikli bağlantıları geniş ağa tercih eder; tutarlı ve güvenilirdir.',
    },
    strengths: {
      Yüksek: ['İkna ve etkileme', 'Motivasyon yayma', 'Ağ kurma', 'Yaratıcı fikir üretimi'],
      Orta:   ['Esnek iletişim stili', 'Hem ilişki hem sonuç odağı', 'Çatışma arabuluculuğu'],
      Düşük:  ['Derin uzmanlık ilişkileri', 'Güvenilir takipçi', 'Dikkatli ve ölçülü iletişim'],
    },
    growth: {
      Yüksek: ['Taahhüt yönetimi', 'Detay takibi', 'Yazılı iletişim disiplini'],
      Orta:   ['Kalabalık ortamlarda daha fazla enerji kullanma', 'Farklı kitlelere uyum'],
      Düşük:  ['Daha geniş ağ geliştirme', 'Sunum ve konuşma becerilerini güçlendirme'],
    },
  },
  S: {
    description: {
      Yüksek: 'Yüksek güvenilirlik ve sabır; istikrarın temelidir.',
      Orta:   'Değişimi yönetebilir; hem rutini hem esnekliği destekler.',
      Düşük:  'Değişime açık ve uyumlu; belirsizlikle rahat çalışır.',
    },
    strengths: {
      Yüksek: ['Tutarlılık ve güvenilirlik', 'Uzun vadeli taahhüt', 'Aktif dinleme', 'Ekip uyumu koruma'],
      Orta:   ['Değişim yönetimi', 'Dengeleyici etki', 'Esneklik-istikrar dengesi'],
      Düşük:  ['Hızlı uyum', 'Çok görevlilik', 'Yenilik arayışı'],
    },
    growth: {
      Yüksek: ['Değişim toleransını artırma', 'Çatışmayı erken yönetme', 'Hayır diyebilme'],
      Orta:   ['Daha net sınır belirleme', 'Öncelik sıralamasında kararlılık'],
      Düşük:  ['Süreç disiplini geliştirme', 'Uzun vadeli taahhütlere odaklanma'],
    },
  },
  C: {
    description: {
      Yüksek: 'Yüksek doğruluk standardı; analiz ve kalite odağı baskındır.',
      Orta:   'Kalite ile hızı dengeler; pragmatik mükemmeliyetçi.',
      Düşük:  'Hız ve uygulama öncelikli; iyi kadar iyi ilkesiyle çalışır.',
    },
    strengths: {
      Yüksek: ['Derin analiz', 'Risk tespiti', 'Yüksek kalite çıktı', 'Süreç tasarımı'],
      Orta:   ['Pratik mükemmeliyetçilik', 'Ölçülü eleştiri', 'Hem kalite hem hız'],
      Düşük:  ['Çevik uygulama', 'Hızlı prototipleme', 'Belirsizlikte aksiyon'],
    },
    growth: {
      Yüksek: ['Karar eşiğini düşürme', 'Hata toleransı geliştirme', 'İlişki yatırımı'],
      Orta:   ['Daha güçlü kalite savunuculuğu', 'Analitik derinliği artırma'],
      Düşük:  ['Süreç disiplini oluşturma', 'Dokümantasyon alışkanlığı', 'Kalite kontrol ekleme'],
    },
  },
};

function buildSubDimensions(vec: DiscVector): SubDimension[] {
  const dims: DimKey[] = ['D', 'I', 'S', 'C'];
  return dims.map((k) => {
    const score = Math.round(vec[k] * 100);
    const level = pct(vec[k]) as 'Yüksek' | 'Orta' | 'Düşük';
    const content = SUB_DIM_CONTENT[k];
    return {
      key: k,
      label: DIM_META[k].label,
      score,
      percentile: level,
      description: content.description[level],
      strengths: content.strengths[level],
      growthAreas: content.growth[level],
    };
  });
}

// ─── Tamamlayıcı persona ──────────────────────────────────────────────────────

// Tamamlayıcı vektör: ters ağırlıklı ihtiyaç haritası
// Yüksek D → ihtiyaç: C (kalite) ve S (uygulama sabrı)
// Yüksek I → ihtiyaç: C (detay) ve S (takip)
// Yüksek S → ihtiyaç: D (yön) ve I (enerji)
// Yüksek C → ihtiyaç: I (ilişki) ve D (aksiyon)
const COMPLEMENT_WEIGHTS: Record<DimKey, Record<DimKey, number>> = {
  D: { D: 0.10, I: 0.20, S: 0.30, C: 0.40 },
  I: { D: 0.20, I: 0.10, S: 0.30, C: 0.40 },
  S: { D: 0.40, I: 0.35, S: 0.10, C: 0.15 },
  C: { D: 0.25, I: 0.40, S: 0.25, C: 0.10 },
};

const PERSONA_LABELS: Record<string, string> = {
  'D-C': 'Stratejik Uygulayıcı — yönlendirir ve kaliteli teslim eder',
  'C-I': 'Analitik İletişimci — veriyi insanlaştırır',
  'D-I': 'Vizyon Üreticisi — ilham verir ve harekete geçirir',
  'S-C': 'Güvenilir Uzman — tutarlı ve titiz kalite sağlar',
  'I-S': 'İlham Veren Koordinatör — ilişki ve istikrarı birleştirir',
  'S-D': 'Sabit Lider — güven inşa ederek yönlendirir',
};

function buildComplementaryPersona(vec: DiscVector, dominant: DimKey): ComplementaryPersona {
  const dims: DimKey[] = ['D', 'I', 'S', 'C'];
  const weights = COMPLEMENT_WEIGHTS[dominant];

  // Tamamlayıcı vektörü: kendi düşük boyutlarını yüksek tutan profil
  const raw: Record<DimKey, number> = { D: 0, I: 0, S: 0, C: 0 };
  for (const k of dims) {
    // Kendi boyutunda düşükse tamamlayıcı boyutta yüksek ağırlık
    raw[k] = weights[k] * (1 - vec[k]) + (1 - weights[k]) * vec[k] * 0.3;
  }
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  const idealVector: Record<DimKey, number> = {
    D: r(raw.D / sum),
    I: r(raw.I / sum),
    S: r(raw.S / sum),
    C: r(raw.C / sum),
  };

  const sorted = dims.slice().sort((a, b) => idealVector[b] - idealVector[a]);
  const top2 = sorted.slice(0, 2) as DimKey[];
  const labelKey = `${top2[0]}-${top2[1]}`;
  const label = PERSONA_LABELS[labelKey] ?? `${DIM_META[top2[0]].label}-${DIM_META[top2[1]].label} Profili`;

  const synergies: string[] = [
    `${DIM_META[top2[0]].label} boyutundaki güç, ${DIM_META[dominant].label} uçlarını dengeler`,
    `Birlikte oluşturdukları ekip hem hız hem kalite hem ilişki üçgenini kapatır`,
    `${DIM_META[top2[1]].label} katkısı uzun vadeli sürdürülebilirlik sağlar`,
  ];

  return {
    idealVector,
    label,
    rationale: `${DIM_META[dominant].label} ağırlıklı profiliniz; en yüksek sinerjik değeri ${DIM_META[top2[0]].label} ve ${DIM_META[top2[1]].label} güçlü bir partnerle üretir.`,
    topDimensions: top2,
    synergies,
  };
}

// ─── Sürtüşme matrisi ─────────────────────────────────────────────────────────

function buildFrictionMatrix(vec: DiscVector, dominant: DimKey): FrictionMatrix {
  // Kendi yüksek boyutlarının uç davranışları
  const dims: DimKey[] = ['D', 'I', 'S', 'C'];
  const selfExtremes: FrictionPoint[] = [];
  for (const k of dims) {
    if (vec[k] >= 0.35) {
      selfExtremes.push(...FRICTION_CATALOG[k]);
    }
  }

  // Partner çatışmaları: kendi dominant boyutuyla tarihsel sürtüşme çiftleri
  const partnerClashes = CLASH_PAIRS
    .filter((p) => p.a === dominant || p.b === dominant)
    .map((p) => ({
      partnerDim: (p.a === dominant ? p.b : p.a) as DimKey,
      clashDescription: p.description,
      severity: p.severity,
    }));

  const highCount = selfExtremes.filter((f) => f.severity === 'Yüksek').length;
  const overallRisk: 'Yüksek' | 'Orta' | 'Düşük' =
    highCount >= 2 ? 'Yüksek' : highCount === 1 ? 'Orta' : 'Düşük';

  return { selfExtremes, partnerClashes, overallRisk };
}

// ─── Rol hizalaması ───────────────────────────────────────────────────────────

const ROLE_POSITIONS: Record<string, string[]> = {
  'Lider': ['Proje Yöneticisi', 'Ürün Sahibi', 'Girişimci', 'Departman Başkanı', 'Kriz Koordinatörü'],
  'Uzman/Uygulayıcı': ['Kıdemli Geliştirici', 'Araştırmacı', 'Kalite Mühendisi', 'Veri Analisti', 'Hukuk/Finans Uzmanı'],
  'Koordinatör/Kolaylaştırıcı': ['Scrum Master', 'İnsan Kaynakları', 'Müşteri Başarısı', 'Operasyon Yöneticisi', 'Program Koordinatörü'],
};

function buildRoleAlignment(vec: DiscVector): RoleAlignment {
  // Liderlik: D ve I birlikte güçlü
  const leadershipScore = Math.min(100, Math.round(((vec.D * 0.6 + vec.I * 0.4)) * 180));
  // Uzmanlık/uygulama: S ve C birlikte güçlü
  const executionScore = Math.min(100, Math.round(((vec.S * 0.45 + vec.C * 0.55)) * 180));
  // Koordinatör: dengeli dağılım (hiçbir boyut aşırı değil)
  const maxDim = Math.max(vec.D, vec.I, vec.S, vec.C);
  const facilitationScore = Math.min(100, Math.round((1 - maxDim) * 2.5 * 100));

  const primary: RoleAlignment['primaryRole'] =
    leadershipScore >= executionScore && leadershipScore >= facilitationScore
      ? 'Lider'
      : executionScore >= facilitationScore
        ? 'Uzman/Uygulayıcı'
        : 'Koordinatör/Kolaylaştırıcı';

  const scores = { 'Lider': leadershipScore, 'Uzman/Uygulayıcı': executionScore, 'Koordinatör/Kolaylaştırıcı': facilitationScore };
  const sorted = (Object.keys(scores) as RoleAlignment['primaryRole'][]).sort((a, b) => scores[b] - scores[a]);
  const secondary = sorted[1];

  const descriptions: Record<RoleAlignment['primaryRole'], string> = {
    'Lider': 'Yön belirleme ve insanları harekete geçirme konusunda doğal yetkinlik; zorlu kararları sahiplenme eğilimi yüksek.',
    'Uzman/Uygulayıcı': 'Derin teknik veya analitik uzmanlık geliştirme; kalite ve tutarlılık öncelikli çalışma ritmi.',
    'Koordinatör/Kolaylaştırıcı': 'Farklı profilleri birleştirme ve süreçleri akıcı tutma; çok taraflı ilişki yönetiminde güçlü.',
  };

  return {
    leadershipScore,
    executionScore,
    facilitationScore,
    primaryRole: primary,
    secondaryRole: secondary,
    roleDescription: descriptions[primary],
    suitablePositions: ROLE_POSITIONS[primary],
  };
}

// ─── Genel özet üretici ───────────────────────────────────────────────────────

function buildCompositeInsight(dominant: DimKey, role: RoleAlignment): string {
  const dimLabel = DIM_META[dominant].label;
  return `${dimLabel} ağırlıklı bu profil, doğası gereği ${role.primaryRole.toLowerCase()} kimliğine en yakın konumlanır; ${role.suitablePositions[0]} ve ${role.suitablePositions[1]} rollerinde en yüksek değeri üretir.`;
}

// ─── Ana fonksiyon ────────────────────────────────────────────────────────────

export function buildFullAnalytics(userId: string, vec: DiscVector): FullAnalyticsProfile {
  const dominant = toDominantType(vec);
  const subDimensions = buildSubDimensions(vec);
  const complementaryPersona = buildComplementaryPersona(vec, dominant);
  const frictionMatrix = buildFrictionMatrix(vec, dominant);
  const roleAlignment = buildRoleAlignment(vec);
  const compositeInsight = buildCompositeInsight(dominant, roleAlignment);

  return {
    userId,
    discVector: vec,
    dominantType: dominant,
    subDimensions,
    complementaryPersona,
    frictionMatrix,
    roleAlignment,
    compositeInsight,
  };
}
