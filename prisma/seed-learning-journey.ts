import { PrismaClient, LearningAudience } from '@prisma/client';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Öğrenme Yolculuğu — global çekirdek aşamalar (tenantId=null, KİLİTLİ).
// 13 aşama: Mentör 7 (audience=MENTOR) + Menti 6 (audience=MENTI).
// Mekanik: durum → seçenekler → seçim → tepki+neden → öğreti.
// "Sınav" DEĞİL "keşif": puanlama/geçme-kalma YOK. Yanlış seçim = öğrenme anı.
// Sertifikasyon (seed-certification.ts) motorundan tamamen AYRIDIR.
// ─────────────────────────────────────────────────────────────────────────────

type Choice = {
  key: string;
  label: string;
  outcome: 'correct' | 'warn' | 'wrong';
  feedback: string;
};

type StageSeed = {
  // Deterministik id: idempotent upsert için (aynı id ile tekrar seed => güncelle, kopya yaratma).
  id: string;
  audience: LearningAudience;
  order: number;
  title: string;
  situationText: string;
  learningGoal: string;
  isStkSpecific: boolean;
  choices: Choice[];
};

// STK editörüne rehber — tüm aşamalarda ortak (DRY). "İyi aşama nasıl yazılır?"
const AUTHORING_GUIDE =
  'İyi bir aşama: gerçek, somut bir durum kurar (kişi + an + gerilim); ' +
  '3-4 seçenek sunar; her seçeneğe bir outcome (correct / warn / wrong) ve ' +
  'onu neden öyle kıldığını açıklayan sıcak, öğretici bir feedback yazar. ' +
  'Puan YOK — amaç yargılamak değil, keşfettirmek. Yanlış seçim de bir öğrenme anıdır.';

const MENTOR_STAGES: StageSeed[] = [
  {
    id: 'seed-ls-mentor-1',
    audience: 'MENTOR',
    order: 1,
    title: 'Tanışma',
    learningGoal: 'Güven kurma, yargılamadan dinleme.',
    isStkSpecific: false,
    situationText:
      "İlk mentin Zeynep'le tanışıyorsun. Kameranın karşısında biraz gergin, ellerini kavuşturmuş. 'Merhaba' diyor, sesi titrek. İlk sözün ne olur?",
    choices: [
      {
        key: 'a',
        outcome: 'correct',
        label:
          'Merhaba Zeynep, tanıştığımıza sevindim — hiç acele yok, önce biraz sohbet edelim mi?',
        feedback:
          "Zeynep'in omuzları gevşiyor, gülümsüyor. Güven en başta kurulur. Menti kendini güvende hissetmeden açılamaz — ilk dakikalar ilişkinin tonunu belirler.",
      },
      {
        key: 'b',
        outcome: 'warn',
        label: 'Merhaba. Hedeflerini konuşalım, ne başarmak istiyorsun?',
        feedback:
          "Zeynep biraz irkiliyor, 'şey... emin değilim' diyor. Fena değil ama erken; menti daha ısınmadan hedef sormak baskı yaratabilir. Önce insan, sonra iş.",
      },
      {
        key: 'c',
        outcome: 'wrong',
        label: 'Merhaba, ben şunları yaptım, bunları başardım, sana çok faydam olur.',
        feedback:
          'Zeynep dinliyor ama sessizleşiyor. Mentorluk seni anlatmak değil; ilk andan itibaren odak mentide olmalı.',
      },
    ],
  },
  {
    id: 'seed-ls-mentor-2',
    audience: 'MENTOR',
    order: 2,
    title: 'Rolün sınırı',
    learningGoal: 'Koçluk vs söyleme, bağımsızlık.',
    isStkSpecific: false,
    situationText:
      "Zeynep bir sorunla geliyor: 'Staj başvurum reddedildi, ne yapmalıyım?' Sen benzer durumu yaşadın, çözümü biliyorsun. Ne yaparsın?",
    choices: [
      {
        key: 'a',
        outcome: 'correct',
        label: 'Sence neden reddedilmiş olabilir? Elinde hangi seçenekler var?',
        feedback:
          "Zeynep düşünüyor, 'aslında CV'mi hiç güncellememiştim' diyor — kendi fark ediyor. En güçlü öğrenme, mentinin kendi çözümüne ulaşmasıdır. Sen yol açarsın, o yürür.",
      },
      {
        key: 'b',
        outcome: 'warn',
        label: 'Ben olsam şunu yapardım — sen ne düşünüyorsun?',
        feedback:
          "Zeynep senin fikrini 'doğru cevap' sanıp kendi düşünmeyi bırakıyor. Fena değil ama sıralamayı ters çevirmek daha güçlü olurdu: önce o düşünsün.",
      },
      {
        key: 'c',
        outcome: 'wrong',
        label: 'Şunu şunu yap, olur biter. Deneyimim var.',
        feedback:
          'Zeynep not alıyor ama bir dahaki sefere yine sana koşacak. Hazır cevap kısa vadede hızlı, uzun vadede bağımlılık yaratır.',
      },
    ],
  },
  {
    id: 'seed-ls-mentor-3',
    audience: 'MENTOR',
    order: 3,
    title: 'Zor an (geri bildirim)',
    learningGoal: 'Yapıcı geri bildirim, şefkatli dürüstlük.',
    isStkSpecific: false,
    situationText:
      'Zeynep heyecanla bir proje fikri sunuyor. Gözleri parlıyor. Ama fikirde ciddi bir kusur var ve onun özgüveninin kırılgan olduğunu biliyorsun. Ne yaparsın?',
    choices: [
      {
        key: 'a',
        outcome: 'correct',
        label:
          'Önce gerçek bir güçlü yanını söyler, sonra kusuru soru olarak açarsın: "Şu kısmı çok yaratıcı. Peki şu durumda ne olur sence?"',
        feedback:
          "Zeynep bir an duruyor, 'hmm, orası sorun olabilir' diyor — kendi görüyor, hevesi kırılmıyor. Dürüstlük ve şefkat birlikte: güçlü yan güveni korur, soru fark ettirir.",
      },
      {
        key: 'b',
        outcome: 'warn',
        label: 'Güzel ama şurada sıkıntı var, merak etme herkes yapar.',
        feedback:
          "Zeynep kabul ediyor ama 'herkes yapar' biraz geçiştirici; kusuru kendisinin görmesini sağlamak daha öğretici olurdu.",
      },
      {
        key: 'c',
        outcome: 'wrong',
        label: 'Harika fikir, aynen devam et!',
        feedback:
          'Zeynep mutlu ayrılıyor ama yanlış yolda. Sahte övgü iyi niyetli ama zararlı — gelişmesini engeller ve güveni uzun vadede zedeler.',
      },
      {
        key: 'd',
        outcome: 'wrong',
        label: 'Bu çalışmaz, baştan yanlış kurmuşsun.',
        feedback:
          "Zeynep'in yüzü düşüyor, savunmaya geçiyor. Doğru olsan bile nasıl söylediğin önemli; kırılgan birini böyle geri çevirmek ilişkiyi koparabilir.",
      },
    ],
  },
  {
    id: 'seed-ls-mentor-4',
    audience: 'MENTOR',
    order: 4,
    title: 'Mesafe & sınır',
    learningGoal: 'Sağlıklı sınır, rol netliği.',
    isStkSpecific: false,
    situationText:
      'Zeynep sana güveniyor — o kadar ki artık günün her saati mesaj atıyor, gece yarısı bile. Bu seni yormaya başladı. Ne yaparsın?',
    choices: [
      {
        key: 'a',
        outcome: 'correct',
        label:
          'Sana değer veriyorum Zeynep. En iyi desteği şu saatlerde verebilirim, böylece her konuşmamız daha kaliteli olur.',
        feedback:
          "Zeynep anlıyor, 'tabii, kusura bakma' diyor. Sağlıklı sınır ilişkiyi korur — hem seni tüketmez hem Zeynep'in kendi ayakları üstünde durmasını destekler.",
      },
      {
        key: 'b',
        outcome: 'warn',
        label: 'İdare edersin, bir şey demezsin; yorulsan da cevap vermeye devam edersin.',
        feedback:
          'Bir süre sonra tükeniyorsun, mesajlara geç dönmeye başlıyorsun. Sınırı ertelemek onu daha zor koyulur hale getirir; söylenmeyen sınır ikinizi de yıpratır.',
      },
      {
        key: 'c',
        outcome: 'wrong',
        label: 'Aniden uzaklaşırsın; rahatsız olunca mesajları görmezden gelirsin.',
        feedback:
          'Zeynep ne olduğunu anlamıyor, kendini terk edilmiş hissediyor. Sınır konuşarak konur; sessiz çekilme incitir.',
      },
    ],
  },
  {
    id: 'seed-ls-mentor-5',
    audience: 'MENTOR',
    order: 5,
    title: 'Kriz anı (rolün ötesi)',
    learningGoal: 'Kriz yönetimi, rolün sınırı (red-line).',
    isStkSpecific: false,
    situationText:
      "Bir görüşmede Zeynep aniden sessizleşiyor, gözleri doluyor. 'Son zamanlarda hiçbir şey anlamlı gelmiyor, çok yoruldum' diyor. Ne yaparsın?",
    choices: [
      {
        key: 'a',
        outcome: 'correct',
        label:
          'Yargılamadan dinlersin, yanında olduğunu belli edersin ve nazikçe profesyonel bir desteğe (okul psikoloğu/uzman) yönlendirirsin.',
        feedback:
          'Zeynep duyulduğunu hissediyor. Bir mentör önemseyebilir ama terapist değildir — dinlemek ve doğru yere yönlendirmek en değerli ve en sorumlu davranıştır.',
      },
      {
        key: 'b',
        outcome: 'warn',
        label: 'Sadece dinlersin; içtenlikle dinlersin ama orada bırakırsın.',
        feedback:
          'Destek iyi, ama yeterli değil. Ciddi bir durumda yönlendirme yapmamak, mentinin ihtiyaç duyduğu gerçek yardımı almasını geciktirebilir.',
      },
      {
        key: 'c',
        outcome: 'wrong',
        label: 'Boş ver, herkesin kötü günü olur, geçer!',
        feedback:
          "Zeynep'in hissi hafife alınmış oluyor, daha da kapanıyor. İyi niyetli ama ciddi bir sıkıntıyı geçiştirmek kişiyi yalnızlaştırır.",
      },
      {
        key: 'd',
        outcome: 'wrong',
        label: "'Bu benim alanım değil' deyip başka şeye geçersin.",
        feedback:
          'Zeynep en kırılgan anında yalnız kalıyor. En azından dinlemek ve yönlendirmek insani bir sorumluluktur.',
      },
    ],
  },
  {
    id: 'seed-ls-mentor-6',
    audience: 'MENTOR',
    order: 6,
    title: 'Gönüllülük ruhu',
    learningGoal: 'Gönüllü motivasyonu, anlam.',
    isStkSpecific: true,
    situationText:
      "Zeynep derneğinizdeki gönüllü projede mentin. Bir gün yorgun görünüyor: 'Karşılığında bir şey almıyorum ki, neden uğraşıyorum bilmiyorum' diyor. Ne yaparsın?",
    choices: [
      {
        key: 'a',
        outcome: 'correct',
        label:
          'Geçen ay senin hazırladığın etkinlik 40 kişiye ulaştı — onların hayatına dokundun. Seni buraya getiren o his neydi, birlikte hatırlayalım mı?',
        feedback:
          "Zeynep düşünüyor, 'aslında birine faydam dokunsun istemiştim' diyor, gözleri canlanıyor. Gönüllülük maddi değil anlamla beslenir; etkiyi somut göstermek tükenmişliğin panzehiridir.",
      },
      {
        key: 'b',
        outcome: 'warn',
        label: 'Biraz dinlen, sonra devam edersin.',
        feedback:
          "Dinlenme iyi ama altta yatan 'anlam kaybını' konuşmazsan Zeynep moladan sonra aynı yere döner.",
      },
      {
        key: 'c',
        outcome: 'wrong',
        label: 'Herkes bazen böyle hisseder, geçer.',
        feedback:
          "Zeynep'in gerçek sorusu ('neden uğraşıyorum') cevapsız kalıyor. Hissini küçümsemek onu uzaklaştırır.",
      },
      {
        key: 'd',
        outcome: 'wrong',
        label: 'Gönüllülük bu, istemiyorsan bırakabilirsin.',
        feedback:
          "Zeynep'in emeği bir anda değersizleşiyor. Bu, gönüllüde kopmanın en hızlı yolu.",
      },
    ],
  },
  {
    id: 'seed-ls-mentor-7',
    audience: 'MENTOR',
    order: 7,
    title: 'Denge (okul/gönüllülük)',
    learningGoal: 'Gerçek hayatla gönüllülük dengesi.',
    isStkSpecific: true,
    situationText:
      'Zeynep sınav dönemine girdi ve projedeki görevlerini aksatmaya başladı. Proje de aksıyor. Ne yaparsın?',
    choices: [
      {
        key: 'a',
        outcome: 'correct',
        label:
          'Şu an okulun önceliğin, çok doğru. Görevleri sınavdan sonrasına birlikte yeniden planlayalım mı?',
        feedback:
          'Zeynep rahatlıyor, sadık kalıyor. Mentinin uzun vadeli iyiliği projeden önce gelir; esneklik hem onu korur hem bağlılığını artırır.',
      },
      {
        key: 'b',
        outcome: 'warn',
        label: 'Sınav bitene kadar hiç karışmazsın: "Tamam, sonra konuşuruz."',
        feedback:
          'Esnek ama görevleri birlikte yeniden planlamadığın için proje boşlukta kalıyor; küçük bir plan ikisini de korurdu.',
      },
      {
        key: 'c',
        outcome: 'wrong',
        label: 'Yine de görevleri beklersin: "Söz vermiştin, yine de yapman lazım."',
        feedback:
          'Zeynep sınav stresine bir de bu baskıyı ekleyince kopma noktasına geliyor. Gerçek hayatı yok saymak aidiyeti kırar.',
      },
    ],
  },
];

const MENTI_STAGES: StageSeed[] = [
  {
    id: 'seed-ls-menti-1',
    audience: 'MENTI',
    order: 1,
    title: 'Tanışma',
    learningGoal: 'Mentörden ne beklenir/beklenmez.',
    isStkSpecific: false,
    situationText:
      "İlk mentörün Deniz'le tanışıyorsun. Güler yüzlü, 'Nasıl yardımcı olabilirim?' diyor. İçinden ne bekliyorsun?",
    choices: [
      {
        key: 'a',
        outcome: 'correct',
        label: 'Bana yol göstersin, ama adımları ben atacağım.',
        feedback:
          'Doğru başlangıç. Mentör bir pusuladır, taşıyıcı değil. En çok fayda görenler, rehberliği kendi çabalarıyla birleştirenlerdir.',
      },
      {
        key: 'b',
        outcome: 'warn',
        label: 'Umarım benim için her şeyi halleder, bana iş bulur.',
        feedback:
          'Bu beklentiyle başlarsan hayal kırıklığı kaçınılmaz. Deniz sana kapıları gösterebilir ama içinden senin geçmen gerekir.',
      },
      {
        key: 'c',
        outcome: 'wrong',
        label: 'Herhalde çok bir şey değişmez, öylesine bakayım.',
        feedback:
          'Bu tavır, en büyük fırsatı kaçırmanın yolu. Mentorluğa ne kadar açık gelirsen, o kadar çok alırsın — düşük beklentiyle başlarsan, alacağın da az olur.',
      },
    ],
  },
  {
    id: 'seed-ls-menti-2',
    audience: 'MENTI',
    order: 2,
    title: 'Sorumluluk',
    learningGoal: 'Menti kendi gelişiminin öznesi.',
    isStkSpecific: false,
    situationText:
      "Deniz sana bir öneride bulunuyor: 'Şu beceriyi geliştirmek için şunu deneyebilirsin.' Görüşme bitti. Ne yaparsın?",
    choices: [
      {
        key: 'a',
        outcome: 'correct',
        label: 'Öneriyi denersin, sonucu not alır, bir sonraki görüşmeye getirirsin.',
        feedback:
          "Deniz'in gözünde değerin artıyor — çünkü rehberliği işe dönüştürüyorsun. Menti kendi gelişiminin öznesidir; sahiplenen menti en hızlı büyür.",
      },
      {
        key: 'b',
        outcome: 'warn',
        label: "'Bir dahaki görüşmede detaylandırır herhalde' deyip bir şey yapmazsın.",
        feedback:
          'Bir sonraki görüşmede ilerleme olmuyor. Rehberlik ancak sen harekete geçince değer üretir.',
      },
      {
        key: 'c',
        outcome: 'wrong',
        label: 'Görüşme bitince öneriyi bir kenara bırakırsın.',
        feedback:
          'İlişki yavaşça sönüyor. Emek vermeyen taraf, ilişkinin de emeğini almaz.',
      },
    ],
  },
  {
    id: 'seed-ls-menti-3',
    audience: 'MENTI',
    order: 3,
    title: 'Açık iletişim',
    learningGoal: 'Sağlıklı iletişim, savunmasız açıklık.',
    isStkSpecific: false,
    situationText:
      'Deniz bir şey anlattı ama sen tam anlamadın. Aptalca görünmekten çekiniyorsun. Ne yaparsın?',
    choices: [
      {
        key: 'a',
        outcome: 'correct',
        label: 'Şu kısmı tam yakalayamadım, biraz daha açar mısın?',
        feedback:
          'Deniz memnun, çünkü gerçekten öğrenmek istediğini görüyor. Soru sormak zayıflık değil, en hızlı öğrenme yoludur — ve mentörünü de rahatlatır.',
      },
      {
        key: 'b',
        outcome: 'warn',
        label: 'Anlamış gibi yaparsın; başını sallar, geçiştirirsin.',
        feedback:
          'Sonra o konuda zorlanıyorsun ama artık sormak daha zor. Anlamadan geçmek, boşluğu büyütür.',
      },
      {
        key: 'c',
        outcome: 'warn',
        label: 'Kendi kendine çözmeye çalışırsın; sormadan, tek başına anlamaya uğraşırsın.',
        feedback:
          'Bağımsızlık iyi ama mentorluğun amacı tam da bu boşlukları birlikte kapatmak; sormak zaman kazandırır.',
      },
    ],
  },
  {
    id: 'seed-ls-menti-4',
    audience: 'MENTI',
    order: 4,
    title: 'Sınır & saygı',
    learningGoal: 'Sağlıklı sınır, karşılıklılık.',
    isStkSpecific: false,
    situationText:
      "Deniz'le aran iyi. Ama son zamanlarda ondan çok şey ister oldun — sık sık acil mesajlar, küçük iyilikler. Bir gün cevabı gecikiyor. Ne düşünürsün?",
    choices: [
      {
        key: 'a',
        outcome: 'correct',
        label: "Deniz'in de kendi hayatı var, gerçekçi olmam lazım.",
        feedback:
          'Sağlıklı düşünce. Mentorluk karşılıklı saygıya dayanır; mentörünün zamanına saygı, ilişkiyi uzun ömürlü kılar.',
      },
      {
        key: 'b',
        outcome: 'wrong',
        label: 'Demek bana değer vermiyor.',
        feedback:
          'Bu düşünce ilişkiyi zehirler. Gecikmeyi kişisel almak, gerçekçi olmayan beklentiden gelir.',
      },
      {
        key: 'c',
        outcome: 'warn',
        label: 'Belki yeterince net olmadım, daha çok yazayım.',
        feedback:
          'Sınır zorlamak ilişkiyi yıpratır. Mentör sınırsız erişilebilir bir kaynak değil, bir rehberdir.',
      },
    ],
  },
  {
    id: 'seed-ls-menti-5',
    audience: 'MENTI',
    order: 5,
    title: 'Süreklilik',
    learningGoal: 'Bağlılık, erken kopmayı önleme.',
    isStkSpecific: false,
    situationText:
      "İşlerin yoğunlaştı, Deniz'le görüşmeleri ertelemeye başladın. Bir buluşmayı da habersiz kaçırdın. Ne yaparsın?",
    choices: [
      {
        key: 'a',
        outcome: 'correct',
        label: "Deniz'e yazıp durumunu açıklar, yeni bir zaman ayarlarsın.",
        feedback:
          'Deniz anlıyor, ilişki güçlenerek devam ediyor. Dürüst iletişim, aksaklıkları ilişkiyi bitiren değil, güçlendiren anlara çevirir.',
      },
      {
        key: 'b',
        outcome: 'wrong',
        label: 'Habersiz kaybolursun; utandığın için hiç yazmazsın.',
        feedback:
          'Deniz ne olduğunu bilmiyor, ilişki sessizce kopuyor. Kaçınmak sorunu çözmez, ilişkiyi bitirir.',
      },
      {
        key: 'c',
        outcome: 'warn',
        label: 'Bahane üretirsin; gerçeği söylemek yerine kaçamak cevaplar verirsin.',
        feedback:
          'Güven zedeleniyor. Dürüstlük, kısa vadede zor olsa da ilişkiyi korur.',
      },
    ],
  },
  {
    id: 'seed-ls-menti-6',
    audience: 'MENTI',
    order: 6,
    title: 'Aidiyet',
    learningGoal: 'Topluluğa aidiyet.',
    isStkSpecific: true,
    situationText:
      "Deniz'le mentorluğun bir dernek içinde. Ama sen kendini hep 'dışarıdan biri' gibi hissediyorsun, etkinliklere katılmıyorsun. Ne yaparsın?",
    choices: [
      {
        key: 'a',
        outcome: 'correct',
        label: 'Küçük de olsa bir etkinliğe katılır, topluluğa bir şeyler katmayı denersin.',
        feedback:
          'Zamanla kendini ait hissediyorsun, mentorluğun da zenginleşiyor. Mentorluk sadece iki kişilik değil; bir topluluğun parçası olmak deneyimi büyütür.',
      },
      {
        key: 'b',
        outcome: 'warn',
        label: "Uzak durursun: 'Ben sadece Deniz'le çalışayım yeter.'",
        feedback:
          'Rehberlik alıyorsun ama topluluğun sunduğu bağları, fırsatları kaçırıyorsun. Aidiyet, katılımla kurulur.',
      },
      {
        key: 'c',
        outcome: 'wrong',
        label: "Beklersin: 'Beni çağırırlarsa giderim.'",
        feedback:
          'Pasif kalmak yalnızlaştırır. Topluluğa ait olmak, çağrılmayı beklemek değil, adım atmaktır.',
      },
    ],
  },
];

const ALL_STAGES: StageSeed[] = [...MENTOR_STAGES, ...MENTI_STAGES];

export async function seedLearningJourney(): Promise<void> {
  console.log('\n🚀 Öğrenme Yolculuğu aşamaları seed ediliyor...');

  for (const s of ALL_STAGES) {
    const data = {
      audience: s.audience,
      order: s.order,
      title: s.title,
      situationText: s.situationText,
      learningGoal: s.learningGoal,
      authoringGuide: AUTHORING_GUIDE,
      isStkSpecific: s.isStkSpecific,
      choices: s.choices,
      isActive: true,
    };
    await prisma.learningStage.upsert({
      where: { id: s.id },
      update: { ...data, tenantId: null },
      create: { id: s.id, tenantId: null, ...data },
    });
  }

  const mentor = await prisma.learningStage.count({
    where: { tenantId: null, audience: 'MENTOR', isActive: true },
  });
  const menti = await prisma.learningStage.count({
    where: { tenantId: null, audience: 'MENTI', isActive: true },
  });
  console.log(`✅ Öğrenme Yolculuğu seed tamamlandı: Mentör ${mentor} + Menti ${menti} aşama.`);
}

// Doğrudan çalıştırma desteği (npx tsx prisma/seed-learning-journey.ts)
const isDirectRun = process.argv[1]?.includes('seed-learning-journey');
if (isDirectRun) {
  seedLearningJourney()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
