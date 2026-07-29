/**
 * Seed scripti: Yük testi ve geliştirme ortamı için
 * 3 tenant, 20 mentor, 200 menti oluşturur.
 * Çalıştırma: npx tsx prisma/seed.ts
 */

import bcrypt from 'bcryptjs';
import {
  PrismaClient, DiscType, TimeCommitment, InteractionStyle, QuestionType, DiscDimension,
  QuestionTier, AnswerFormat, UserRole,
} from '@prisma/client';
import { seedCertification } from './seed-certification.js';
import { seedLearningJourney } from './seed-learning-journey.js';

const prisma = new PrismaClient();

// ─── DISC Soru Bankası ────────────────────────────────────────────────────────
// Psikometrik tasarım: 5 CORE + 3 DEEPENING = 8 soru/boyut (toplam 32)
// D-C ayrımı için davranışsal çapa yöntemi kullanılmıştır.
// Yanıt ölçeği: 1 = Hiç katılmıyorum … 5 = Tamamen katılıyorum
// Puanlama yönü: Her soru kendi boyutunu pozitif yönde ölçer (5 = yüksek boyut skoru)

type QuestionSeed = {
  text: string;
  type: QuestionType;
  discDimension: DiscDimension;
  order: number;
};

const DISC_QUESTIONS: QuestionSeed[] = [
  // ── D (Dominant) — CORE ────────────────────────────────────────────────────
  // Anahtar boyutlar: hız, meydan okuma, direktiflik, büyük resim, rutin reddi
  {
    text: 'Karşılaştığım engellere rağmen hedefimi değiştirmeden ilerlemeyi tercih ederim.',
    type: 'CORE', discDimension: 'D', order: 1,
  },
  {
    text: 'Bir konuda tartışmak yerine hızla karar vererek öne çıkmayı tercih ederim.',
    type: 'CORE', discDimension: 'D', order: 2,
  },
  {
    text: 'Rutin ve tekrar eden işler zaman içinde beni sıkmaya başlar.',
    type: 'CORE', discDimension: 'D', order: 3,
  },
  {
    text: 'Meydan okumalar ve zorluklar benim için bir motivasyon kaynağıdır.',
    type: 'CORE', discDimension: 'D', order: 4,
  },
  {
    text: 'Bir projeyi başlatmak, detaylandırmak ve tamamlamaktan daha çok ilgimi çeker.',
    type: 'CORE', discDimension: 'D', order: 5,
  },

  // ── I (Influential) — CORE ─────────────────────────────────────────────────
  // Anahtar boyutlar: sosyal enerji, ikna, ilham, iletişim, pozitif atmosfer
  {
    text: 'Farklı ortamlarda yeni insanlarla tanışmak bana enerji verir.',
    type: 'CORE', discDimension: 'I', order: 6,
  },
  {
    text: 'Bir fikri hayata geçirmek için önce insanları ikna etmeye çalışırım.',
    type: 'CORE', discDimension: 'I', order: 7,
  },
  {
    text: 'Topluluk önünde konuşmak ya da sunum yapmak beni heyecanlandırır.',
    type: 'CORE', discDimension: 'I', order: 8,
  },
  {
    text: 'Başkalarını motive etmek ve ilham vermek benim doğal bir güçlüğüm gibi hissettiriyor.',
    type: 'CORE', discDimension: 'I', order: 9,
  },
  {
    text: 'İlişkileri ve iletişimi ön planda tutarak sonuca ulaşmayı tercih ederim.',
    type: 'CORE', discDimension: 'I', order: 10,
  },

  // ── S (Steady) — CORE ──────────────────────────────────────────────────────
  // Anahtar boyutlar: istikrar, destek, güven, sabır, öngörülebilirlik
  {
    text: 'Ani değişiklikler yerine önceden planlanmış rutinleri tercih ederim.',
    type: 'CORE', discDimension: 'S', order: 11,
  },
  {
    text: 'Bir ekipte herkesin üzerine düşeni yapması benim için önceliklidir.',
    type: 'CORE', discDimension: 'S', order: 12,
  },
  {
    text: 'Çevremdeki insanların ihtiyaçlarına duyarlı olmak ve destek vermek bana anlamlı gelir.',
    type: 'CORE', discDimension: 'S', order: 13,
  },
  {
    text: 'Uzun süreli ve güven temelli ilişkiler kurmak kısa vadeli kazanımlardan daha önemlidir.',
    type: 'CORE', discDimension: 'S', order: 14,
  },
  {
    text: 'Bir görevi tamamlarken sabırlı ve istikrarlı bir tempo ile ilerlemeyi tercih ederim.',
    type: 'CORE', discDimension: 'S', order: 15,
  },

  // ── C (Conscientious) — CORE ───────────────────────────────────────────────
  // Anahtar boyutlar: analiz, kalite, kural uyumu, veri odaklılık, hata önleme
  // D-C ayrımı: C soruları yavaşlığı, kuralı ve hata korkusunu ölçer; D ise hızı ve meydan okumayı
  {
    text: 'Bir işe başlamadan önce tüm detayları ve olası riskleri değerlendirmem gerekir.',
    type: 'CORE', discDimension: 'C', order: 16,
  },
  {
    text: 'Hata yapmaktan kaçınmak için gerekirse daha fazla zaman harcarım.',
    type: 'CORE', discDimension: 'C', order: 17,
  },
  {
    text: 'Belirlenen standartlara ve kurallara uymak benim için önemlidir.',
    type: 'CORE', discDimension: 'C', order: 18,
  },
  {
    text: 'Verilerle ve kanıtlarla desteklenmemiş kararlar beni rahatsız eder.',
    type: 'CORE', discDimension: 'C', order: 19,
  },
  {
    text: 'Kalite, hız veya miktardan her zaman daha önce gelir.',
    type: 'CORE', discDimension: 'C', order: 20,
  },

  // ── D (Dominant) — DEEPENING ───────────────────────────────────────────────
  // İleri D tespiti: inatçılık, rekabet arzusu, büyük vizyon
  {
    text: 'Başkalarının eleştirilerine rağmen kendi kararımın doğru olduğuna inanıyorsam geri adım atmam.',
    type: 'DEEPENING', discDimension: 'D', order: 21,
  },
  {
    text: 'Rekabetçi ortamlar beni olumsuz etkilemez, tam tersine daha iyi performans göstermemi sağlar.',
    type: 'DEEPENING', discDimension: 'D', order: 22,
  },
  {
    text: 'Büyük, cesur hedefler belirlemek küçük adımlarla ilerlemekten daha ilgimi çeker.',
    type: 'DEEPENING', discDimension: 'D', order: 23,
  },

  // ── I (Influential) — DEEPENING ────────────────────────────────────────────
  // İleri I tespiti: yalnızlık toleransı, atmosfer yaratma, duygusal bağ
  {
    text: 'Yalnız çalışmak yerine başkalarıyla birlikte bir şey üretmek daha anlamlı gelir.',
    type: 'DEEPENING', discDimension: 'I', order: 24,
  },
  {
    text: 'Bir görüşme ya da toplantıda olumlu bir atmosfer oluşturmak benim için önceliktir.',
    type: 'DEEPENING', discDimension: 'I', order: 25,
  },
  {
    text: 'Duygusal bağ kuramadığım insanlarla uzun soluklu iş yapmak benim için zorlaşır.',
    type: 'DEEPENING', discDimension: 'I', order: 26,
  },

  // ── S (Steady) — DEEPENING ─────────────────────────────────────────────────
  // İleri S tespiti: belirsizlik stresi, uzlaşı eğilimi, sadakat
  {
    text: 'Belirsizlik içeren projelerde çalışmak stresimi belirgin şekilde artırır.',
    type: 'DEEPENING', discDimension: 'S', order: 27,
  },
  {
    text: 'Ekibim benimle hemfikir olmasa bile sakin ve yapıcı bir tutum sergilemeye çalışırım.',
    type: 'DEEPENING', discDimension: 'S', order: 28,
  },
  {
    text: 'Bir kez güvendiğim birine uzun süre sadık kalırım, ilişkiyi kolay bırakmam.',
    type: 'DEEPENING', discDimension: 'S', order: 29,
  },

  // ── C (Conscientious) — DEEPENING ─────────────────────────────────────────
  // İleri C tespiti: süreç > sonuç, mükemmeliyetçilik, bilgi olmadan hareket edememe
  // D-C keskin ayrımı: C bu sorularda 5 verirken D tipik olarak 1-2 verir
  {
    text: 'Sonuçtan çok sürecin doğru ve eksiksiz işlemesi benim için önemlidir.',
    type: 'DEEPENING', discDimension: 'C', order: 30,
  },
  {
    text: 'Kendi işimde en ufak bir hata bile olsa bunu fark etmek ve düzeltmek isterim.',
    type: 'DEEPENING', discDimension: 'C', order: 31,
  },
  {
    text: 'Bir konuyu tam olarak anlamadan ve yeterli bilgiye sahip olmadan harekete geçemem.',
    type: 'DEEPENING', discDimension: 'C', order: 32,
  },
];

// ─── Sabitler ─────────────────────────────────────────────────────────────────

const DISC_TYPES: DiscType[] = ['D', 'I', 'S', 'C'];
const DISC_VECTORS: Record<DiscType, { D: number; I: number; S: number; C: number }> = {
  D: { D: 0.60, I: 0.20, S: 0.10, C: 0.10 },
  I: { D: 0.15, I: 0.60, S: 0.15, C: 0.10 },
  S: { D: 0.10, I: 0.15, S: 0.60, C: 0.15 },
  C: { D: 0.10, I: 0.10, S: 0.20, C: 0.60 },
};

const TIME_COMMITMENTS: TimeCommitment[] = ['AYDA_1', 'AYDA_2_3', 'HAFTADA_1', 'HAFTADA_2_PLUS'];
const INTERACTION_STYLES: InteractionStyle[] = ['GOREV_BAZLI', 'SOHBET_BAZLI'];

// ─── Sektör Havuzu ────────────────────────────────────────────────────────────
// STK / üniversite / sivil toplum ekosistemi için genişletilmiş etiket seti.
// Eşleştirme motoru bu etiketlerin kesişimini kullanır (Jaccard benzeri).
// Yeni etiket önerileri PendingTag akışıyla admin onayına gider.
const SECTOR_POOL = [
  // Teknoloji & Dijital
  'yazılım-geliştirme', 'veri-bilimi', 'yapay-zeka', 'siber-güvenlik',
  'ürün-yönetimi', 'ui-ux-tasarım', 'mobil-uygulama', 'bulut-sistemleri',

  // İş Dünyası & Finans
  'finans', 'muhasebe', 'girişimcilik', 'pazarlama', 'satış',
  'kurumsal-iletişim', 'sosyal-girişimcilik', 'etki-yatırımı',

  // Sivil Toplum & Kamu
  'stk-yönetimi', 'proje-yönetimi', 'hibe-yazımı', 'savunuculuk',
  'gönüllülük-yönetimi', 'sosyal-politika', 'kamu-yönetimi',

  // Eğitim & Akademi
  'eğitim-teknolojisi', 'akademik-araştırma', 'kariyer-koçluğu',
  'ölçme-değerlendirme', 'müfredat-tasarımı',

  // Sağlık & Refah
  'halk-sağlığı', 'sağlık-teknolojisi', 'psikoloji', 'sosyal-hizmet',

  // Hukuk & Uyum
  'hukuk', 'insan-hakları', 'veri-gizliliği', 'fikri-mülkiyet',

  // Sürdürülebilirlik & Çevre
  'çevre-politikası', 'sürdürülebilirlik', 'iklim-değişikliği', 'döngüsel-ekonomi',

  // İnsan & Organizasyon
  'insan-kaynakları', 'liderlik-gelişimi', 'topluluk-yönetimi',
  'çeşitlilik-kapsayıcılık', 'örgütsel-gelişim',

  // Yaratıcı & Medya
  'içerik-üretimi', 'sosyal-medya', 'gazetecilik', 'tasarım',
];

const SKILL_POOL = [
  // Teknik
  'Python', 'TypeScript', 'SQL', 'React', 'Excel', 'Power-BI',
  'veri-analizi', 'machine-learning', 'bulut-mimarisi',
  // Profesyonel
  'liderlik', 'sunum', 'proje-yönetimi', 'analitik-düşünce',
  'müzakere', 'iletişim', 'koçluk', 'mentorluk',
  // STK'ya özgü
  'hibe-yazımı', 'etki-ölçümü', 'paydaş-yönetimi', 'savunuculuk',
  'gönüllü-koordinasyonu', 'bağış-toplama',
];

const EXPECTATION_POOL = [
  'KARIYER_YONLENDIRME', 'TEKNIK_BECERI', 'IS_STAJ_BAGLANTISI',
  'GIRISIMCILIK', 'KISISEL_GELISIM', 'SEKTOR_TANIMA',
] as const;

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function seedDisc(disc: DiscType, confidence: number) {
  const base = DISC_VECTORS[disc];
  // Küçük gürültü ekle (gerçekçi vektörler için)
  const noisy = {
    D: Math.max(0, base.D + (Math.random() - 0.5) * 0.1),
    I: Math.max(0, base.I + (Math.random() - 0.5) * 0.1),
    S: Math.max(0, base.S + (Math.random() - 0.5) * 0.1),
    C: Math.max(0, base.C + (Math.random() - 0.5) * 0.1),
    confidence,
  };
  // Normalize et (toplam 1)
  const sum = noisy.D + noisy.I + noisy.S + noisy.C;
  return {
    D: Math.round((noisy.D / sum) * 1000) / 1000,
    I: Math.round((noisy.I / sum) * 1000) / 1000,
    S: Math.round((noisy.S / sum) * 1000) / 1000,
    C: Math.round((noisy.C / sum) * 1000) / 1000,
    confidence,
  };
}

function email(prefix: string, index: number, slug: string) {
  return `${prefix}${index}@${slug}.test`;
}

// ─── Ana seed fonksiyonu ──────────────────────────────────────────────────────

// Geliştirme ortamı varsayılan şifresi — production'da kesinlikle kullanılmaz
const DEV_PASSWORD_HASH = await bcrypt.hash('Test1234!', 10);

async function main() {
  console.log('🌱 Seed başlatılıyor...');

  // Mevcut seed verisini temizle (idempotent)
  await prisma.$transaction([
    prisma.userResponse.deleteMany(),
    prisma.feedbackLog.deleteMany(),
    prisma.feedback.deleteMany(),
    prisma.meeting.deleteMany(),
    prisma.matchRequest.deleteMany(),
    prisma.visibilityOptIn.deleteMany(),
    prisma.matchCombinationScore.deleteMany(),
    prisma.clubMembership.deleteMany(),
    prisma.club.deleteMany(),
    prisma.passwordResetToken.deleteMany({
      where: { user: { email: { contains: '.test' } } },
    }),
    prisma.refreshToken.deleteMany({
      where: { user: { email: { contains: '.test' } } },
    }),
    prisma.user.deleteMany({ where: { email: { contains: '.test' } } }),
    prisma.tenant.deleteMany({ where: { slug: { in: ['tech-hub', 'ngo-connect', 'uni-bridge'] } } }),
    // Global soruları temizle (tenantId null = tüm sistemde geçerli)
    prisma.question.deleteMany({ where: { tenantId: null } }),
  ]);

  // ─── Soru Bankası Seed ───────────────────────────────────────────────────
  // 32 global soru (tenantId: null → tüm tenant'larda görünür)
  // Dağılım: 5 CORE + 3 DEEPENING = 8 soru × 4 boyut = 32 soru
  let questionCount = 0;
  for (const q of DISC_QUESTIONS) {
    await prisma.question.create({
      data: {
        tenantId: null,    // global — tüm tenant'larda erişilebilir
        text: q.text,
        type: q.type,
        discDimension: q.discDimension,
        order: q.order,
        isActive: true,
      },
    });
    questionCount++;
  }
  console.log(`  ✓ Soru bankası: ${questionCount} soru oluşturuldu (8D + 8I + 8S + 8C)`);

  // ─── Tenant 1: TechHub (shared pool aktif) ───────────────────────────────
  const techHub = await prisma.tenant.create({
    data: {
      name: 'TechHub Mentoring',
      slug: 'tech-hub',
      isSharedPoolActive: true,
      displayName: 'TechHub Mentorluk Platformu',
      primaryColor: '#6366f1',
      tenantVocabulary: { greeting: 'Merhaba', signOff: null, formalStyle: false },
    },
  });

  // ─── Tenant 2: NGO Connect (shared pool aktif) ───────────────────────────
  const ngoConnect = await prisma.tenant.create({
    data: {
      name: 'NGO Connect',
      slug: 'ngo-connect',
      isSharedPoolActive: true,
      displayName: 'Sivil Toplum Mentorluk Ağı',
      primaryColor: '#10b981',
      tenantVocabulary: { greeting: 'Selamünaleyküm', signOff: 'Saygılarımla', formalStyle: true },
    },
  });

  // ─── Tenant 3: UniBridge (shared pool kapalı — izole) ────────────────────
  const uniBridge = await prisma.tenant.create({
    data: {
      name: 'UniBridge University',
      slug: 'uni-bridge',
      isSharedPoolActive: false,
      displayName: 'Üniversite Köprüsü',
      primaryColor: '#f59e0b',
      tenantVocabulary: { greeting: 'Merhaba', signOff: null, formalStyle: false },
    },
  });

  const tenants = [
    { tenant: techHub, mentorCount: 8, mentiCount: 80 },
    { tenant: ngoConnect, mentorCount: 6, mentiCount: 60 },
    { tenant: uniBridge, mentorCount: 6, mentiCount: 60 },
  ];

  // ─── Admin kullanıcıları ────────────────────────────────────────────────
  // Geliştirme şifresi: Test1234! (tüm seed kullanıcıları için aynı)
  for (const { tenant } of tenants) {
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        role: 'ADMIN',
        email: `admin@${tenant.slug}.test`,
        fullName: `${tenant.name} Yöneticisi`,
        isActive: true,
        approvalStatus: 'APPROVED',
        authProvider: 'LOCAL',
        password: DEV_PASSWORD_HASH,
        sectorTags: [],
      },
    });
  }

  // ─── Mentor ve menti oluştur ─────────────────────────────────────────────
  let totalMentors = 0;
  let totalMentis = 0;

  for (const { tenant, mentorCount, mentiCount } of tenants) {
    // Mentorlar
    for (let i = 1; i <= mentorCount; i++) {
      const disc = pick(DISC_TYPES);
      const confidence = 0.7 + Math.random() * 0.3; // 0.7-1.0 (deneyimli profil)
      await prisma.user.create({
        data: {
          tenantId: tenant.id,
          role: 'MENTOR',
          email: email('mentor', i, tenant.slug),
          fullName: `Mentor ${tenant.slug.toUpperCase()} ${i}`,
          isActive: true,
          approvalStatus: 'APPROVED',
          authProvider: 'LOCAL',
          password: DEV_PASSWORD_HASH,
          discType: disc,
          discVector: seedDisc(disc, confidence),
          sectorTags: pickN(SECTOR_POOL, 2 + Math.floor(Math.random() * 3)),
          skills: pickN(SKILL_POOL, 3 + Math.floor(Math.random() * 4)),
          timeCommitment: pick(TIME_COMMITMENTS),
          interactionStyle: pick(INTERACTION_STYLES),
          expectationCategories: pickN(EXPECTATION_POOL, 1 + Math.floor(Math.random() * 2)) as any,
          bioSummary: `${disc} profilinde deneyimli bir mentor. ${tenant.name} ekosisteminde aktif.`,
        },
      });
      totalMentors++;
    }

    // Mentiler — DISC dağılımı dengeli (25% her tip)
    const discGroups = [
      { disc: 'D' as DiscType, count: Math.floor(mentiCount / 4) },
      { disc: 'I' as DiscType, count: Math.floor(mentiCount / 4) },
      { disc: 'S' as DiscType, count: Math.floor(mentiCount / 4) },
      { disc: 'C' as DiscType, count: mentiCount - Math.floor(mentiCount / 4) * 3 },
    ];

    let mentiIndex = 1;
    for (const { disc, count } of discGroups) {
      for (let i = 0; i < count; i++) {
        // Güven seviyeleri: %40 tam profil, %40 kısmi, %20 düşük
        const confidenceTier = Math.random();
        const confidence =
          confidenceTier < 0.4 ? 0.85 + Math.random() * 0.15 :
          confidenceTier < 0.8 ? 0.4 + Math.random() * 0.4 :
                                  0.1 + Math.random() * 0.3;

        await prisma.user.create({
          data: {
            tenantId: tenant.id,
            role: 'MENTI',
            email: email('menti', mentiIndex, tenant.slug),
            fullName: `Menti ${disc}${mentiIndex} ${tenant.slug.toUpperCase()}`,
            isActive: true,
            approvalStatus: 'APPROVED',
            authProvider: 'LOCAL',
            password: DEV_PASSWORD_HASH,
            discType: disc,
            discVector: seedDisc(disc, confidence),
            sectorTags: pickN(SECTOR_POOL, 1 + Math.floor(Math.random() * 3)),
            skills: pickN(SKILL_POOL, 2 + Math.floor(Math.random() * 3)),
            timeCommitment: pick(TIME_COMMITMENTS),
            interactionStyle: pick(INTERACTION_STYLES),
            expectationCategories: pickN(EXPECTATION_POOL, 1 + Math.floor(Math.random() * 2)) as any,
            needsOrientation: Math.random() < 0.2, // %20 oryantasyon ihtiyacı var
          },
        });
        mentiIndex++;
        totalMentis++;
      }
    }

    console.log(`  ✓ ${tenant.name}: ${mentorCount} mentor + ${mentiCount} menti oluşturuldu`);
  }

  // ─── MatchCombinationScore: DISC çiftleri için başlangıç verileri ─────
  const discCombinations = DISC_TYPES.flatMap(mentor =>
    DISC_TYPES.map(menti => ({ mentor, menti }))
  );

  for (const { tenant } of tenants) {
    for (const { mentor, menti } of discCombinations) {
      await prisma.matchCombinationScore.upsert({
        where: { tenantId_discCombination: { tenantId: tenant.id, discCombination: `${mentor}_${menti}` } },
        update: {},
        create: {
          tenantId: tenant.id,
          discCombination: `${mentor}_${menti}`,
          score: 0,
        },
      });
    }
  }

  console.log(`\n🎉 Seed tamamlandı!`);
  console.log(`   Tenant: 3 (2 shared-pool, 1 izole)`);
  console.log(`   Mentor: ${totalMentors} toplam`);
  console.log(`   Menti : ${totalMentis} toplam`);
  console.log(`   Admin : 3 toplam`);
  console.log(`   MatchCombinationScore: ${tenants.length * 16} kayıt`);
  console.log(`   Soru  : 32 (CORE:20 + DEEPENING:12) — D/I/S/C her biri 8 soru\n`);

  await seedSjtQuestions();
  await seedIndustryNodes();
  await seedCertification();
  await seedLearningJourney();
}

// ─── SJT Soru Havuzu ─────────────────────────────────────────────────────────

type SjtOptionSeed = {
  key: string;
  label: string;
  weights: Partial<Record<'o' | 'c' | 'e' | 'a' | 'n', number>>;
  signalsArchetype?: string;
};

type SjtQuestionSeed = {
  code: string;
  tier: QuestionTier;
  answerFormat: AnswerFormat;
  forRole: UserRole;
  scenario: string;
  triggersOn?: string;
  options: SjtOptionSeed[];
};

const SJT_QUESTIONS: SjtQuestionSeed[] = [
  {
    code: 'Q_MENTOR_CORE_01',
    tier: 'CORE',
    answerFormat: 'SINGLE',
    forRole: 'MENTOR',
    scenario:
      'Menteen, haftalardır çalıştığı bir projeyi sana getiriyor. Yaklaşımının temelden hatalı olduğunu fark ediyorsun. Ne yaparsın?',
    options: [
      { key: 'A', label: "Doğrudan söylerim: 'Bu yaklaşım çalışmaz, şu adımlarla yeniden kuralım.'", weights: { a: -2, c: 2, e: 1 }, signalsArchetype: 'M4' },
      { key: 'B', label: "Önce dinlerim, sorular sorarak hatayı kendisinin görmesini sağlarım.", weights: { o: 2, e: 1, a: 1 }, signalsArchetype: 'M2' },
      { key: 'C', label: 'Emeğini takdir ederek başlarım, endişelerimi nazikçe paylaşırım.', weights: { a: 3, n: 1, e: -1 }, signalsArchetype: 'M3' },
      { key: 'D', label: 'Hatayı net gösteririm ve yapılandırılmış bir düzeltme planı sunarım.', weights: { c: 2, o: 2 }, signalsArchetype: 'M1' },
    ],
  },
  {
    code: 'Q_MENTI_CORE_01',
    tier: 'CORE',
    answerFormat: 'SINGLE',
    forRole: 'MENTI',
    scenario: "Mentörün net bir yönerge vermeden 'Şunu bir araştır' diyor. Ne yaparsın?",
    options: [
      { key: 'A', label: 'Hemen detaylı bir plan yapar, adım adım sistematik ilerlerim.', weights: { c: 3, o: -1 }, signalsArchetype: 'm1' },
      { key: 'B', label: 'Heyecanlanırım; farklı yönlere dalar, ilginç bulduğum şeyleri kurcalarım.', weights: { o: 3, c: -2, e: 1 }, signalsArchetype: 'm2' },
      { key: 'C', label: 'Biraz kaygılanırım, netleştirmek için mentöre tekrar yazıp yönerge isterim.', weights: { n: 2, a: 1, c: 1 }, signalsArchetype: 'm3' },
      { key: 'D', label: 'Fırsat olarak görürüm; kendi yorumumu katıp iddialı bir şey hazırlarım.', weights: { o: 2, e: 2, a: -2 }, signalsArchetype: 'm4' },
    ],
  },
  {
    code: 'Q_MENTI_FOLLOWUP_N_01',
    tier: 'FOLLOWUP',
    answerFormat: 'MOST_LEAST',
    forRole: 'MENTI',
    triggersOn: 'n',
    scenario:
      'Mentörün mesafeli bir geri bildirim verdi. Aşağıdakilerden seni EN ÇOK ve EN AZ yansıtanı seç.',
    options: [
      { key: 'A', label: 'Üslubuna takılmam, içeriğe bakarım.', weights: { n: -3 }, signalsArchetype: 'm1' },
      { key: 'B', label: 'İlişkinin durumunu uzun uzun sorgularım.', weights: { n: 3, a: 1 }, signalsArchetype: 'm3' },
      { key: 'C', label: 'Mesafeli üslubu ben de mesafeyle karşılarım.', weights: { a: -2, e: -1 } },
      { key: 'D', label: 'Heyecanla karşılarım, yeni fikirlerle dönüş yaparım.', weights: { o: 2, e: 2 }, signalsArchetype: 'm2' },
    ],
  },
];

async function seedSjtQuestions() {
  console.log('\n🧠 SJT soru havuzu seed ediliyor...');

  for (const q of SJT_QUESTIONS) {
    const question = await prisma.sjtQuestion.upsert({
      where: { code: q.code },
      update: {
        tier: q.tier,
        answerFormat: q.answerFormat,
        forRole: q.forRole,
        scenario: q.scenario,
        triggersOn: q.triggersOn ?? null,
        isActive: true,
      },
      create: {
        code: q.code,
        tier: q.tier,
        answerFormat: q.answerFormat,
        forRole: q.forRole,
        scenario: q.scenario,
        triggersOn: q.triggersOn ?? null,
      },
    });

    for (const opt of q.options) {
      await prisma.sjtOption.upsert({
        where: { questionId_key: { questionId: question.id, key: opt.key } },
        update: {
          label: opt.label,
          weights: opt.weights,
          signalsArchetype: opt.signalsArchetype ?? null,
        },
        create: {
          questionId: question.id,
          key: opt.key,
          label: opt.label,
          weights: opt.weights,
          signalsArchetype: opt.signalsArchetype ?? null,
        },
      });
    }
  }

  const total = await prisma.sjtQuestion.count();
  console.log(`✅ SJT seed tamamlandı. Toplam soru: ${total}`);
}

// ─── IndustryNode Taksonomi Ağacı ─────────────────────────────────────────────
// 3 seviyeli hiyerarşi: Sektör (1) → Alt-sektör (2) → Yaprak (3)
// Ağaç, LCA tabanlı taxonomy.service.ts ile çalışır.
// upsert ile idempotent — tekrar çalıştırıldığında güvenli.

type NodeDef = { code: string; label: string; depth: number; parentCode: string | null };

const INDUSTRY_TREE: NodeDef[] = [
  // ── Seviye 1: Ana Sektörler ────────────────────────────────────────────────
  { code: 'TEK', label: 'Teknoloji & Dijital',    depth: 1, parentCode: null },
  { code: 'FIN', label: 'Finans & İş Dünyası',    depth: 1, parentCode: null },
  { code: 'STK', label: 'Sivil Toplum & Kamu',    depth: 1, parentCode: null },
  { code: 'EGT', label: 'Eğitim & Akademi',       depth: 1, parentCode: null },
  { code: 'SAG', label: 'Sağlık & Refah',         depth: 1, parentCode: null },
  { code: 'HUK', label: 'Hukuk & Uyum',           depth: 1, parentCode: null },
  { code: 'SUR', label: 'Sürdürülebilirlik',       depth: 1, parentCode: null },
  { code: 'INS', label: 'İnsan & Organizasyon',   depth: 1, parentCode: null },
  { code: 'YRT', label: 'Yaratıcı & Medya',       depth: 1, parentCode: null },

  // ── Seviye 2: Teknoloji ────────────────────────────────────────────────────
  { code: 'TEK.YZ',  label: 'Yazılım Geliştirme',   depth: 2, parentCode: 'TEK' },
  { code: 'TEK.VB',  label: 'Veri & Yapay Zeka',    depth: 2, parentCode: 'TEK' },
  { code: 'TEK.GVN', label: 'Siber Güvenlik',        depth: 2, parentCode: 'TEK' },
  { code: 'TEK.URN', label: 'Ürün & UX',             depth: 2, parentCode: 'TEK' },

  // ── Seviye 2: Finans ──────────────────────────────────────────────────────
  { code: 'FIN.GRS', label: 'Girişimcilik',          depth: 2, parentCode: 'FIN' },
  { code: 'FIN.FTK', label: 'Fintek',                depth: 2, parentCode: 'FIN' },
  { code: 'FIN.ETK', label: 'Sosyal Girişimcilik',   depth: 2, parentCode: 'FIN' },
  { code: 'FIN.MRK', label: 'Pazarlama & Satış',     depth: 2, parentCode: 'FIN' },

  // ── Seviye 2: Sivil Toplum ────────────────────────────────────────────────
  { code: 'STK.YNT', label: 'STK Yönetimi',         depth: 2, parentCode: 'STK' },
  { code: 'STK.PRJ', label: 'Proje & Hibe',          depth: 2, parentCode: 'STK' },
  { code: 'STK.SVN', label: 'Savunuculuk',           depth: 2, parentCode: 'STK' },
  { code: 'STK.KMY', label: 'Topluluk Yönetimi',    depth: 2, parentCode: 'STK' },

  // ── Seviye 2: Eğitim ──────────────────────────────────────────────────────
  { code: 'EGT.KRY', label: 'Kariyer Koçluğu',      depth: 2, parentCode: 'EGT' },
  { code: 'EGT.EDT', label: 'EdTech',                depth: 2, parentCode: 'EGT' },
  { code: 'EGT.AKD', label: 'Akademik Araştırma',   depth: 2, parentCode: 'EGT' },

  // ── Seviye 2: Sağlık ──────────────────────────────────────────────────────
  { code: 'SAG.HLK', label: 'Halk Sağlığı',         depth: 2, parentCode: 'SAG' },
  { code: 'SAG.PSK', label: 'Psikoloji & Refah',    depth: 2, parentCode: 'SAG' },
  { code: 'SAG.TIP', label: 'Sağlık Teknolojisi',   depth: 2, parentCode: 'SAG' },

  // ── Seviye 2: Sürdürülebilirlik ───────────────────────────────────────────
  { code: 'SUR.IKL', label: 'İklim & Çevre',        depth: 2, parentCode: 'SUR' },
  { code: 'SUR.DNG', label: 'Döngüsel Ekonomi',     depth: 2, parentCode: 'SUR' },
  { code: 'SUR.ENJ', label: 'Yenilenebilir Enerji', depth: 2, parentCode: 'SUR' },

  // ── Seviye 2: İnsan & Organizasyon ───────────────────────────────────────
  { code: 'INS.IK',  label: 'İnsan Kaynakları',     depth: 2, parentCode: 'INS' },
  { code: 'INS.LDR', label: 'Liderlik Gelişimi',    depth: 2, parentCode: 'INS' },
  { code: 'INS.CDI', label: 'Çeşitlilik & Kapsayıcılık', depth: 2, parentCode: 'INS' },

  // ── Seviye 3: Yapraklar — Yazılım ─────────────────────────────────────────
  { code: 'TEK.YZ.BE',  label: 'Backend',           depth: 3, parentCode: 'TEK.YZ' },
  { code: 'TEK.YZ.FE',  label: 'Frontend',          depth: 3, parentCode: 'TEK.YZ' },
  { code: 'TEK.YZ.MOB', label: 'Mobil',             depth: 3, parentCode: 'TEK.YZ' },
  { code: 'TEK.YZ.DOP', label: 'DevOps & Bulut',   depth: 3, parentCode: 'TEK.YZ' },

  // ── Seviye 3: Yapraklar — Veri & YZ ──────────────────────────────────────
  { code: 'TEK.VB.ML',  label: 'Makine Öğrenmesi', depth: 3, parentCode: 'TEK.VB' },
  { code: 'TEK.VB.DA',  label: 'Veri Analizi',     depth: 3, parentCode: 'TEK.VB' },
  { code: 'TEK.VB.GYZ', label: 'Generatif YZ',     depth: 3, parentCode: 'TEK.VB' },

  // ── Seviye 3: Yapraklar — STK ────────────────────────────────────────────
  { code: 'STK.PRJ.HB', label: 'Hibe Yazımı',      depth: 3, parentCode: 'STK.PRJ' },
  { code: 'STK.PRJ.IT', label: 'Etki Ölçümü',      depth: 3, parentCode: 'STK.PRJ' },
  { code: 'STK.KMY.GN', label: 'Gönüllü Yönetimi', depth: 3, parentCode: 'STK.KMY' },
];

async function seedIndustryNodes(): Promise<void> {
  console.log('\n🌳 IndustryNode taksonomi ağacı seed ediliyor...');

  const idByCode = new Map<string, string>();

  // Derinlik sırasıyla ekle — ebeveyn her zaman önce oluşturulur
  for (const node of INDUSTRY_TREE) {
    const parentId = node.parentCode ? idByCode.get(node.parentCode) ?? null : null;
    const record = await prisma.industryNode.upsert({
      where:  { code: node.code },
      update: { label: node.label, depth: node.depth, parentId },
      create: { code: node.code, label: node.label, depth: node.depth, parentId },
    });
    idByCode.set(node.code, record.id);
  }

  const count = await prisma.industryNode.count();
  console.log(`✅ IndustryNode ağacı tamamlandı: ${count} düğüm`);
  console.log(`   Seviye 1: ${INDUSTRY_TREE.filter(n => n.depth === 1).length} sektör`);
  console.log(`   Seviye 2: ${INDUSTRY_TREE.filter(n => n.depth === 2).length} alt-sektör`);
  console.log(`   Seviye 3: ${INDUSTRY_TREE.filter(n => n.depth === 3).length} yaprak`);
}

main()
  .catch((e) => {
    console.error('Seed hatası:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
