import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Mentör Sertifika Senaryo Bankası (statik — canlıda AI/token YOK)
// Kaynak: prisma/senaryo-bankasi-tam.md — 10 konu × 2 varyant = 20 senaryo.
// Her seçenek: competencyScore (3=en doğru, 2=kabul edilebilir, 1=zayıf, 0=zararlı)
// + explanation (öğrenme metni). outcome puandan türetilir (correct/acceptable/wrong).
// Puanlama/eşik motoru: certification.service.ts (ilk-deneme + red-line).
// ─────────────────────────────────────────────────────────────────────────────

type CertOptionSeed = {
  key: string;
  competencyScore: number;
  label: string;
  explanation: string;
};

type CertQuestionSeed = {
  code: string;
  topic: string;      // konu grubu slug — varyantları bağlar
  variant: string;    // "A" | "B"
  dimension: string;  // legacy alan (zorunlu) — konu slug'ı ile doldurulur
  isRedLine: boolean;
  scenario: string;
  options: CertOptionSeed[];
};

// score → outcome eşlemesi (UI rozeti + değerlendirme sinyali)
function outcomeFor(score: number): string {
  if (score === 3) return 'correct';
  if (score === 2) return 'acceptable';
  return 'wrong'; // 1 (zayıf) ve 0 (zararlı)
}

const CERT_QUESTIONS: CertQuestionSeed[] = [
  // ── KONU 1 — Cevabı verme, buldur (Genel, red-line değil) ───────────────────
  {
    code: 'CERT_T01_A', topic: 'cevabi-verme-buldur', variant: 'A', dimension: 'cevabi-verme-buldur', isRedLine: false,
    scenario: `Mentin bir sorunla geliyor ve "Ne yapmalıyım?" diye soruyor. Sen bu sorunu nasıl çözeceğini çok iyi biliyorsun. Ne yaparsın?`,
    options: [
      { key: 'A', competencyScore: 3, label: `"'Sen olsan nasıl yaklaşırdın, hangi seçenekleri görüyorsun?' diye sorup kendi çözümünü bulmasına rehberlik ederim."`, explanation: `Doğru. İyi mentörlük "söylemek" değil "buldurmaktır"; menti kendi çözümüne ulaşınca hem öğrenir hem bağımsızlaşır. (Kaynak: CIMER "fostering independence".)` },
      { key: 'C', competencyScore: 2, label: `"Önce kendi fikrimi söyler, sonra 'sen ne düşünüyorsun?' diye eklerim."`, explanation: `Kabul edilebilir ama ideal değil: kendi fikrini önce söylersen menti onu 'doğru cevap' sanıp düşünmeyi bırakabilir. Sırayı ters çevirmek daha güçlü.` },
      { key: 'B', competencyScore: 1, label: `"Doğru cevabı net söylerim; deneyimim var, vakit kaybetmesin."`, explanation: `Zayıf: kısa vadede hızlı ama menti sana bağımlı kalır, kendi problem çözme becerisini geliştiremez.` },
      { key: 'D', competencyScore: 0, label: `"'Bu kadar basit şeyi kendin çöz' deyip geçiştiririm."`, explanation: `Zararlı: küçümser ve yardımı reddeder; menti bir daha sormaya çekinir, güven kırılır.` },
    ],
  },
  {
    code: 'CERT_T01_B', topic: 'cevabi-verme-buldur', variant: 'B', dimension: 'cevabi-verme-buldur', isRedLine: false,
    scenario: `Mentin bir kariyer kararında ("bu işi kabul etsem mi?") senin görüşünü soruyor. Senin net bir tercihin var. Ne yaparsın?`,
    options: [
      { key: 'A', competencyScore: 3, label: `"Kendi kriterlerini netleştirmesine yardım ederim: 'Senin için en önemli 3 şey ne? Hangisi bunları karşılıyor?'"`, explanation: `Doğru: karar onun hayatı; senin işin karar vermek değil, karar verme çerçevesi kazandırmak.` },
      { key: 'C', competencyScore: 2, label: `"Deneyimimi paylaşırım ama 'bu benim yolumdu, seninki farklı olabilir' derim."`, explanation: `Kabul edilebilir: deneyim paylaşmak değerli, ama yine de kendi ölçütünü kurmasına yardım daha kalıcı.` },
      { key: 'B', competencyScore: 1, label: `"Bence şunu seç, derim; sonuçta tecrübeliyim."`, explanation: `Zayıf: kendi tercihini dayatmak mentinin sahiplenmediği bir karara yol açar.` },
      { key: 'D', competencyScore: 0, label: `"'Bu senin kararın, bana ne' deyip konuyu kapatırım."`, explanation: `Zararlı: rehberliği tamamen reddetmek de bir uçtur; menti yalnız bırakılmış hisseder.` },
    ],
  },

  // ── KONU 2 — Yapıcı geri bildirim (Genel, RED-LINE) ─────────────────────────
  {
    code: 'CERT_T02_A', topic: 'yapici-geri-bildirim', variant: 'A', dimension: 'yapici-geri-bildirim', isRedLine: true,
    scenario: `Mentin heyecanla bir fikir sunuyor ama fikirde ciddi bir kusur var. Mentinin kırılgan ve özgüveninin düşük olduğunu biliyorsun. Geri bildirimini nasıl verirsin?`,
    options: [
      { key: 'B', competencyScore: 3, label: `"Önce güçlü yanını içtenlikle belirtir, sonra kusuru soru olarak açarım: 'Şu durumda ne olur sence?'"`, explanation: `Doğru: gerçek bir güçlü yan güveni korur, kusuru soruyla açmak mentinin kendi görmesini sağlar. Dürüstlük + şefkat birlikte. (Kaynak: yapıcı geri bildirim — Core Mentoring Skills, NCSU; güven — Leck & Orser 2013.)` },
      { key: 'D', competencyScore: 2, label: `"Kusuru söylerim ama 'merak etme, herkes hata yapar' diye yumuşatırım."`, explanation: `Kabul edilebilir: dürüst, ama 'herkes hata yapar' geçiştirici; asıl öğretici olan kusuru kendisinin görmesini sağlamak.` },
      { key: 'C', competencyScore: 1, label: `"Kırılmasın diye kusuru hiç söylemem, 'güzel fikir' derim."`, explanation: `Zayıf: iyi niyetli ama zararlı — menti yanlıştan dönemez, sahte övgü uzun vadede güveni zedeler.` },
      { key: 'A', competencyScore: 0, label: `"'Bu çalışmaz, baştan yanlış düşünmüşsün' derim."`, explanation: `Zararlı: dürüst ama şefkatsiz; kırılgan mentinin özgüvenini yıkar, ilişkiyi kopma riskine sokar. Doğruyu söylemek yetmez, nasıl söylediğin de önemlidir.` },
    ],
  },
  {
    code: 'CERT_T02_B', topic: 'yapici-geri-bildirim', variant: 'B', dimension: 'yapici-geri-bildirim', isRedLine: true,
    scenario: `Derneğinizde gönüllü olan mentin, hazırladığı etkinlik planını gururla sunuyor. Ama plan bütçeyi çok aşıyor ve uygulanamaz. Menti bu işe haftalarca emek vermiş. Ne yaparsın?`,
    options: [
      { key: 'B', competencyScore: 3, label: `"Emeğini ve güçlü fikirlerini takdir eder, sonra 'bütçeyle nasıl uyarlarız?' diye birlikte çözmeye çalışırım."`, explanation: `Doğru: emeği tanımak motivasyonu korur; kısıtı birlikte çözmek hem gerçekçi hem güçlendirici.` },
      { key: 'D', competencyScore: 2, label: `"Güzel olmuş derim ama bütçeyi aştığını da açıkça söylerim."`, explanation: `Kabul edilebilir: dürüst, ama 'birlikte çözme' adımı olmadan menti yılabilir.` },
      { key: 'C', competencyScore: 1, label: `"Moralini bozmam, plan güzel deyip bütçe sorununu sonra ben hallederim."`, explanation: `Zayıf: menti gerçek kısıtı öğrenemez; ayrıca yükü tek başına üstlenmek sürdürülebilir değil.` },
      { key: 'A', competencyScore: 0, label: `"'Bu bütçeyle olmaz, baştan düşünmemişsin' derim."`, explanation: `Zararlı: gönüllü emeğini değersizleştirmek, gönüllüde tükenmişlik ve kopmanın en hızlı yoludur.` },
    ],
  },

  // ── KONU 3 — Beklentileri hizalama (Genel, red-line değil) ──────────────────
  {
    code: 'CERT_T03_A', topic: 'beklentileri-hizalama', variant: 'A', dimension: 'beklentileri-hizalama', isRedLine: false,
    scenario: `Yeni bir mentiyle ilk görüşmeniz. Menti hevesli ama ne sıklıkta görüşeceğiniz, neyi bekleyebileceği konusunda hiçbir şey konuşulmadı. Ne yaparsın?`,
    options: [
      { key: 'A', competencyScore: 3, label: `"İlk görüşmede birlikte net bir çerçeve kurarız: ne sıklıkta, hangi konularda, karşılıklı ne bekliyoruz."`, explanation: `Doğru: net beklenti mentorluğun temelidir; belirsizlik en sık hayal kırıklığı ve kopma nedenidir. (Kaynak: CIMER "aligning expectations"; kopma nedenleri — Eby & McManus 2004.)` },
      { key: 'C', competencyScore: 2, label: `"İlk birkaç görüşmeyi doğal bırakır, sonra gerekirse çerçeve koyarım."`, explanation: `Kabul edilebilir ama riskli: beklenti boşluğu erken dönemde yanlış anlaşılma yaratabilir.` },
      { key: 'B', competencyScore: 1, label: `"Menti ne isterse ona göre giderim, kural koymam."`, explanation: `Zayıf: yapısızlık çoğu zaman ilişkinin sönmesiyle sonuçlanır.` },
      { key: 'D', competencyScore: 0, label: `"Kendi kurallarımı koyar, uymasını beklerim."`, explanation: `Zararlı: tek taraflı dayatma karşılıklılığı yok eder; menti sürece sahip çıkmaz.` },
    ],
  },
  {
    code: 'CERT_T03_B', topic: 'beklentileri-hizalama', variant: 'B', dimension: 'beklentileri-hizalama', isRedLine: false,
    scenario: `Mentin senden, verebileceğinin çok üstünde bir şey bekliyormuş gibi konuşuyor — tüm kariyer sorunlarını çözmeni, ona iş bulmanı umuyor. Ne yaparsın?`,
    options: [
      { key: 'A', competencyScore: 3, label: `"Nazikçe rolümü netleştiririm: 'Sana yol göstermede yanındayım, ama kararları ve adımları sen atacaksın' derim."`, explanation: `Doğru: gerçekçi beklenti, ileride 'bana yardım etmedi' hissini önler.` },
      { key: 'C', competencyScore: 2, label: `"Elimden geleni yaparım der, sınırı zamanla netleştiririm."`, explanation: `Kabul edilebilir ama beklentiyi baştan netleştirmemek sonradan daha büyük hayal kırıklığı doğurur.` },
      { key: 'B', competencyScore: 1, label: `"Söz vermeden elimden geleni yaparım, umarım yeter."`, explanation: `Zayıf: belirsiz söz, gerçekçi olmayan beklentiyi besler.` },
      { key: 'D', competencyScore: 0, label: `"Ben her şeyi hallederim, merak etme derim."`, explanation: `Zararlı: taşıyamayacağın sözü vermek; yerine getirilemeyince güven çöker.` },
    ],
  },

  // ── KONU 4 — Aktif dinleme & yargılamama (Genel, red-line değil) ────────────
  {
    code: 'CERT_T04_A', topic: 'aktif-dinleme', variant: 'A', dimension: 'aktif-dinleme', isRedLine: false,
    scenario: `Mentin üç haftadır görüşmelere geç geliyor ve son buluşmayı habersiz kaçırdı. Ne yaparsın?`,
    options: [
      { key: 'A', competencyScore: 3, label: `"Yargılamadan neler olduğunu, bir engel mi var, hedefler hâlâ uygun mu diye açık uçlu sorarım."`, explanation: `Doğru: geç kalma çoğu zaman ilgisizlik değil, dış engel ya da yanlış hedef işareti. Kopmalar 'ceza' ile değil 'anlama' ile önlenir. (Kaynak: Grossman & Rhodes 2002; Eby & McManus 2004.)` },
      { key: 'B', competencyScore: 2, label: `"Nazikçe devamlılığın önemini hatırlatır, sonra dinlerim."`, explanation: `Kabul edilebilir: sınır koymak iyi, ama önce anlamak daha güçlüdür; hatırlatmayı anlamanın ardına koymak daha etkili.` },
      { key: 'C', competencyScore: 1, label: `"Bir şey demeden devam ederim, belki yoğundur."`, explanation: `Zayıf: örüntüyü görmezden gelmek sorunu büyütür; menti umursanmadığını sanabilir.` },
      { key: 'D', competencyScore: 0, label: `"Ciddiyetsizse programdan çıkarırım."`, explanation: `Zararlı: erken ve cezalandırıcı; menti savunmaya geçer, gerçek sebebi öğrenemezsin, ilişkiyi gereksiz bitirirsin.` },
    ],
  },
  {
    code: 'CERT_T04_B', topic: 'aktif-dinleme', variant: 'B', dimension: 'aktif-dinleme', isRedLine: false,
    scenario: `Görüşme sırasında mentin sana bir şey anlatırken, sen sıradaki tavsiyeni düşünmeye başladığını fark ediyorsun; onu tam dinlemiyorsun. Ne yaparsın?`,
    options: [
      { key: 'A', competencyScore: 3, label: `"Kendimi durdurur, dikkatimi ona geri veririm; gerekirse 'bir daha söyler misin, tam anlamak istiyorum' derim."`, explanation: `Doğru: aktif dinleme çaba ister; anlaşıldığını hissetmek mentinin açılmasını sağlar.` },
      { key: 'C', competencyScore: 2, label: `"Konuşmasını beklerim, sonra genel bir cevap veririm."`, explanation: `Kabul edilebilir ama tam dinlememek çoğu zaman cevabın da yüzeysel olmasına yol açar.` },
      { key: 'B', competencyScore: 1, label: `"Tavsiyemi vermeye odaklanırım, önemli olan çözüm."`, explanation: `Zayıf: çözüm odaklılık iyi ama önce doğru anlamadan verilen çözüm çoğu zaman yanlış hedefe gider.` },
      { key: 'D', competencyScore: 0, label: `"Zaten ne diyeceğini tahmin ediyorum, sözünü keserim."`, explanation: `Zararlı: sözünü kesmek ve varsaymak, mentinin duyulmadığını hissetmesine ve kapanmasına yol açar.` },
    ],
  },

  // ── KONU 5 — Sınır koyma & rol netliği (Genel, RED-LINE) ────────────────────
  {
    code: 'CERT_T05_A', topic: 'sinir-koyma', variant: 'A', dimension: 'sinir-koyma', isRedLine: true,
    scenario: `Mentin sana günün her saati mesaj atıyor, kişisel sorunlarında sürekli senden anlık destek bekliyor. Bu seni yıpratmaya başladı. Ne yaparsın?`,
    options: [
      { key: 'B', competencyScore: 3, label: `"Şefkatle ama net bir sınır koyarım: 'Sana değer veriyorum; en iyi desteği şu saatlerde/şu şekilde verebilirim' derim."`, explanation: `Doğru: sağlıklı sınır ilişkiyi korur; sınırsız erişim hem seni tüketir hem mentinin bağımsızlığını engeller.` },
      { key: 'D', competencyScore: 2, label: `"Şimdilik idare ederim, çok yorulunca konuşurum."`, explanation: `Kabul edilebilir değil-e yakın: ertelemek sınırı daha zor koyulur hale getirir; tükenince koyulan sınır sert olur.` },
      { key: 'C', competencyScore: 1, label: `"Elimden geldiğince hep cevap veririm, menti bu."`, explanation: `Zayıf: fedakârlık gibi görünür ama sürdürülemez; tükenmişlik ve ani kopma riski.` },
      { key: 'A', competencyScore: 0, label: `"Rahatsız edici, mesajları görmezden gelirim."`, explanation: `Zararlı: sessiz çekilme mentiyi terk edilmiş hissettirir; sınır konuşularak konur, yok sayarak değil.` },
    ],
  },
  {
    code: 'CERT_T05_B', topic: 'sinir-koyma', variant: 'B', dimension: 'sinir-koyma', isRedLine: true,
    scenario: `Mentin, mentorluk ilişkinizi arkadaşlığa dönüştürmeye çalışıyor; seni kişisel etkinliklerine çağırıyor, senden özel iyilikler istiyor. Bu, mentorluk rolünü bulanıklaştırıyor. Ne yaparsın?`,
    options: [
      { key: 'B', competencyScore: 3, label: `"Sıcaklığı korurum ama rolümüzü nazikçe netleştiririm: 'Sana mentörün olarak en çok şu şekilde faydalı olabilirim' derim."`, explanation: `Doğru: sıcak ama net rol, ilişkinin amacını korur; bulanık roller sonradan hayal kırıklığı ve karmaşa yaratır.` },
      { key: 'D', competencyScore: 2, label: `"Bazı davetleri kabul eder, işi de sürdürürüm; dengeyi tutmaya çalışırım."`, explanation: `Kabul edilebilir ama risklidir: net konuşulmayan sınır zamanla iyice bulanır.` },
      { key: 'C', competencyScore: 1, label: `"Kırmamak için çoğu isteğini kabul ederim."`, explanation: `Zayıf: rol bulanıklaşınca mentorluğun hedefi kaybolur, sen de yıpranırsın.` },
      { key: 'A', competencyScore: 0, label: `"Mesafeyi korumak için soğur, uzaklaşırım."`, explanation: `Zararlı: ani soğukluk mentiyi reddedilmiş hissettirir; sınır sıcaklıkla birlikte konur.` },
    ],
  },

  // ── KONU 6 — Gönüllü tükenmişliği & motivasyon (STK-özel, red-line değil) ────
  {
    code: 'CERT_T06_A', topic: 'gonullu-tukenmisligi', variant: 'A', dimension: 'gonullu-tukenmisligi', isRedLine: false,
    scenario: `Menti-gönüllü, başta çok hevesliydi ama birkaç aydır enerjisi düşük; "ne için uğraşıyorum ki, kimse fark etmiyor" dedi. Ne yaparsın?`,
    options: [
      { key: 'A', competencyScore: 3, label: `"Emeğinin somut etkisini hatırlatır, onu neyin motive ettiğini yeniden keşfetmesine yardım ederim."`, explanation: `Doğru: gönüllü motivasyonu 'anlam' ve 'görülme' ile beslenir; etkiyi somut göstermek tükenmişliğin panzehiridir.` },
      { key: 'C', competencyScore: 2, label: `"Biraz mola vermesini öneririm."`, explanation: `Kabul edilebilir: dinlenme iyi, ama altta yatan 'anlam kaybını' ele almazsan mola sonrası aynı yere döner.` },
      { key: 'B', competencyScore: 1, label: `"Herkes yorulur, geçer derim."`, explanation: `Zayıf: hissini küçümser; tükenmişlik 'geçer' denerek geçmez.` },
      { key: 'D', competencyScore: 0, label: `"Gönüllülük bu, istemiyorsan bırakabilirsin derim."`, explanation: `Zararlı: kapıyı gösterir; aidiyeti ve emeği bir anda değersizleştirir.` },
    ],
  },
  {
    code: 'CERT_T06_B', topic: 'gonullu-tukenmisligi', variant: 'B', dimension: 'gonullu-tukenmisligi', isRedLine: false,
    scenario: `Menti-gönüllün çok yetenekli ama derneğin işleri hep aynı birkaç kişiye yükleniyor ve o da "sürekli ben mi yapıyorum" diye yakınmaya başladı. Ne yaparsın?`,
    options: [
      { key: 'A', competencyScore: 3, label: `"Haklı olduğunu kabul eder, yükün adil dağılması için birlikte somut bir yol ararım."`, explanation: `Doğru: gönüllüde adalet hissi motivasyonun temelidir; şikâyeti ciddiye almak tükenmeyi önler.` },
      { key: 'C', competencyScore: 2, label: `"Ne kadar değerli olduğunu vurgular, biraz daha dayanmasını rica ederim."`, explanation: `Kabul edilebilir ama takdir tek başına adaletsiz yükü çözmez; yapısal sorun sürer.` },
      { key: 'B', competencyScore: 1, label: `"Herkes elinden geleni yapıyor derim."`, explanation: `Zayıf: gerçek dengesizliği görmezden gelmek yakınmayı büyütür.` },
      { key: 'D', competencyScore: 0, label: `"En iyisi sen yapıyorsun, sana güveniyoruz derim."`, explanation: `Zararlı: iltifat gibi görünür ama yükü daha da o kişiye yıkar; tükenmişliği hızlandırır.` },
    ],
  },

  // ── KONU 7 — Okul/iş ile gönüllülük dengesi (STK-özel, red-line değil) ───────
  {
    code: 'CERT_T07_A', topic: 'okul-gonulluluk-dengesi', variant: 'A', dimension: 'okul-gonulluluk-dengesi', isRedLine: false,
    scenario: `Üniversite öğrencisi mentin sınav dönemine girdi ve gönüllü projedeki görevlerini aksatıyor. Proje de aksıyor. Ne yaparsın?`,
    options: [
      { key: 'A', competencyScore: 3, label: `"Önceliğinin okulu olduğunu açıkça onaylar, görevleri geçici olarak birlikte hafifletir/yeniden planlarız."`, explanation: `Doğru: mentinin uzun vadeli iyiliği projeden önce gelir; esneklik hem onu korur hem bağlılığı artırır.` },
      { key: 'C', competencyScore: 2, label: `"Sınav bitene kadar araya girmem, sonra devam ederiz."`, explanation: `Kabul edilebilir: esnek, ama görevleri birlikte yeniden planlamak projeyi de korur; tamamen bırakmak boşluk yaratır.` },
      { key: 'B', competencyScore: 1, label: `"Söz verdiği görevleri yine de yapmasını beklerim."`, explanation: `Zayıf: baskı, sınav stresine eklenince kopmaya yol açar.` },
      { key: 'D', competencyScore: 0, label: `"Sorumluluk alan bırakmamalı, güvenilmez derim."`, explanation: `Zararlı: öğrencinin gerçekliğini yok sayar; suçlamak aidiyeti kırar.` },
    ],
  },
  {
    code: 'CERT_T07_B', topic: 'okul-gonulluluk-dengesi', variant: 'B', dimension: 'okul-gonulluluk-dengesi', isRedLine: false,
    scenario: `Genç mentin, hem çalışıyor hem de gönüllü projede yer alıyor. Yorgunluktan projeye eskisi kadar katkı veremediği için kendini suçlu hissettiğini söyledi. Ne yaparsın?`,
    options: [
      { key: 'A', competencyScore: 3, label: `"Suçluluk hissini hafifletir, katkısının azını bile değerli bulduğumu belirtir, gerçekçi bir tempo birlikte belirleriz."`, explanation: `Doğru: gönüllülük yük değil, anlam olmalı; gerçekçi tempo hem sürdürülebilir hem sağlıklıdır.` },
      { key: 'C', competencyScore: 2, label: `"Elinden geleni yapması yeterli derim."`, explanation: `Kabul edilebilir ama somut bir gerçekçi plan olmadan suçluluk sürebilir.` },
      { key: 'B', competencyScore: 1, label: `"Herkes zorlanıyor, sen de idare et derim."`, explanation: `Zayıf: hissini normalleştirmek gibi görünse de aslında geçiştirir.` },
      { key: 'D', competencyScore: 0, label: `"Söz verdiysen yapmalısın derim."`, explanation: `Zararlı: zaten suçlu hisseden birine baskı; tükenme ve kopmayı hızlandırır.` },
    ],
  },

  // ── KONU 8 — Kültürel/bireysel farklılıklara saygı (Genel, red-line değil) ───
  {
    code: 'CERT_T08_A', topic: 'kulturel-farkliliklara-saygi', variant: 'A', dimension: 'kulturel-farkliliklara-saygi', isRedLine: false,
    scenario: `Mentin, senin alışkın olduğundan çok farklı bir çalışma tarzına ve değerlere sahip. Senin yönteminle çalışmıyor ama işini de yapıyor. Ne yaparsın?`,
    options: [
      { key: 'A', competencyScore: 3, label: `"Farklı tarzına saygı gösterir, sonuca odaklanırım; kendi yöntemimi dayatmam."`, explanation: `Doğru: mentorluk kendini kopyalamak değil; farklılık çoğu zaman güçtür. (Kaynak: CIMER "equity & inclusion".)` },
      { key: 'C', competencyScore: 2, label: `"Kendi yöntemimi öneririm ama seçimi ona bırakırım."`, explanation: `Kabul edilebilir: paylaşmak iyi, ama 'benimki daha doğru' iması olmadan.` },
      { key: 'B', competencyScore: 1, label: `"Zamanla benim tarzıma alışmasını beklerim."`, explanation: `Zayıf: örtük dayatma; mentinin kendi gücünü köreltir.` },
      { key: 'D', competencyScore: 0, label: `"Böyle olmaz, benim gibi çalışmalı derim."`, explanation: `Zararlı: kendini standart saymak; farklılığı hata gibi görmek dışlayıcıdır.` },
    ],
  },
  {
    code: 'CERT_T08_B', topic: 'kulturel-farkliliklara-saygi', variant: 'B', dimension: 'kulturel-farkliliklara-saygi', isRedLine: false,
    scenario: `Mentinin senden çok farklı bir dünya görüşü ve yaşam tarzı var. Bir konuda görüşü seninkine tamamen ters. Ne yaparsın?`,
    options: [
      { key: 'A', competencyScore: 3, label: `"Görüşüne saygı gösterir, merakla anlamaya çalışırım; amacım onu değiştirmek değil, gelişimine destek olmak."`, explanation: `Doğru: mentörlük ideolojik hizalama değil; farklı görüşe saygı güveni ve alanı korur.` },
      { key: 'C', competencyScore: 2, label: `"Kendi görüşümü belirtirim ama tartışmaya girmem."`, explanation: `Kabul edilebilir: paylaşmak sorun değil, ama 'benimki doğru' tonundan kaçınmak şart.` },
      { key: 'B', competencyScore: 1, label: `"Konuyu değiştirir, hiç girmem."`, explanation: `Zayıf: kaçınmak güvenli görünür ama gerçek bir bağ kurma fırsatını da kaçırır.` },
      { key: 'D', competencyScore: 0, label: `"Yanlış düşünüyorsun, ikna etmeye çalışırım."`, explanation: `Zararlı: mentiyi kendine benzetmeye çalışmak; güveni ve alanı yok eder.` },
    ],
  },

  // ── KONU 9 — Gizlilik & güven (Genel, RED-LINE) ─────────────────────────────
  {
    code: 'CERT_T09_A', topic: 'gizlilik-guven', variant: 'A', dimension: 'gizlilik-guven', isRedLine: true,
    scenario: `Mentin sana özel bir zorluğunu (ailevi bir sorun) güvenerek anlattı. Ertesi gün başka bir gönüllü "menti nasıl, bir sorunu mu var?" diye sordu. Ne yaparsın?`,
    options: [
      { key: 'B', competencyScore: 3, label: `"'Bunu onunla konuşman en iyisi' der, paylaşılanı korurum."`, explanation: `Doğru: güven mentorluğun temelidir; bir kez kırılırsa onarılması çok zordur.` },
      { key: 'C', competencyScore: 2, label: `"'İyi, sadece biraz yoğun' gibi geçiştiririm."`, explanation: `Kabul edilebilir: sır vermiyor ama en temizi hiç kapı aralamamak; 'onunla konuş' demek daha nettir.` },
      { key: 'D', competencyScore: 1, label: `"Genel bir şey söylerim, detay vermem."`, explanation: `Zayıf: 'genel' bile olsa mentinin özeline dair ima güveni riske atar.` },
      { key: 'A', competencyScore: 0, label: `"Sorunu olduğunu, ne yaşadığını anlatırım; yardım etsin diye."`, explanation: `Zararlı: iyi niyetli olsa bile güveni kırar; menti bir daha hiçbir şey paylaşmaz.` },
    ],
  },
  {
    code: 'CERT_T09_B', topic: 'gizlilik-guven', variant: 'B', dimension: 'gizlilik-guven', isRedLine: true,
    scenario: `Mentin sana bir hatasını utanarak itiraf etti ("aslında o işi ben batırdım"). Birkaç gün sonra kurumda o hatayla ilgili bir tartışma çıktı ve senin bildiğin ortaya çıkabilir. Ne yaparsın?`,
    options: [
      { key: 'B', competencyScore: 3, label: `"Mentinin bana güvenerek anlattığını korur, onu ifşa etmem; istersem onu kendisi konuşmaya cesaretlendiririm."`, explanation: `Doğru: güven mentorluğun temeli; menti hatasını sahiplenecekse bunu kendi yapmalı, sen ifşa ederek değil.` },
      { key: 'C', competencyScore: 2, label: `"Sessiz kalırım ama mentiyi durumu kendisinin açıklaması için teşvik ederim."`, explanation: `Kabul edilebilir ve 3'e yakın; tek fark, güveni koruduğunu ona açıkça hissettirmek daha güçlü olurdu.` },
      { key: 'D', competencyScore: 1, label: `"Sorulmadıkça bir şey söylemem ama sorulursa doğruyu söylerim."`, explanation: `Zayıf: mentinin güvenini koşullu hale getirir; 'sorulursa söylerim' güveni riske atar.` },
      { key: 'A', competencyScore: 0, label: `"Doğrusu bu, bildiğimi paylaşırım."`, explanation: `Zararlı: güvenle paylaşılanı ifşa etmek; menti bir daha sana hiçbir şey açmaz, mentorluk biter.` },
    ],
  },

  // ── KONU 10 — Kriz & hassas durum yönetimi (Genel, RED-LINE) ────────────────
  {
    code: 'CERT_T10_A', topic: 'kriz-yonetimi', variant: 'A', dimension: 'kriz-yonetimi', isRedLine: true,
    scenario: `Mentin görüşmede ciddi bir duygusal kriz belirtisi gösteriyor (umutsuzluk, "artık dayanamıyorum" gibi ifadeler). Ne yaparsın?`,
    options: [
      { key: 'B', competencyScore: 3, label: `"Yargılamadan dinler, ciddiye alır ve onu bir uzmana/profesyonel desteğe nazikçe yönlendiririm."`, explanation: `Doğru: mentör dinleyebilir ve önemseyebilir ama terapist değildir; doğru yönlendirme hayati olabilir. Rolünün sınırını bilmek sorumluluktur.` },
      { key: 'D', competencyScore: 2, label: `"Dinlerim ve yanında olduğumu söylerim."`, explanation: `Kabul edilebilir ama eksik: destek iyi, fakat profesyonel yönlendirme yapılmazsa mentör kapasitesinin ötesine geçmiş olur.` },
      { key: 'C', competencyScore: 1, label: `"Konuyu olumluya çevirmeye, moralini yükseltmeye çalışırım."`, explanation: `Zayıf: iyi niyetli ama ciddi krizi hafifletmek kişinin duygusunu geçersiz kılabilir.` },
      { key: 'A', competencyScore: 0, label: `"Bu benim işim değil, konuyu değiştiririm."`, explanation: `Zararlı: krizdeki birini görmezden gelmek; en azından dinlemek ve yönlendirmek gerekir.` },
    ],
  },
  {
    code: 'CERT_T10_B', topic: 'kriz-yonetimi', variant: 'B', dimension: 'kriz-yonetimi', isRedLine: true,
    scenario: `Mentin, sana ailesinde ciddi bir sağlık/şiddet durumu yaşadığını, çok zorlandığını anlatıyor. Sen bu konuda uzman değilsin ama menti senden yardım bekliyor. Ne yaparsın?`,
    options: [
      { key: 'B', competencyScore: 3, label: `"İçtenlikle dinler, yanında olduğumu belli eder ve onu doğru profesyonel desteğe (uzman/kurum) yönlendiririm."`, explanation: `Doğru: mentör önemseyebilir ama uzman değildir; şefkatli dinleme + doğru yönlendirme, kapasitenin ötesine geçmeden en faydalı olandır.` },
      { key: 'D', competencyScore: 2, label: `"Elimden geldiğince ona akıl vermeye, çözüm bulmaya çalışırım."`, explanation: `Kabul edilebilir değil-e yakın: iyi niyetli ama uzmanlık gerektiren bir konuda amatör tavsiye zarar verebilir; asıl doğru olan yönlendirmek.` },
      { key: 'C', competencyScore: 1, label: `"Çok üzülür, ben de kendi benzer deneyimimi anlatırım."`, explanation: `Zayıf: empati iyi ama odağı kendine çekmek ve profesyonel yönlendirme yapmamak eksik kalır.` },
      { key: 'A', competencyScore: 0, label: `"Bu çok ağır, bu konulara giremem deyip uzaklaşırım."`, explanation: `Zararlı: zor anında terk etmek; en azından dinlemek ve doğru yere yönlendirmek insani ve gereklidir.` },
    ],
  },
];

export async function seedCertification(): Promise<void> {
  console.log('\n🎓 Sertifikasyon senaryo bankası seed ediliyor...');

  for (const q of CERT_QUESTIONS) {
    const question = await prisma.certificationQuestion.upsert({
      where: { code: q.code },
      update: {
        dimension: q.dimension,
        topic: q.topic,
        variant: q.variant,
        scenario: q.scenario,
        isRedLine: q.isRedLine,
        isActive: true,
      },
      create: {
        code: q.code,
        dimension: q.dimension,
        topic: q.topic,
        variant: q.variant,
        scenario: q.scenario,
        isRedLine: q.isRedLine,
      },
    });

    for (const opt of q.options) {
      await prisma.certificationOption.upsert({
        where: { questionId_key: { questionId: question.id, key: opt.key } },
        update: {
          label: opt.label,
          competencyScore: opt.competencyScore,
          explanation: opt.explanation,
          outcome: outcomeFor(opt.competencyScore),
        },
        create: {
          questionId: question.id,
          key: opt.key,
          label: opt.label,
          competencyScore: opt.competencyScore,
          explanation: opt.explanation,
          outcome: outcomeFor(opt.competencyScore),
        },
      });
    }
  }

  // Yeni bankada olmayan eski soruları (ör. CERT_01..04) pasifleştir — silme yok,
  // veri korunur ama aktif havuzdan çıkar (additive + temiz devir).
  const activeCodes = CERT_QUESTIONS.map((q) => q.code);
  const deactivated = await prisma.certificationQuestion.updateMany({
    where: { code: { notIn: activeCodes }, isActive: true },
    data: { isActive: false },
  });

  const total = await prisma.certificationQuestion.count({ where: { isActive: true } });
  const redlines = CERT_QUESTIONS.filter((q) => q.isRedLine).length;
  console.log(
    `✅ Sertifikasyon seed tamamlandı: ${total} aktif soru (${redlines} red-line), ` +
    `${deactivated.count} eski soru pasifleştirildi.`,
  );
}
