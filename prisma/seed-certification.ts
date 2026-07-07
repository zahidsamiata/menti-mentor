import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type CertOptionSeed = {
  key: string;
  label: string;
  competencyScore: number;
};

type CertQuestionSeed = {
  code: string;
  dimension: string;
  scenario: string;
  isRedLine: boolean;
  options: CertOptionSeed[];
};

const CERT_QUESTIONS: CertQuestionSeed[] = [
  {
    code: 'CERT_01',
    dimension: 'P1',
    isRedLine: false,
    scenario:
      "Menteen bir problemle geliyor ve 'Ne yapmalıyım?' diye soruyor. Senin bu problemi nasıl çözeceğine dair net bir fikrin var. Ne yaparsın?",
    options: [
      { key: 'A', competencyScore: 3, label: "'Sen olsan nasıl yaklaşırdın? Hangi seçenekleri görüyorsun?' diye sorup kendi çözümünü bulmasına rehberlik ederim." },
      { key: 'B', competencyScore: 1, label: 'Doğru cevabı net biçimde söylerim; vakit kaybetmesine gerek yok, deneyimim var.' },
      { key: 'C', competencyScore: 2, label: "Önce kendi fikrimi söyler, sonra 'sen ne düşünüyorsun?' diye eklerim." },
      { key: 'D', competencyScore: 0, label: "'Bu kadar basit bir şeyi kendin çözmelisin' deyip geçiştiririm." },
    ],
  },
  {
    code: 'CERT_02',
    dimension: 'P3',
    isRedLine: false,
    scenario:
      'Menteen bir konuyu anlatırken sen daha ilk cümlede sorununu ve çözümünü zaten anladığını düşünüyorsun. Menteen hâlâ konuşuyor. Ne yaparsın?',
    options: [
      { key: 'A', competencyScore: 0, label: "Sözünü keser, 'anladım, çözüm şu' diyerek doğrudan çözüme geçerim." },
      { key: 'B', competencyScore: 3, label: 'Sonuna kadar dinlerim; belki ilk izlenimimde kaçırdığım bir detay veya asıl mesele vardır.' },
      { key: 'C', competencyScore: 2, label: "Dinlerim ama 'özetle ne demek istiyorsun?' diye araya girip hızlandırırım." },
      { key: 'D', competencyScore: 1, label: 'Dinliyormuş gibi yapar, bu sırada çözümü kafamda hazırlarım.' },
    ],
  },
  {
    code: 'CERT_03',
    dimension: 'P2',
    isRedLine: true,
    scenario:
      'Menteen heyecanla bir fikir sunuyor ama fikirde ciddi bir kusur var. Menteenin bu konuda kırılgan ve özgüveninin düşük olduğunu biliyorsun. Geri bildirimini nasıl verirsin?',
    options: [
      { key: 'A', competencyScore: 0, label: "'Bu çalışmaz, baştan yanlış düşünmüşsün' diyerek kusuru net ve doğrudan söylerim." },
      { key: 'B', competencyScore: 3, label: "Önce güçlü yanını içtenlikle belirtir, sonra kusuru bir soru olarak açarım: 'Şu durumda ne olur sence?'" },
      { key: 'C', competencyScore: 1, label: "Kırılmasın diye kusuru hiç söylemem, 'güzel fikir' deyip geçerim." },
      { key: 'D', competencyScore: 2, label: "Kusuru söylerim ama 'merak etme, herkes hata yapar' diye yumuşatırım." },
    ],
  },
  {
    code: 'CERT_04',
    dimension: 'P4',
    isRedLine: true,
    scenario:
      'Menteen sana kişisel bir kriz yaşadığını (ailevi/psikolojik) ve çok zorlandığını anlatıyor, senden duygusal destek bekliyor. Bir mentör olarak doğru yaklaşım nedir?',
    options: [
      { key: 'A', competencyScore: 3, label: 'Empatiyle dinler, destekleyici olurum; ama uzmanlık alanım olmadığını belirtip profesyonel destek almaya nazikçe yönlendiririm.' },
      { key: 'B', competencyScore: 1, label: 'Bir terapist gibi soruna derinlemesine girer, psikolojik tavsiyeler vermeye çalışırım.' },
      { key: 'C', competencyScore: 0, label: "'Bu benim işim değil, sadece kariyer konuşuruz' deyip konuyu keserim." },
      { key: 'D', competencyScore: 2, label: 'Dinlerim ve kendi benzer deneyimlerimi paylaşarak yardımcı olmaya çalışırım.' },
    ],
  },
];

export async function seedCertification(): Promise<void> {
  console.log('\n🎓 Sertifikasyon soru havuzu seed ediliyor...');

  for (const q of CERT_QUESTIONS) {
    const question = await prisma.certificationQuestion.upsert({
      where: { code: q.code },
      update: {
        dimension: q.dimension,
        scenario: q.scenario,
        isRedLine: q.isRedLine,
        isActive: true,
      },
      create: {
        code: q.code,
        dimension: q.dimension,
        scenario: q.scenario,
        isRedLine: q.isRedLine,
      },
    });

    for (const opt of q.options) {
      await prisma.certificationOption.upsert({
        where: { questionId_key: { questionId: question.id, key: opt.key } },
        update: { label: opt.label, competencyScore: opt.competencyScore },
        create: {
          questionId: question.id,
          key: opt.key,
          label: opt.label,
          competencyScore: opt.competencyScore,
        },
      });
    }
  }

  const total = await prisma.certificationQuestion.count();
  console.log(`✅ Sertifikasyon seed tamamlandı: ${total} soru (${CERT_QUESTIONS.filter(q => q.isRedLine).length} red-line)`);
}
