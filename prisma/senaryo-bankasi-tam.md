# Mentör Sertifika Senaryo Bankası — Tam Sürüm (v2)

> Durum: TAM TASLAK — kullanıcı onayı bekliyor. Onaylanınca Claude Code bu içeriği koda (seed)
> yerleştirecek. Kurum bu konulardan seçebilir/kaldırabilir; DÜZENLEYEMEZ, YENİ EKLEYEMEZ (puanlama
> uzmanlık gerektirdiği için kapalı). Canlı üründe AI/token kullanımı YOK — tüm içerik statiktir.

## Puanlama ve eşik mantığı (öneri — proje için en iyisi)

- Her seçenek 0-3 puan: **3=en doğru**, **2=kabul edilebilir**, **1=zayıf**, **0=zararlı**.
- "İlk-deneme" mantığı: mentörün her konudaki İLK seçimi kaydedilir.
  - Normal konu: ilk seçim 3 veya 2 → "geçer". 0-1 → o konu tekrar (farklı varyantla).
  - **Red-line konu** (kritik): ilk seçim SADECE 3 → geçer. 2/1/0 → mutlaka tekrar öğretilir.
- Sertifika eşiği: tüm konuların en az %80'inde ilk-denemede "geçer" almak (kalibre edilebilir).
- Yanlışta ceza/bekleme YOK: sistem aynı öğretinin FARKLI varyantını sunar (öğret, eleme).
- Her seçimden sonra açıklama gösterilir (öğrenme anı) — doğru seçse bile "neden doğru"yu okur.

## Format
Konu | Bağlam (genel/STK) | Kritik mi | Varyantlar. Her varyant: senaryo + 4 seçenek (puan) +
her seçeneğe açıklama. Kritik/önemli açıklamalarda akademik kaynak, rutinlerde sade dil.

═══════════════════════════════════════════════════════════════════════════════════════════════

## KONU 1 — Cevabı verme, buldur  |  Genel  |  Kritik: Hayır
*Yetkinlik: fostering independence — mentör tavsiye bürosu değil, mentinin kendi çözümünü buldurur.*

### Varyant A
**Senaryo:** Mentin bir sorunla geliyor ve "Ne yapmalıyım?" diye soruyor. Sen bu sorunu nasıl
çözeceğini çok iyi biliyorsun. Ne yaparsın?
- **A (3):** "'Sen olsan nasıl yaklaşırdın, hangi seçenekleri görüyorsun?' diye sorup kendi çözümünü
  bulmasına rehberlik ederim." → *Doğru. İyi mentörlük "söylemek" değil "buldurmaktır"; menti kendi
  çözümüne ulaşınca hem öğrenir hem bağımsızlaşır.* (Kaynak: CIMER "fostering independence".)
- **C (2):** "Önce kendi fikrimi söyler, sonra 'sen ne düşünüyorsun?' diye eklerim." → *Kabul
  edilebilir ama ideal değil: kendi fikrini önce söylersen menti onu 'doğru cevap' sanıp düşünmeyi
  bırakabilir. Sırayı ters çevirmek daha güçlü.*
- **B (1):** "Doğru cevabı net söylerim; deneyimim var, vakit kaybetmesin." → *Zayıf: kısa vadede
  hızlı ama menti sana bağımlı kalır, kendi problem çözme becerisini geliştiremez.*
- **D (0):** "'Bu kadar basit şeyi kendin çöz' deyip geçiştiririm." → *Zararlı: küçümser ve yardımı
  reddeder; menti bir daha sormaya çekinir, güven kırılır.*

### Varyant B
**Senaryo:** Mentin bir kariyer kararında ("bu işi kabul etsem mi?") senin görüşünü soruyor. Senin
net bir tercihin var. Ne yaparsın?
- **A (3):** "Kendi kriterlerini netleştirmesine yardım ederim: 'Senin için en önemli 3 şey ne?
  Hangisi bunları karşılıyor?'" → *Doğru: karar onun hayatı; senin işin karar vermek değil, karar
  verme çerçevesi kazandırmak.*
- **C (2):** "Deneyimimi paylaşırım ama 'bu benim yolumdu, seninki farklı olabilir' derim." →
  *Kabul edilebilir: deneyim paylaşmak değerli, ama yine de kendi ölçütünü kurmasına yardım daha
  kalıcı.*
- **B (1):** "Bence şunu seç, derim; sonuçta tecrübeliyim." → *Zayıf: kendi tercihini dayatmak
  mentinin sahiplenmediği bir karara yol açar.*
- **D (0):** "'Bu senin kararın, bana ne' deyip konuyu kapatırım." → *Zararlı: rehberliği tamamen
  reddetmek de bir uçtur; menti yalnız bırakılmış hisseder.*

═══════════════════════════════════════════════════════════════════════════════════════════════

## KONU 2 — Yapıcı geri bildirim  |  Genel  |  Kritik: EVET (red-line)
*Yetkinlik: constructive feedback — dürüstlük ve şefkati birlikte tutmak.*

### Varyant A
**Senaryo:** Mentin heyecanla bir fikir sunuyor ama fikirde ciddi bir kusur var. Mentinin kırılgan
ve özgüveninin düşük olduğunu biliyorsun. Geri bildirimini nasıl verirsin?
- **B (3):** "Önce güçlü yanını içtenlikle belirtir, sonra kusuru soru olarak açarım: 'Şu durumda ne
  olur sence?'" → *Doğru: gerçek bir güçlü yan güveni korur, kusuru soruyla açmak mentinin kendi
  görmesini sağlar. Dürüstlük + şefkat birlikte.* (Kaynak: yapıcı geri bildirim — Core Mentoring
  Skills, NCSU; güven — Leck & Orser 2013.)
- **D (2):** "Kusuru söylerim ama 'merak etme, herkes hata yapar' diye yumuşatırım." → *Kabul
  edilebilir: dürüst, ama 'herkes hata yapar' geçiştirici; asıl öğretici olan kusuru kendisinin
  görmesini sağlamak.*
- **C (1):** "Kırılmasın diye kusuru hiç söylemem, 'güzel fikir' derim." → *Zayıf: iyi niyetli ama
  zararlı — menti yanlıştan dönemez, sahte övgü uzun vadede güveni zedeler.*
- **A (0):** "'Bu çalışmaz, baştan yanlış düşünmüşsün' derim." → *Zararlı: dürüst ama şefkatsiz;
  kırılgan mentinin özgüvenini yıkar, ilişkiyi kopma riskine sokar. Doğruyu söylemek yetmez, nasıl
  söylediğin de önemlidir.*

### Varyant B  (STK bağlamı)
**Senaryo:** Derneğinizde gönüllü olan mentin, hazırladığı etkinlik planını gururla sunuyor. Ama
plan bütçeyi çok aşıyor ve uygulanamaz. Menti bu işe haftalarca emek vermiş. Ne yaparsın?
- **B (3):** "Emeğini ve güçlü fikirlerini takdir eder, sonra 'bütçeyle nasıl uyarlarız?' diye
  birlikte çözmeye çalışırım." → *Doğru: emeği tanımak motivasyonu korur; kısıtı birlikte çözmek
  hem gerçekçi hem güçlendirici.*
- **D (2):** "Güzel olmuş derim ama bütçeyi aştığını da açıkça söylerim." → *Kabul edilebilir:
  dürüst, ama 'birlikte çözme' adımı olmadan menti yılabilir.*
- **C (1):** "Moralini bozmam, plan güzel deyip bütçe sorununu sonra ben hallederim." → *Zayıf:
  menti gerçek kısıtı öğrenemez; ayrıca yükü tek başına üstlenmek sürdürülebilir değil.*
- **A (0):** "'Bu bütçeyle olmaz, baştan düşünmemişsin' derim." → *Zararlı: gönüllü emeğini
  değersizleştirmek, gönüllüde tükenmişlik ve kopmanın en hızlı yoludur.*

═══════════════════════════════════════════════════════════════════════════════════════════════

## KONU 3 — Beklentileri hizalama  |  Genel  |  Kritik: Hayır
*Yetkinlik: aligning expectations — baştan netlik, sonradan hayal kırıklığını önler.*

### Varyant A
**Senaryo:** Yeni bir mentiyle ilk görüşmeniz. Menti hevesli ama ne sıklıkta görüşeceğiniz, neyi
bekleyebileceği konusunda hiçbir şey konuşulmadı. Ne yaparsın?
- **A (3):** "İlk görüşmede birlikte net bir çerçeve kurarız: ne sıklıkta, hangi konularda, karşılıklı
  ne bekliyoruz." → *Doğru: net beklenti mentorluğun temelidir; belirsizlik en sık hayal kırıklığı
  ve kopma nedenidir.* (Kaynak: CIMER "aligning expectations"; kopma nedenleri — Eby & McManus 2004.)
- **C (2):** "İlk birkaç görüşmeyi doğal bırakır, sonra gerekirse çerçeve koyarım." → *Kabul
  edilebilir ama riskli: beklenti boşluğu erken dönemde yanlış anlaşılma yaratabilir.*
- **B (1):** "Menti ne isterse ona göre giderim, kural koymam." → *Zayıf: yapısızlık çoğu zaman
  ilişkinin sönmesiyle sonuçlanır.*
- **D (0):** "Kendi kurallarımı koyar, uymasını beklerim." → *Zararlı: tek taraflı dayatma
  karşılıklılığı yok eder; menti sürece sahip çıkmaz.*

### Varyant B
**Senaryo:** Mentin senden, verebileceğinin çok üstünde bir şey bekliyormuş gibi konuşuyor — tüm
kariyer sorunlarını çözmeni, ona iş bulmanı umuyor. Ne yaparsın?
- **A (3):** "Nazikçe rolümü netleştiririm: 'Sana yol göstermede yanındayım, ama kararları ve adımları
  sen atacaksın' derim." → *Doğru: gerçekçi beklenti, ileride 'bana yardım etmedi' hissini önler.*
- **C (2):** "Elimden geleni yaparım der, sınırı zamanla netleştiririm." → *Kabul edilebilir ama
  beklentiyi baştan netleştirmemek sonradan daha büyük hayal kırıklığı doğurur.*
- **B (1):** "Söz vermeden elimden geleni yaparım, umarım yeter." → *Zayıf: belirsiz söz, gerçekçi
  olmayan beklentiyi besler.*
- **D (0):** "Ben her şeyi hallederim, merak etme derim." → *Zararlı: taşıyamayacağın sözü vermek;
  yerine getirilemeyince güven çöker.*

═══════════════════════════════════════════════════════════════════════════════════════════════

## KONU 4 — Aktif dinleme & yargılamama  |  Genel  |  Kritik: Hayır
*Yetkinlik: active listening — anlamadan yargılamamak; erken kopmayı önler.*

### Varyant A
**Senaryo:** Mentin üç haftadır görüşmelere geç geliyor ve son buluşmayı habersiz kaçırdı. Ne
yaparsın?
- **A (3):** "Yargılamadan neler olduğunu, bir engel mi var, hedefler hâlâ uygun mu diye açık uçlu
  sorarım." → *Doğru: geç kalma çoğu zaman ilgisizlik değil, dış engel ya da yanlış hedef işareti.
  Kopmalar 'ceza' ile değil 'anlama' ile önlenir.* (Kaynak: Grossman & Rhodes 2002; Eby & McManus 2004.)
- **B (2):** "Nazikçe devamlılığın önemini hatırlatır, sonra dinlerim." → *Kabul edilebilir: sınır
  koymak iyi, ama önce anlamak daha güçlüdür; hatırlatmayı anlamanın ardına koymak daha etkili.*
- **C (1):** "Bir şey demeden devam ederim, belki yoğundur." → *Zayıf: örüntüyü görmezden gelmek
  sorunu büyütür; menti umursanmadığını sanabilir.*
- **D (0):** "Ciddiyetsizse programdan çıkarırım." → *Zararlı: erken ve cezalandırıcı; menti
  savunmaya geçer, gerçek sebebi öğrenemezsin, ilişkiyi gereksiz bitirirsin.*

### Varyant B
**Senaryo:** Görüşme sırasında mentin sana bir şey anlatırken, sen sıradaki tavsiyeni düşünmeye
başladığını fark ediyorsun; onu tam dinlemiyorsun. Ne yaparsın?
- **A (3):** "Kendimi durdurur, dikkatimi ona geri veririm; gerekirse 'bir daha söyler misin, tam
  anlamak istiyorum' derim." → *Doğru: aktif dinleme çaba ister; anlaşıldığını hissetmek mentinin
  açılmasını sağlar.*
- **C (2):** "Konuşmasını beklerim, sonra genel bir cevap veririm." → *Kabul edilebilir ama tam
  dinlememek çoğu zaman cevabın da yüzeysel olmasına yol açar.*
- **B (1):** "Tavsiyemi vermeye odaklanırım, önemli olan çözüm." → *Zayıf: çözüm odaklılık iyi ama
  önce doğru anlamadan verilen çözüm çoğu zaman yanlış hedefe gider.*
- **D (0):** "Zaten ne diyeceğini tahmin ediyorum, sözünü keserim." → *Zararlı: sözünü kesmek ve
  varsaymak, mentinin duyulmadığını hissetmesine ve kapanmasına yol açar.*

═══════════════════════════════════════════════════════════════════════════════════════════════

## KONU 5 — Sınır koyma & rol netliği  |  Genel  |  Kritik: EVET (red-line)
*Yetkinlik: boundaries — mentör terapist/ebeveyn/patron değildir.*

### Varyant A
**Senaryo:** Mentin sana günün her saati mesaj atıyor, kişisel sorunlarında sürekli senden anlık
destek bekliyor. Bu seni yıpratmaya başladı. Ne yaparsın?
- **B (3):** "Şefkatle ama net bir sınır koyarım: 'Sana değer veriyorum; en iyi desteği şu saatlerde/
  şu şekilde verebilirim' derim." → *Doğru: sağlıklı sınır ilişkiyi korur; sınırsız erişim hem seni
  tüketir hem mentinin bağımsızlığını engeller.*
- **D (2):** "Şimdilik idare ederim, çok yorulunca konuşurum." → *Kabul edilebilir değil-e yakın:
  ertelemek sınırı daha zor koyulur hale getirir; tükenince koyulan sınır sert olur.*
- **C (1):** "Elimden geldiğince hep cevap veririm, menti bu." → *Zayıf: fedakârlık gibi görünür ama
  sürdürülemez; tükenmişlik ve ani kopma riski.*
- **A (0):** "Rahatsız edici, mesajları görmezden gelirim." → *Zararlı: sessiz çekilme mentiyi
  terk edilmiş hissettirir; sınır konuşularak konur, yok sayarak değil.*

### Varyant B
**Senaryo:** Mentin, mentorluk ilişkinizi arkadaşlığa dönüştürmeye çalışıyor; seni kişisel
etkinliklerine çağırıyor, senden özel iyilikler istiyor. Bu, mentorluk rolünü bulanıklaştırıyor.
Ne yaparsın?
- **B (3):** "Sıcaklığı korurum ama rolümüzü nazikçe netleştiririm: 'Sana mentörün olarak en çok
  şu şekilde faydalı olabilirim' derim." → *Doğru: sıcak ama net rol, ilişkinin amacını korur;
  bulanık roller sonradan hayal kırıklığı ve karmaşa yaratır.*
- **D (2):** "Bazı davetleri kabul eder, işi de sürdürürüm; dengeyi tutmaya çalışırım." → *Kabul
  edilebilir ama risklidir: net konuşulmayan sınır zamanla iyice bulanır.*
- **C (1):** "Kırmamak için çoğu isteğini kabul ederim." → *Zayıf: rol bulanıklaşınca mentorluğun
  hedefi kaybolur, sen de yıpranırsın.*
- **A (0):** "Mesafeyi korumak için soğur, uzaklaşırım." → *Zararlı: ani soğukluk mentiyi
  reddedilmiş hissettirir; sınır sıcaklıkla birlikte konur.*

═══════════════════════════════════════════════════════════════════════════════════════════════

## KONU 6 — Gönüllü tükenmişliği & motivasyon  |  STK-özel  |  Kritik: Hayır
*Yetkinlik: STK bağlamı — ücretsiz emeğin sürdürülebilirliği.*

### Varyant A
**Senaryo:** Menti-gönüllü, başta çok hevesliydi ama birkaç aydır enerjisi düşük; "ne için
uğraşıyorum ki, kimse fark etmiyor" dedi. Ne yaparsın?
- **A (3):** "Emeğinin somut etkisini hatırlatır, onu neyin motive ettiğini yeniden keşfetmesine
  yardım ederim." → *Doğru: gönüllü motivasyonu 'anlam' ve 'görülme' ile beslenir; etkiyi somut
  göstermek tükenmişliğin panzehiridir.*
- **C (2):** "Biraz mola vermesini öneririm." → *Kabul edilebilir: dinlenme iyi, ama altta yatan
  'anlam kaybını' ele almazsan mola sonrası aynı yere döner.*
- **B (1):** "Herkes yorulur, geçer derim." → *Zayıf: hissini küçümser; tükenmişlik 'geçer' denerek
  geçmez.*
- **D (0):** "Gönüllülük bu, istemiyorsan bırakabilirsin derim." → *Zararlı: kapıyı gösterir;
  aidiyeti ve emeği bir anda değersizleştirir.*

### Varyant B
**Senaryo:** Menti-gönüllün çok yetenekli ama derneğin işleri hep aynı birkaç kişiye yükleniyor ve
o da "sürekli ben mi yapıyorum" diye yakınmaya başladı. Ne yaparsın?
- **A (3):** "Haklı olduğunu kabul eder, yükün adil dağılması için birlikte somut bir yol ararım." →
  *Doğru: gönüllüde adalet hissi motivasyonun temelidir; şikâyeti ciddiye almak tükenmeyi önler.*
- **C (2):** "Ne kadar değerli olduğunu vurgular, biraz daha dayanmasını rica ederim." → *Kabul
  edilebilir ama takdir tek başına adaletsiz yükü çözmez; yapısal sorun sürer.*
- **B (1):** "Herkes elinden geleni yapıyor derim." → *Zayıf: gerçek dengesizliği görmezden gelmek
  yakınmayı büyütür.*
- **D (0):** "En iyisi sen yapıyorsun, sana güveniyoruz derim." → *Zararlı: iltifat gibi görünür ama
  yükü daha da o kişiye yıkar; tükenmişliği hızlandırır.*

═══════════════════════════════════════════════════════════════════════════════════════════════

## KONU 7 — Okul/iş ile gönüllülük dengesi  |  STK-özel  |  Kritik: Hayır
*Yetkinlik: STK bağlamı — mentiler çoğu genç/öğrenci; hayat dengesi.*

### Varyant A
**Senaryo:** Üniversite öğrencisi mentin sınav dönemine girdi ve gönüllü projedeki görevlerini
aksatıyor. Proje de aksıyor. Ne yaparsın?
- **A (3):** "Önceliğinin okulu olduğunu açıkça onaylar, görevleri geçici olarak birlikte
  hafifletir/yeniden planlarız." → *Doğru: mentinin uzun vadeli iyiliği projeden önce gelir; esneklik
  hem onu korur hem bağlılığı artırır.*
- **C (2):** "Sınav bitene kadar araya girmem, sonra devam ederiz." → *Kabul edilebilir: esnek, ama
  görevleri birlikte yeniden planlamak projeyi de korur; tamamen bırakmak boşluk yaratır.*
- **B (1):** "Söz verdiği görevleri yine de yapmasını beklerim." → *Zayıf: baskı, sınav stresine
  eklenince kopmaya yol açar.*
- **D (0):** "Sorumluluk alan bırakmamalı, güvenilmez derim." → *Zararlı: öğrencinin gerçekliğini
  yok sayar; suçlamak aidiyeti kırar.*

### Varyant B
**Senaryo:** Genç mentin, hem çalışıyor hem de gönüllü projede yer alıyor. Yorgunluktan projeye eskisi
kadar katkı veremediği için kendini suçlu hissettiğini söyledi. Ne yaparsın?
- **A (3):** "Suçluluk hissini hafifletir, katkısının azını bile değerli bulduğumu belirtir, gerçekçi
  bir tempo birlikte belirleriz." → *Doğru: gönüllülük yük değil, anlam olmalı; gerçekçi tempo hem
  sürdürülebilir hem sağlıklıdır.*
- **C (2):** "Elinden geleni yapması yeterli derim." → *Kabul edilebilir ama somut bir gerçekçi plan
  olmadan suçluluk sürebilir.*
- **B (1):** "Herkes zorlanıyor, sen de idare et derim." → *Zayıf: hissini normalleştirmek gibi
  görünse de aslında geçiştirir.*
- **D (0):** "Söz verdiysen yapmalısın derim." → *Zararlı: zaten suçlu hisseden birine baskı;
  tükenme ve kopmayı hızlandırır.*

═══════════════════════════════════════════════════════════════════════════════════════════════

## KONU 8 — Kültürel/bireysel farklılıklara saygı  |  Genel  |  Kritik: Hayır
*Yetkinlik: equity & inclusion — mentiyi kendine benzetmeye çalışmamak.*

### Varyant A
**Senaryo:** Mentin, senin alışkın olduğundan çok farklı bir çalışma tarzına ve değerlere sahip.
Senin yönteminle çalışmıyor ama işini de yapıyor. Ne yaparsın?
- **A (3):** "Farklı tarzına saygı gösterir, sonuca odaklanırım; kendi yöntemimi dayatmam." →
  *Doğru: mentorluk kendini kopyalamak değil; farklılık çoğu zaman güçtür.* (Kaynak: CIMER "equity &
  inclusion".)
- **C (2):** "Kendi yöntemimi öneririm ama seçimi ona bırakırım." → *Kabul edilebilir: paylaşmak iyi,
  ama 'benimki daha doğru' iması olmadan.*
- **B (1):** "Zamanla benim tarzıma alışmasını beklerim." → *Zayıf: örtük dayatma; mentinin kendi
  gücünü köreltir.*
- **D (0):** "Böyle olmaz, benim gibi çalışmalı derim." → *Zararlı: kendini standart saymak;
  farklılığı hata gibi görmek dışlayıcıdır.*

### Varyant B
**Senaryo:** Mentinin senden çok farklı bir dünya görüşü ve yaşam tarzı var. Bir konuda görüşü seninkine
tamamen ters. Ne yaparsın?
- **A (3):** "Görüşüne saygı gösterir, merakla anlamaya çalışırım; amacım onu değiştirmek değil,
  gelişimine destek olmak." → *Doğru: mentörlük ideolojik hizalama değil; farklı görüşe saygı güveni
  ve alanı korur.*
- **C (2):** "Kendi görüşümü belirtirim ama tartışmaya girmem." → *Kabul edilebilir: paylaşmak sorun
  değil, ama 'benimki doğru' tonundan kaçınmak şart.*
- **B (1):** "Konuyu değiştirir, hiç girmem." → *Zayıf: kaçınmak güvenli görünür ama gerçek bir bağ
  kurma fırsatını da kaçırır.*
- **D (0):** "Yanlış düşünüyorsun, ikna etmeye çalışırım." → *Zararlı: mentiyi kendine benzetmeye
  çalışmak; güveni ve alanı yok eder.*

═══════════════════════════════════════════════════════════════════════════════════════════════

## KONU 9 — Gizlilik & güven  |  Genel  |  Kritik: EVET (red-line)
*Yetkinlik: confidentiality — mentinin paylaştığını korumak.*

### Varyant A
**Senaryo:** Mentin sana özel bir zorluğunu (ailevi bir sorun) güvenerek anlattı. Ertesi gün başka
bir gönüllü "menti nasıl, bir sorunu mu var?" diye sordu. Ne yaparsın?
- **B (3):** "'Bunu onunla konuşman en iyisi' der, paylaşılanı korurum." → *Doğru: güven
  mentorluğun temelidir; bir kez kırılırsa onarılması çok zordur.*
- **C (2):** "'İyi, sadece biraz yoğun' gibi geçiştiririm." → *Kabul edilebilir: sır vermiyor ama en
  temizi hiç kapı aralamamak; 'onunla konuş' demek daha nettir.*
- **D (1):** "Genel bir şey söylerim, detay vermem." → *Zayıf: 'genel' bile olsa mentinin özeline
  dair ima güveni riske atar.*
- **A (0):** "Sorunu olduğunu, ne yaşadığını anlatırım; yardım etsin diye." → *Zararlı: iyi niyetli
  olsa bile güveni kırar; menti bir daha hiçbir şey paylaşmaz.*

### Varyant B
**Senaryo:** Mentin sana bir hatasını utanarak itiraf etti ("aslında o işi ben batırdım"). Birkaç gün
sonra kurumda o hatayla ilgili bir tartışma çıktı ve senin bildiğin ortaya çıkabilir. Ne yaparsın?
- **B (3):** "Mentinin bana güvenerek anlattığını korur, onu ifşa etmem; istersem onu kendisi
  konuşmaya cesaretlendiririm." → *Doğru: güven mentorluğun temeli; menti hatasını sahiplenecekse bunu
  kendi yapmalı, sen ifşa ederek değil.*
- **C (2):** "Sessiz kalırım ama mentiyi durumu kendisinin açıklaması için teşvik ederim." → *Kabul
  edilebilir ve 3'e yakın; tek fark, güveni koruduğunu ona açıkça hissettirmek daha güçlü olurdu.*
- **D (1):** "Sorulmadıkça bir şey söylemem ama sorulursa doğruyu söylerim." → *Zayıf: mentinin
  güvenini koşullu hale getirir; 'sorulursa söylerim' güveni riske atar.*
- **A (0):** "Doğrusu bu, bildiğimi paylaşırım." → *Zararlı: güvenle paylaşılanı ifşa etmek; menti
  bir daha sana hiçbir şey açmaz, mentorluk biter.*

═══════════════════════════════════════════════════════════════════════════════════════════════

## KONU 10 — Kriz & hassas durum yönetimi (rolün sınırı)  |  Genel  |  Kritik: EVET (red-line)
*Yetkinlik: menti ciddi kişisel krizde — dinle ama uzman değilsin, doğru yönlendir.*

### Varyant A
**Senaryo:** Mentin görüşmede ciddi bir duygusal kriz belirtisi gösteriyor (umutsuzluk, "artık
dayanamıyorum" gibi ifadeler). Ne yaparsın?
- **B (3):** "Yargılamadan dinler, ciddiye alır ve onu bir uzmana/profesyonel desteğe nazikçe
  yönlendiririm." → *Doğru: mentör dinleyebilir ve önemseyebilir ama terapist değildir; doğru
  yönlendirme hayati olabilir. Rolünün sınırını bilmek sorumluluktur.*
- **D (2):** "Dinlerim ve yanında olduğumu söylerim." → *Kabul edilebilir ama eksik: destek iyi,
  fakat profesyonel yönlendirme yapılmazsa mentör kapasitesinin ötesine geçmiş olur.*
- **C (1):** "Konuyu olumluya çevirmeye, moralini yükseltmeye çalışırım." → *Zayıf: iyi niyetli ama
  ciddi krizi hafifletmek kişinin duygusunu geçersiz kılabilir.*
- **A (0):** "Bu benim işim değil, konuyu değiştiririm." → *Zararlı: krizdeki birini görmezden
  gelmek; en azından dinlemek ve yönlendirmek gerekir.*

### Varyant B
**Senaryo:** Mentin, sana ailesinde ciddi bir sağlık/şiddet durumu yaşadığını, çok zorlandığını
anlatıyor. Sen bu konuda uzman değilsin ama menti senden yardım bekliyor. Ne yaparsın?
- **B (3):** "İçtenlikle dinler, yanında olduğumu belli eder ve onu doğru profesyonel desteğe
  (uzman/kurum) yönlendiririm." → *Doğru: mentör önemseyebilir ama uzman değildir; şefkatli dinleme +
  doğru yönlendirme, kapasitenin ötesine geçmeden en faydalı olandır.*
- **D (2):** "Elimden geldiğince ona akıl vermeye, çözüm bulmaya çalışırım." → *Kabul edilebilir
  değil-e yakın: iyi niyetli ama uzmanlık gerektiren bir konuda amatör tavsiye zarar verebilir; asıl
  doğru olan yönlendirmek.*
- **C (1):** "Çok üzülür, ben de kendi benzer deneyimimi anlatırım." → *Zayıf: empati iyi ama odağı
  kendine çekmek ve profesyonel yönlendirme yapmamak eksik kalır.*
- **A (0):** "Bu çok ağır, bu konulara giremem deyip uzaklaşırım." → *Zararlı: zor anında terk etmek;
  en azından dinlemek ve doğru yere yönlendirmek insani ve gereklidir.*

═══════════════════════════════════════════════════════════════════════════════════════════════

## ÖZET
- **10 konu, her biri 2 varyant = 20 senaryo.** ("Yanlış yaparsa aynı öğretinin farklı varyantıyla
  tekrar dene" mekanizması için her konuda en az 2 varyant var.)
- **Konu dağılımı:** 8 genel mentorluk + 2 STK-özel (gönüllü tükenmişliği, okul-gönüllülük dengesi).
  Ayrıca bazı genel konularda STK varyantı (geri bildirim Varyant B: dernek etkinlik planı).
- **4 red-line (kritik) konu:** yapıcı geri bildirim, sınır koyma, gizlilik, kriz yönetimi — bunlarda
  ilk-denemede sadece en doğru (3) geçer.
- **Kaynaklı açıklamalar:** kritik konularda akademik dayanak (CIMER, Grossman & Rhodes, Eby &
  McManus, Leck & Orser); rutinlerde sade dil.

## STK KONTROLÜ (kurum ne yapabilir)
- Kurum bu 10 konudan istediğini **açar/kapatır** (seçme/kaldırma).
- Kurum senaryoları **DÜZENLEYEMEZ**, **YENİ EKLEYEMEZ**, puanlamaya dokunamaz (uzmanlık gerektirir,
  yanlış puanlama sertifikayı bozar — bu yüzden kapalı).
- Canlı üründe **AI/token kullanımı YOK** — tüm içerik statik, önceden hazırlanmış.

## SONRAKİ ADIM (içerik onaylandı)
İçerik hazır. Claude Code'a verilecek iş paketleri (hepsi statik, AI yok):
1. **Paket A:** Şema — `CertificationOption`'a `explanation` (açıklama) + `outcome` (correct/acceptable/
   wrong) alanları; senaryolara `variant` + `topic` + `isRedLine` yapısı. Migration (Neon kuralı).
2. **Paket B:** Seed — bu 20 senaryoyu koda yerleştir.
3. **Paket C:** Motor — ilk-deneme oranı + eşik + red-line kuralı + "yanlışta farklı varyant sun"
   mantığı. Testler.
4. **Paket D:** UI — öğrenme akışı ekranı (senaryo → seçim → açıklama → sonraki; menti/orientation-guide
   desenini kullan). Sonda otomatik sertifika + rozet.
5. **Paket E:** STK admin paneli — konu aç/kapat.
6. **Paket F (sonra):** Davet linki + hatırlatma maili (kişiyi sistemde tutma).
