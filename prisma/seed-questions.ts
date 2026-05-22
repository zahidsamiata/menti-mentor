import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CORE_QUESTIONS = [
  // D — Dominant
  { text: 'Bir grupta liderliği üstlenmekten keyif alırım.', discDimension: 'D', order: 1 },
  { text: 'Hızlı karar vermek beni rahatsız etmez; tereddüt etmekten hoşlanmam.', discDimension: 'D', order: 2 },
  { text: 'Hedef koyduğumda engelleri aşmak için ısrarcı olurum.', discDimension: 'D', order: 3 },
  { text: 'Rekabetçi ortamlarda en iyi performansımı sergilerim.', discDimension: 'D', order: 4 },
  // I — Influential
  { text: 'İnsanları bir araya getirip motive etmekten zevk alırım.', discDimension: 'I', order: 5 },
  { text: 'Yeni insanlarla tanışmak bana enerji verir.', discDimension: 'I', order: 6 },
  { text: 'Fikirlerimi coşkuyla paylaşır ve başkalarını ikna ederim.', discDimension: 'I', order: 7 },
  { text: 'Topluluk önünde konuşmak beni heyecanlandırır.', discDimension: 'I', order: 8 },
  // S — Steady
  { text: 'Bir projeyi tamamlamadan yenisine geçmemeyi tercih ederim.', discDimension: 'S', order: 9 },
  { text: 'Takım arkadaşlarımı desteklemek ve onlara yardım etmek benim için önemlidir.', discDimension: 'S', order: 10 },
  { text: 'Çatışma ortamından kaçınır, uzlaşı arayışına girerim.', discDimension: 'S', order: 11 },
  { text: 'Tutarlı ve öngörülebilir bir çalışma düzeni tercih ederim.', discDimension: 'S', order: 12 },
  // C — Conscientious
  { text: 'Bir işe başlamadan önce detaylı araştırma yapmayı severim.', discDimension: 'C', order: 13 },
  { text: 'Hata yapmamak için çalışmalarımı defalarca kontrol ederim.', discDimension: 'C', order: 14 },
  { text: 'Kurallara ve prosedürlere uymak benim için doğal bir alışkanlıktır.', discDimension: 'C', order: 15 },
  { text: 'Kalite, hız ve miktardan daha önemlidir.', discDimension: 'C', order: 16 },
] as const;

const DEEPENING_QUESTIONS = [
  { text: 'Stres altında bile sakin ve sistematik düşünmeyi sürdürebiliyorum.', discDimension: 'C', order: 17 },
  { text: 'Başarımı başkalarıyla paylaşmak beni tek başıma başarmaktan daha çok memnun eder.', discDimension: 'S', order: 18 },
  { text: 'Bir fikri savunmak için karşımdaki kişiyi tartışmaya girmeye hazırım.', discDimension: 'D', order: 19 },
  { text: 'Çevremdeki insanların duygusal durumunu hızla fark ederim.', discDimension: 'I', order: 20 },
] as const;

async function main() {
  console.log('Seed sorular ekleniyor...');

  for (const q of CORE_QUESTIONS) {
    await prisma.question.upsert({
      where: { id: `seed-core-${q.order}` },
      update: {},
      create: {
        id: `seed-core-${q.order}`,
        text: q.text,
        type: 'CORE',
        discDimension: q.discDimension,
        order: q.order,
        tenantId: null,
      },
    });
  }

  for (const q of DEEPENING_QUESTIONS) {
    await prisma.question.upsert({
      where: { id: `seed-deep-${q.order}` },
      update: {},
      create: {
        id: `seed-deep-${q.order}`,
        text: q.text,
        type: 'DEEPENING',
        discDimension: q.discDimension,
        order: q.order,
        tenantId: null,
      },
    });
  }

  console.log(`${CORE_QUESTIONS.length} CORE + ${DEEPENING_QUESTIONS.length} DEEPENING soru eklendi.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
