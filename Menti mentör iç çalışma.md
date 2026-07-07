# Sekme 1

### **Faz 1: İş Gereksinimleri ve Kapsam Tanımlama**

* Derneklerin, STK'ların, vakıfların ve üniversite kulüplerinin mezunları ile gönüllülerini bir araya getirecek veri odaklı sistemin temel iş kuralları dokümante edilecektir.  
* Manuel varsayımlardan kaçınmak ve eşleştirme sürecini objektif hale getirmek için literatürdeki bilimsel mizaç ölçekleri (MBTI, Enneagram, Beş Faktör, DISC vb.) araştırılıp standartlaştırılacaktır.  
* Sistemde tutulacak olan Ad, Sektör, Deneyim Yılı ve Karakter Testi Sonuçları gibi metrikleri içeren detaylı bir Veri Sözlüğü oluşturulacaktır.  
* Kişisel verilerin işlenmesi ve algoritma tarafından profilleme yapılması için KVKK aydınlatma metinleri ve gerekli hukuki altyapı hazırlanacaktır.

---

### **Faz 2: Kullanıcı Deneyimi (UX) ve Mimari Tasarım**

* Bir mezunun veya öğrencinin sisteme ilk girişinden, profilini oluşturup eşleşme havuzuna dahil olmasına kadar geçen tüm adımların akış şemaları (User Journey) çizilecektir.  
* Kullanıcıların mizaçlarını belirleyecek karakter analiz anketi; uzun ve yorucu formlar yerine parça parça veya senaryo bazlı sorularla, kullanıcı dostu bir arayüzde tasarlanacaktır.  
* Eski mezunların çalıştıkları kurumları, sektörleri ve uzmanlık alanlarını kolayca etiketleyebilecekleri (tagging) profil ekranları prototiplenecektir.

---

### **Faz 3: Teknik Geliştirme ve Yapay Zeka Entegrasyonu**

* Kullanıcı profillerinin, test sonuçlarının ve sistem loglarının güvenle tutulacağı modern bir veritabanı mimarisi inşa edilecektir.  
* Analiz, eşleştirme ve mentorluk sürecini yönlendirmek üzere tasarlanan özel promptlar (komutlar), OpenAI veya Gemini gibi bir API üzerinden sisteme entegre edilecektir.  
* Yapay zeka API'sinden dönen JSON formatındaki çıktılar , veritabanı sorgularıyla birleştirilerek nihai Eşleştirme Motoru (Matchmaking Engine) kodlanacaktır.  
* Geliştirilen bu algoritma; zıt karakterlerin (örneğin aşırı dominant bir mentor ile içe dönük bir mentinin) birbiriyle eşleşmesini engelleyecek şekilde programlanacaktır.

---

### **Faz 4: Pilot Test (PoC) ve Optimizasyon**

* Sistem tüm kullanıcılara açılmadan önce, kurum içinden seçilecek 20 mentor ve 20 menti ile kapalı beta testi (Kapalı Beta Testi) yapılarak platform manuel kontroller eşliğinde canlıya alınacaktır.  
* Algoritmanın uyuşmazlık yaratabilecek zıt karakterleri gerçekten filtreleyip filtrelemediği, test sonuç logları üzerinden incelenerek sistem için Uyuşmazlık Testi (Stress Test) yapılacaktır.  
* Pilot eşleşmelerden çıkan sonuçlara göre, arka planda çalışan yapay zeka komutlarının (LLM) ince ayarları (fine-tuning) yapılarak hata payı en aza indirilecektir.

---

### **Faz 5: Yaygınlaştırma ve Sürekli İyileştirme**

* Sistem stabil hale geldikten sonra tüm STK, dernek ve kulüp mezunlarına duyurusu yapılarak geniş çaplı kullanıma açılacaktır.  
* Eşleşen mentor ve mentilerden, programın 1\. ayı ve 3\. ayı sonunda geri bildirimler toplanacaktır.  
* Alınan bu "eşleşme başarısı" geri bildirimleri, sistemi zamanla daha da akıllı hale getirmek için algoritmaya geri beslenecek (Machine Learning loop) ve eşleşme kalitesi sürekli artırılacaktır.

# Proje Gereksinim Dokümanı (BRD) \- Faz 1

## **Menti-Mentor Eşleştirme Sistemi: Proje Gereksinim Dokümanı (BRD) \- Faz 1**

**Proje Bağlamı Özeti:** Bu doküman, derneklerin, STK'ların, vakıfların ve üniversite kulüplerinin mezunları ile gönüllülerini bir araya getirecek veri odaklı sistemin temel anayasasını oluşturmaktadır. Manuel varsayımlardan kaçınılarak; kişilerin uzmanlık alanlarına, sektörlerine ve mizaçlarına göre en uygun eşleşmeyi sağlayan, uyuşmazlık yaratabilecek zıt karakterlerin eşleşmesini engelleyen objektif bir algoritma tasarlanması hedeflenmektedir.

---

### **1\. İş Gereksinimleri ve Temel İş Kuralları (Business Rules)**

Sistemin uçtan uca doğru ve güvenli çalışabilmesi için belirlenen temel iş kuralları aşağıda listelenmiştir:

* **Kayıt ve Rol Seçimi:** Kullanıcılar sisteme "Mentor" (Mezun/Deneyimli) veya "Menti" (Öğrenci/Gönüllü) rollerinden birini seçerek kayıt olmalıdır.  
* **Profil Doğrulama ve Onay Mekanizması:** Kalite standartlarını korumak adına, özellikle Mentor başvuruları sistem yöneticileri veya ilgili kurumun (STK/Vakıf vb.) yetkilisi tarafından onaylandıktan sonra aktif hale gelmelidir.  
* **Zorunlu Profilleme:** Eşleştirme havuzuna dahil olabilmek için her kullanıcının "Karakter ve Mizaç Testi"ni eksiksiz tamamlaması zorunludur.  
* **Etiketleme (Tagging) Sistemi:** Kullanıcıların sektörleri, çalıştıkları kurumlar ve uzmanlık alanları serbest metin yerine standartlaştırılmış etiketler (tag'ler) havuzundan seçilmelidir.  
* **Algoritma Ağırlıklandırması:** Eşleştirme motoru, sektörel hedeflerin ve uzmanlıkların uyuşmasına öncelik verirken, mizaç uyumunu da destekleyici ve filtreleyici bir kriter olarak kullanmalıdır.  
* **Çatışma Önleme (Anti-Match) Kuralı:** Algoritma, mizaç testi sonuçlarına göre "zıt karakter" (örn. aşırı dominant ve kırılgan) olarak sınıflandırılan profillerin eşleşmesini kesin kurallarla engellemelidir.  
* **Eşleşme Döngüsü:** Sistem, Mentiye uygun mentor adaylarını listelemeli ve nihai eşleşme için her iki tarafın onayı (çift taraflı kabul) alınmalıdır.
* **Hibrit Akış (Karar: 2026-05-25):** Platform iki paralel eşleştirme akışını destekler. Her iki akış da `VisibilityOptIn` tablosunu ortak kapı olarak kullanır ve APPROVED durumu elde edilmeden `MatchRequest` oluşturulamaz.

---

### **1a. Hibrit Eşleşme Akışı — Resmi İş Kuralları**

#### Akış A: Mentor-Driven (Mevcut)
Mentor, algoritmik sıralamayı görür ve tercih ettiği mentiyi sisteme onaylar.

```
Mentor → GET /mentors/:id/candidates         (sıralı menti listesi)
       → POST /mentors/:id/visibility-optin  (status: APPROVED, initiatedBy: MENTOR)
       → VisibilityOptIn [APPROVED] oluşur
       → Ice-breaker otomatik üretilir
       → Menti artık MatchRequest gönderebilir
```

**Kurallar:**
- Mentor, APPROVED veya REJECTED kararını tek adımda verir (PENDING aşaması yoktur).
- Mentor, kendi kendini opt-in edemez (self-match koruması).
- Ice-breaker yalnızca APPROVED durumunda üretilir.

#### Akış B: Menti-Driven (Yeni)
Menti, belirli bir mentorun profilini keşfedip görünürlük talebi gönderir; mentor onaylar.

```
Menti  → POST /mentis/:id/request-visibility          (status: PENDING, initiatedBy: MENTI)
        → VisibilityOptIn [PENDING] oluşur
Mentor → GET  /mentors/:id/pending-visibility-requests (talep kuyruğu)
       → PATCH /mentors/:id/visibility-optin/:optInId/respond  { decision: "APPROVED" | "REJECTED" }
       → APPROVED → ice-breaker üretilir
       → Menti artık MatchRequest gönderebilir
```

**Kurallar:**
- Menti kendi `mentiId`'si ile istek atabilir (admin de yapabilir).
- Aynı mentor-menti çifti için PENDING durumda birden fazla talep oluşturulamaz.
- Zaten APPROVED olan bir çift için yeni talep reddedilir (HTTP 409).
- REJECTED durumdan yeniden talepte bulunulabilir (upsert ile PENDING'e döner).
- Menti, isteğe bağlı `requestMessage` (max 500 karakter) ekleyebilir.

#### Ortak Kural — VisibilityOptIn Kapısı
Her iki akış için de geçerlidir:
- `MatchRequest` oluşturulabilmesi için `VisibilityOptIn.status = APPROVED` zorunludur.
- Cross-tenant eşleştirme yalnızca her iki tenant'ın `isSharedPoolActive = true` olması durumunda izin verilir.
- `VisibilityOptIn.initiatedBy` alanı denetim (audit) kaydı olarak tutulur; iş akışını değiştirmez.

---

### **2\. Karakter ve Mizaç Ölçeği Analizi**

Sistemin objektifliğini sağlamak adına literatürdeki temel psikometrik ölçeklerin proje özelinde (kısa sürede etkili profil çıkarma ve zıtlık tespiti) kıyaslaması aşağıdadır:

* **MBTI (Myers-Briggs Tip Göstergesi):** 16 farklı kişilik tipi sunar. Bilişsel fonksiyonları anlamada çok etkilidir ancak testin uzunluğu kullanıcı deneyimini (UX) yorabilir ve zıtlık tespiti algoritması kurmak karmaşıktır.  
* **Enneagram:** 9 temel mizaç tipi üzerinden kişilerin temel motivasyonlarını ve stres/rahatlama yönlerini analiz eder. Zıt karakterleri (çatışma potansiyelini) tespit etmede en başarılı yöntemlerden biridir.  
* **Beş Faktör (Big Five):** Akademik geçerliliği en yüksek modeldir. Ancak profilleri "tipler" yerine "yüzdelik spektrumlar" olarak verdiği için eşleştirme algoritmasını (backend) ciddi şekilde zorlaştırır.  
* **DISC:** Dominant, İz Bırakan, Sadık ve Ciddi olmak üzere 4 ana eksende davranış tarzını ölçer. İş hayatındaki iletişim tarzını belirlemede çok hızlı, pratik ve kullanıcı dostudur.

**Standartlaştırma Önerisi ve Gerekçesi:**

Sistem altyapısı için **DISC** ve basitleştirilmiş **Enneagram** hibrit modelinin standartlaştırılması önerilmektedir.

* *Gerekçe:* Projenin amacı kullanıcıları uzun klinik testlerle yormadan pratik bir şekilde eşleştirmektir. DISC, mentor-menti görüşmelerindeki temel "iletişim tarzı uyumunu" çok hızlı ölçerken; Enneagram'ın stres yönü, algoritmanın "uyuşmazlık yaratabilecek zıt karakterleri" engelleme görevini kusursuz yerine getirmesi için en net veriyi sağlayacaktır.

---

### **3\. Veri Sözlüğü (Data Dictionary) Taslağı**

Sisteme kayıt olan kullanıcıların veritabanında (DB) tutulacak temel metrikleri aşağıdaki tabloda yapılandırılmıştır:

| Alan Adı (Field) | Veri Tipi | Zorunluluk Durumu | Açıklama |
| :---- | :---- | :---- | :---- |
| Kullanici\_ID | UUID | Zorunlu | Sistem tarafından atanan benzersiz kullanıcı kimliği. |
| Rol | Enum | Zorunlu | Kullanıcının sistemdeki rolü (Mentor, Menti, Admin). |
| Ad\_Soyad | String | Zorunlu | Kullanıcının tam adı. |
| Kurum\_Bilgisi | String | Zorunlu | Bağlı bulunduğu dernek, vakıf veya mezun olduğu üniversite/kulüp. |
| Sektor | String / Array | Zorunlu | Çalıştığı veya hedeflediği iş sektörü (örn. Teknoloji, Sağlık, Finans). |
| Uzmanlik\_Alanlari | Array | Zorunlu | Mentorun verebileceği veya Mentinin almak istediği uzmanlık etiketleri (Tagging). |
| Deneyim\_Yili | Integer | Zorunlu (Mentor İçin) | Mentorun sektördeki profesyonel tecrübe süresi. |
| Karakter\_Testi\_Sonuclari | JSON | Zorunlu | Sistem içindeki DISC/Enneagram anketinden dönen skorlar ve mizaç tipi çıktısı. |
| Eslenme\_Durumu | Boolean | Zorunlu | Kullanıcının aktif bir mentorluk sürecinde olup olmadığını belirtir. |
| Eslesilemeyecek\_IDler | Array | Opsiyonel | Algoritma tarafından tespit edilen zıt/uyumsuz profillerin engelleme listesi. |

---

### **4\. KVKK ve Veri Gizliliği Kapsamı**

Kişisel verilerin işlenmesi ve arka planda algoritma ile "profilleme" (profiling) yapılarak otomatik eşleştirme sunulması, 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında özel tedbirler gerektirir.

**Yasal Gereklilikler:**

* Veri minimizasyonu ilkesi gereği, sadece eşleşme algoritması için gerçekten gerekli olan veriler toplanmalıdır.  
* Profilleme ve otomatik karar verme süreçleri yürütüleceği için kullanıcının "Açık Rızası" kesinlikle alınmalıdır.  
* Toplanan kişilik analiz verilerinin üçüncü parti kurumlara (derneklere) hangi sınırlarda raporlanacağı şeffaf bir şekilde belirtilmelidir.

**Kullanıcı Giriş Ekranı Hukuki Doküman Başlıkları:**

1. **Aydınlatma Metni (Zorunlu Onay):**  
   * *Veri Sorumlusunun Kimliği:* Uygulamayı yöneten ana kurumun yasal künyesi.  
   * *Kişisel Verilerin Hangi Amaçla İşleneceği:* Kullanıcı deneyimini iyileştirmek, mizaç analizi yapmak ve en uygun mentorluk eşleşmesini sağlamak amacı vurgulanmalıdır.  
   * *İşlenen Verilerin Kimlere ve Hangi Amaçla Aktarılabileceği:* Eşleşme durumunda temel iletişim ve profil bilgilerinin mentor/menti ile paylaşılacağı belirtilmelidir.  
   * *Kişisel Veri Toplamanın Yöntemi ve Hukuki Sebebi:* Dijital formlar ve anketler aracılığıyla toplanan verilerin "Bir sözleşmenin kurulması veya ifasıyla doğrudan doğruya ilgili olması" şartına dayandığı ifade edilmelidir.  
   * *İlgili Kişinin Hakları (Madde 11):* Veri sildirme, düzeltme talep etme hakları eklenmelidir.  
2. **Açık Rıza Beyanı (Aktif Onay Kutusu \- Opt-in):**  
   * *Profilleme İzni:* "Kişilik testi sonuçlarımın algoritmik olarak analiz edilerek hakkımda profilleme yapılmasına ve eşleştirme sürecinde kullanılmasına özgür irademle onay veriyorum."  
   * *Veri Paylaşım İzni:* "Eşleşme sağlandığında; adımın, iletişim bilgilerimin ve uzmanlık alanlarımın eşleştiğim mentor/menti ile paylaşılmasını onaylıyorum."

# Algoritma ve Mizaç Mimarisi

### **1\. Genişletilmiş Psikometrik Ölçek ve Hibrit Model Önerisi**

Dernek ve STK ekosisteminde gönüllülük esasına dayanan bu sistemde, kullanıcı deneyimini (UX) koruyarak maksimum 3-5 dakikalık bir test süresi hedeflenmektedir. Bu kısıtlar altında metodoloji kıyaslaması aşağıdadır:

* **CliftonStrengths & HEXACO:** Modern İK uygulamalarında geçerliliği yüksek olmakla birlikte, test sürelerinin uzunluğu (yüzlerce soru) ve arka planda "yüzdelik spektrumlar" üretmeleri nedeniyle sistemin veri işlenebilirliği hedefine ters düşmektedir.  
* **DISC & Basitleştirilmiş Enneagram Hibriti (Önerilen Model):** Bu hibrit yapı, projenin pratikliği ve zıtlıkları yakalama gücü için en uygun mimaridir. DISC, iletişim tarzını (Dominant, İz Bırakan, Sadık, Ciddi) saniyeler içinde tespit edebilirken; Enneagram'ın temel motivasyon ve stres noktaları algoritmanın çatışma (Anti-Match) kuralını besler.  
* **Veritabanı Etiketleme (Tagging) Gerekçesi:** Sistem, kullanıcıları "D-Baskın / Tip 8" veya "S-Destekleyici / Tip 2" gibi net ID'ler ve etiketler ile veritabanına kaydetmelidir. Bu sayede eşleştirme motoru karmaşık matematiksel spektrum hesaplamaları yapmak yerine, doğrudan etiket eşleşmeleri (Boolean veya Integer değerler) üzerinden milisaniyeler içinde sonuç üretebilir.

### **2\. Mizaç Uyum ve Çatışma Matrisi (Match Matrix)**

Önerilen DISC tabanlı hibrit modele göre yazılım motoruna entegre edilecek kategoriler aşağıdadır:

* 🔴 **Red Flag (Katı Filtre / Kesinlikle Eşleşmemesi Gerekenler):** Aşırı Dominant (D) bir mentor ile içe dönük/kırılgan Sadık (S) bir menti kesinlikle eşleşmemelidir. Psikolojik gerekçesi; Dominant karakterin doğrudan, hızlı ve sonuç odaklı iletişim tarzının, güven ve empati arayan Sadık karakter üzerinde baskı ve anında demotivasyon yaratmasıdır. Bu ikili "Anti-Match" kuralı ile veritabanında birbirine kapatılmalıdır.  
* 🟢 **Golden Match (Öncelikli Eşleşmeler):** Vizyoner ve fikir odaklı İz Bırakan (I) profiller ile onları organize edecek Ciddi/Analitik (C) profiller birbirinin eksik yönlerini tamamlar. Aynı şekilde, hedefe koşan Dominant (D) mentorlar ile bu hedefleri görev bilinciyle uygulayacak Ciddi (C) mentiler algoritmada %40'lık mizaç uyumu puanını tam almalıdır.  
* 🟡 **Neutral (Tolere Edilebilir Eşleşmeler):** İki İz Bırakan (I) veya İz Bırakan (I) ile Sadık (S) profillerin eşleşmesi mizaç sinerjisi açısından mükemmel olmasa da, %60'lık sektörel ve hedef uyumu yüksek olduğu takdirde iletişim kazası yaşanmadan sorunsuz ilerleyebilir.

### **3\. Beklenti, İletişim ve Zaman Taahhüdü Entegrasyonu**

Eşleşmede tarafların beklentilerinin (doğrudan iş bulmak vs. vizyon almak) örtüşmesi şarttır. İletişimin sürtünmesiz olması için bu parametreler algoritmaya şu şekilde eklenmelidir:

* **Zaman Taahhüdü Ön Filtresi:** Gönüllü projelerde en büyük hayal kırıklığı zaman uyuşmazlığından çıktığı için "Beklenen Görüşme Sıklığı" algoritmaya katı bir ön filtre (Pre-condition) olarak eklenmelidir. Mentor "Ayda 1 saat", Menti "Haftada 2 saat" işaretlediyse, sistem diğer tüm uyumlara bakmaksızın bu eşleşmeyi reddetmelidir.  
* **İletişim Kanalı ve Etkileşim Türü:** Kayıt aşamasında alınan "Görev bazlı çalışma" veya "Sohbet bazlı rehberlik" tercihleri, %60 ağırlığa sahip sektörel hedef puanlayıcısına çarpan (multiplier) olarak etki etmelidir. Uyuşan etkileşim türleri, eşleşme puanına \+10 puanlık ek bir bonus sağlamalıdır.

### **4\. Algoritma Karar Ağacı (Decision Tree) Sıralaması**

Bir menti talep oluşturduğunda sistemin arka planda işleteceği filtreleme hiyerarşisi sırasıyla şöyledir:

1. **Adım 1: Zaman ve Taahhüt Filtresi (Ön koşul):** Tarafların ayırabileceği mesai süreleri (Örn: Haftada 1 saat) eşleşiyor mu? Eşleşmiyorsa süreci doğrudan sonlandır.  
2. **Adım 2: Zıt Karakter Eleyici (Katı Filtre / Anti-Match):** Zamanı uyuşan adaylar arasında Red Flag matrisinde yer alan (Örn: D ve S profilleri) zıt kombinasyonları havuzdan çıkar.  
3. **Adım 3: Sektör ve Hedef Puanlayıcı (%60 Ağırlık):** Kalan adayları, mentinin birincil beklentisi (Örn: Staj bulmak) ve mentorun uzmanlık etiketleri üzerinden 60 puan üzerinden derecelendir.  
4. **Adım 4: Mizaç ve Sinerji Puanlayıcı (%40 Ağırlık):** Golden Match listesindekilere 40 tam puan, Neutral listesindekilere 20 puan vererek Toplam Uyum Skorunu (Total Match Score) hesapla ve en yüksek ilk 3 adayı mentiye sun.

### **5\. Backend İçin Örnek JSON Çıktı Modeli**

Algoritma mimarisinin karar ağacına uygun olarak, eşleştirme motoruna beslenecek örnek bir kullanıcı profilinin JSON yapısı:

JSON  
{  
  "Kullanici\_ID": "usr\_8f7b2c9a",  
  "Rol": "Mentor",  
  "Sektor": "Yazılım Teknolojileri",  
  "Zaman\_Taahhudu": "Haftada 2 Saat",  
  "Mizac\_Tipi": "Dominant (D)",  
  "Iletisim\_Tarzi": "Sonuç Odaklı ve Doğrudan",  
  "Beklenti\_Turu": "Görev Bazlı Yetkinlik Geliştirme",  
  "Uyumlu\_Oldugu\_Karakterler": \[  
    "Ciddi/Analitik (C)",  
    "İz Bırakan (I)"  
  \],  
  "Zit\_Karakterler": \[  
    "Sadık/Destekleyici (S)"  
  \],  
  "Uzmanlik\_Etiketleri": \[  
    "Backend Geliştirme",  
    "Kariyer Planlama"  
  \]  
}

# Karar aşamaları

## **Karar 1 — Puanlama Matematiği (Scoring Rubric)**

**Temel Yaklaşım:** Sektör/Uzmanlık %60, Mizaç %40 toplam ağırlığıyla çalışır. Her iki blok kendi içinde normalize edilir ve 0–100 arası nihai skor üretilir.

### **Formül**

Sektör\_Skoru   \= (Eşleşen\_Etiket\_Sayısı / Menti\_Toplam\_Etiket\_Sayısı) × 100  
Mizaç\_Skoru    \= Hibrit\_Test\_Uyum\_Puanı (0–100 arası, bkz. Karar 3\)

Nihai\_Skor     \= (Sektör\_Skoru × 0.60) \+ (Mizaç\_Skoru × 0.40)

### **Örnek Senaryo: Menti 3 etiket seçti, mentor 1'ine sahip**

| Parametre | Değer |
| ----- | ----- |
| Menti etiketleri | `[Fintech, SaaS, Pazarlama]` |
| Mentor etiketleri | `[SaaS]` |
| Eşleşen etiket | 1 |
| Sektör\_Skoru | `(1/3) × 100 = 33.3` |
| Sektör katkısı (×0.60) | `33.3 × 0.60 = 20.0 puan` |
| Mizaç\_Skoru (örnek) | `72` |
| Mizaç katkısı (×0.40) | `72 × 0.40 = 28.8 puan` |
| **Nihai Skor** | **48.8 / 100** |

### **Backend Kural Tablosu**

| Eşleşen / Toplam | Sektör\_Skoru | %60'lık dilimden katkı |
| ----- | ----- | ----- |
| 3/3 | 100 | 60.0 puan |
| 2/3 | 66.7 | 40.0 puan |
| 1/3 | 33.3 | 20.0 puan |
| 0/3 | 0 | 0.0 puan |
| 2/4 | 50.0 | 30.0 puan |
| 1/5 | 20.0 | 12.0 puan |

**Mimari not:** Menti seçtiği etiket sayısı değil, eşleşen etiket oranı baz alınır. Bu "menti ne kadar iyi karşılandı" sorusunu yanıtlar. Mentor'un toplam etiket sayısı paydaya girmez — fazla etiketli mentorlar avantajlı hale gelmez.

---

### **Karar 2 — Sıfır Eşleşme (Fallback) Stratejisi**

Fallback hiyerarşisi aşağıdaki akış şemasında özetlenmiştir:

```
[Menti Eşleşme Talebi]
        │
        ▼
┌─────────────────────────────┐
│ Katı Filtre: Zaman + Beklenti│  ──── Uyuşmuyor ──→ [Eşleşme Yok - Son Ekran]
│ + Zıt Karakter (Anti-Match) │
└─────────────────────────────┘
        │ Geçti
        ▼
┌─────────────────────────────┐
│ Sektör + Mizaç Puanlama     │  ──── Sonuç > 0 ──→ [İlk 3 Aday Listelenir]
│ (%60 + %40)                 │
└─────────────────────────────┘
        │ Sonuç = 0
        ▼
┌─────────────────────────────┐
│ Esnetme 1: Zaman Filtresini │  ──── Sonuç > 0 ──→ [Sessizce Listele]
│ Gevşet                      │
└─────────────────────────────┘
        │ Sonuç = 0
        ▼
┌─────────────────────────────┐
│ Esnetme 2: Zıt Karakter     │  ──── Sonuç > 0 ──→ [Risk Uyarısı Rozeti ile Listele]
│ Filtresini Kaldır           │
└─────────────────────────────┘
        │ Sonuç = 0
        ▼
┌─────────────────────────────┐
│ Son Çare: Sadece Sektör     │  ──── Sonuç > 0 ──→ ["Mizaç uyumu düşük" uyarısıyla]
│ Uyumu Olanları Getir        │
└─────────────────────────────┘
        │ Sonuç = 0
        ▼
["Şu an uygun mentor bulunamadı. Sizi bilgilendireceğiz." Ekranı]
```

#### **Fallback Kural Tablosu (Backend için)**

| Adım | Tetikleyici | Eylem | UX Mesajı |
| ----- | ----- | ----- | ----- |
| Katı Filtre | Her zaman | Zaman \+ Zıt Karakter filtresi aktif | — |
| Esnetme 1 | Sonuç \= 0 | Zaman filtresini gevşet | Sessiz — kullanıcı görmez |
| Esnetme 2 | Esnetme 1 sonuç \= 0 | Zıt karakter filtresini kaldır | Sessiz — kullanıcı görmez |
| Son Çare | Esnetme 2 sonuç \= 0 | Yalnızca sektör uyumu olanları getir | "Mizaç uyumu düşük, ilerlemeden önce beklentileri konuşun" rozeti |
| Havuz Boş | Son çare de sonuç \= 0 | Hiç mentor yok | "Şu an uygun mentor bulunamadı. Sizi bilgilendireceğiz." ekranı |

**Mimari not:** Esnetme adımları kullanıcıya gösterilmez, arka planda otomatik çalışır. Yalnızca "Son Çare" seviyesinde kullanıcıya bilgi verilir. Admin panelinde her esnetme tetiklendiğinde log tutulur — havuz büyütme kararları bu verilere göre alınır.

---

## **Karar 3 — UX Tasarımı ve Soru Seti**

**Seçilen Model: Forced-Choice Senaryo Seçimi**

Tinder kaydırması yerine bu model seçildi. Kaydırma, Likert'ten daha çekici görünse de "sezgisel karar" almayı tetiklemez — kullanıcı yine de görsel çekicilik veya rastlantısal hareketle seçim yapar. Forced-Choice modeli ise her soruda kullanıcıyı iki somut davranış arasında sıkıştırır, bu da DISC \+ Enneagram boyutlarını daha güvenilir ölçer.

**Uygulama Kuralları:**

* Her soru tam ekran, tek kart görünümünde  
* İki seçenek büyük dokunma alanı (min. 80px yükseklik), etiket yok  
* İlerleme göstergesi: "2/7" değil, ince progress bar (daha az baskı)  
* Süre: 7 soru × \~20 saniye \= yaklaşık 2.5 dakika

### **Algoritmaya Nasıl Beslenir?**

Her seçeneğe arka planda gizli DISC \+ Enneagram etiketleri atanır. Kullanıcı bu etiketleri görmez.

| Soru | Seçenek A etiketi | Seçenek B etiketi | Ölçülen boyut |
| ----- | ----- | ----- | ----- |
| 1 | C tipi / 5w4 | I tipi / 7w8 | Hazırlık vs. spontanlık |
| 2 | S tipi / 9w1 | D tipi / 8w7 | Uyum vs. özgünlük |
| 3 | D tipi / 3w2 | C tipi / 6w5 | Aksiyon vs. analiz |

Tüm 7 sorudan gelen etiketler frekans analizi ile birleştirilir → baskın DISC tipi ve Enneagram kanadı belirlenir → mentor profilindeki tiple karşılaştırılır → 0–100 arası `Mizaç_Skoru` üretilir.

---

## **Karar 4 — "Beklenti" Parametresinin Hiyerarşik Konumu**

### **Problem**

| Menti beklentisi | Mentor beklentisi | Uyuşmazlık riski |
| ----- | ----- | ----- |
| Staj bulmak | Kariyer vizyonu anlatmak | Çok yüksek — pratik vs. felsefi |
| Özgeçmiş düzeltme | İlham vermek | Yüksek |
| Teknik beceri geliştirme | Ağ genişletme | Orta |
| Kariyer yönlendirme | Kariyer yönlendirme | Uyumlu |

### **Artı / Eksi Analizi**

| Yaklaşım | Artılar | Eksiler |
| ----- | ----- | ----- |
| Beklenti \= Puanlama Kriteri | Esnek, daha fazla eşleşme üretir. Kısmi uyum puanlanabilir. | Düşük beklenti uyumuyla gerçekleşen eşleşmeler hayal kırıklığı yaratır. Menti zamanını boşa harcar. |
| Beklenti \= Katı Filtre | Gerçek uyumsuzluklar baştan elenir. Eşleşme kalitesi yükselir. Menti/mentor memnuniyeti artar. | Havuz küçülür. Niş beklentiler (örn: çok spesifik sektör \+ staj odağı) mentor bulamayabilir. |

### **Karar: Beklenti \= Katı Filtre — EVET**

**Gerekçe:** Gönüllülük esasına dayalı bir sistemde mentor ve menti zamanı en kıt kaynaktır. Beklenti uyumsuzluğu, düşük puan alan ama gerçekleşen eşleşmelerden çok daha yıkıcı bir kullanıcı deneyimi üretir. İki oturumdan sonra terk edilen eşleşme, hiç yapılmayan eşleşmeden kötüdür.

**Uygulama Kuralları:**

1. Beklenti kategorileri menti ve mentor tarafından kayıt sırasında seçilir (çoklu seçim, max 2 adet).  
2. Algoritma, menti'nin en az 1 beklentisinin mentor'ın listesinde yer alması şartını katı filtre olarak uygular.  
3. Sıfır kesişim varsa → mentor adayı, Esnetme hiyerarşisine bile girmez, doğrudan elenir.  
4. Fallback durumunda (Karar 2'deki Son Çare adımı) bile beklenti filtresi kaldırılmaz — bu, sistemin korunması gereken son savunma çizgisidir.

**Mimari Not:** Beklenti kategorileri yılda 1 kez yönetim tarafından güncellenir. Başlangıç için önerilen 6 kategori: `Kariyer yönlendirme`, `Teknik beceri`, `İş/staj bağlantısı`, `Girişimcilik`, `Kişisel gelişim`, `Sektör tanıma`.

---

## **Özet Karar Tablosu**

| \# | Konu | Alınan Karar |
| ----- | ----- | ----- |
| 1 | Puanlama | Oran bazlı kısmi eşleşme: `(Eşleşen/Toplam) × 100 × 0.60` \+ `Mizaç × 0.40` |
| 2 | Fallback | 3 adımlı otomatik esnetme; son çare risk uyarısıyla göster |
| 3 | UX | Forced-Choice senaryo modeli, 7 soru, \~2.5 dk, gizli DISC/Enneagram etiketleri |
| 4 | Beklenti | Katı filtre olarak tanımlandı; hiçbir esnetme adımında kaldırılmaz |

# UX/UI ve Servis Tasarımı Raporu

**Menti-Mentor Eşleştirme Sistemi: Kapsamlı UX/UI ve Servis Tasarımı Raporu**

Kullanıcıların bilişsel yükünü (cognitive load) minimumda tutarak, sıfır sürtünme ile sistemi benimsemelerini sağlayacak "Faz 2" tasarım mimarisi aşağıda yapılandırılmıştır.

### **1\. Uçtan Uca Kullanıcı Akışı (User Flow & Journey)**

Akış, kullanıcının rolüne göre ayrılıp test aşamasında yeniden birleşecek şekilde, gereksiz ekranlardan arındırılmış lineer bir düzende tasarlanmıştır.

* **\[Ekran 1: Karşılama ve Rol Seçimi (Landing Page)\]**  
  * **İçerik:** Sistemin değer önerisi (Örn: "Deneyimlerini paylaş, geleceğe yön ver veya kendi yolunu çiz.")  
  * **CTA Butonları:** "Mentor Olarak Katıl" (Birincil Buton) / "Menti Olarak Katıl" (İkincil Buton)  
* **\[Ekran 2: Doğrulama ve KVKK\]**  
  * **İçerik:** E-posta/LinkedIn ile hızlı giriş, Aydınlatma Metni ve Açık Rıza onayı.  
  * **CTA Butonu:** "Onaylıyorum ve Devam Et"  
* **\[Ekran 3A: Menti Beklenti Girişi\] (Akış Ayrılır)**  
  * **İçerik:** Okul, bölüm, hedef sektör ve mentorluktan ana beklentisi (Staj, vizyon, teknik gelişim).  
  * **CTA Butonu:** "Hedefimi Kaydet"  
* **\[Ekran 3B: Mentor Profil ve Deneyim Girişi\] (Akış Ayrılır)**  
  * **İçerik:** Mezun olunan kurum, çalışılan sektör, unvan ve deneyim yılı.  
  * **CTA Butonu:** "Deneyimlerimi Kaydet"  
* **\[Ekran 4: Oyunlaştırılmış Mizaç Testi\] (Akış Birleşir)**  
  * **İçerik:** DISC tabanlı iletişim tarzı anketi (Detayları 2\. Modülde).  
  * **CTA Butonu:** Her soru kartında "Seçim Yap" (Otomatik sonraki ekrana geçiş)  
* **\[Ekran 5: Zaman ve Taahhüt Filtresi\]**  
  * **İçerik:** Ayda kaç saat ayrılabilir? Kullanıcı aşağıdaki sabit seçeneklerden birini seçer (Slider değil, büyük dokunmatik butonlar tercih edilir — serbest slider'da anlamsız değerler seçilir):
    * `Ayda 1 saat` (minimum taahhüt)
    * `Ayda 2-3 saat` (standart)
    * `Haftada 1 saat` (yoğun)
    * `Haftada 2+ saat` (tam bağlılık)
  * **Eşleşme Kuralı:** Mentor "Ayda 1 saat" seçmişse, "Haftada 1 saat" veya "Haftada 2+ saat" seçen mentilerle hiçbir koşulda eşleşmez. Sadece aynı veya bitişik kategori eşleşmeleri geçerlidir: `Ayda 1 ↔ Ayda 1`, `Ayda 2-3 ↔ Ayda 2-3 veya Haftada 1`, `Haftada 1 ↔ Ayda 2-3 veya Haftada 2+`.  
  * **CTA Butonu:** "Profilimi Tamamla ve Havuza Katıl"  
* **\[Ekran 6: Bekleme Odası (Empty State Dashboard)\]**  
  * **İçerik:** Eşleşme durumu ve rehber içerikler (Detayları 4\. Modülde).

---

### **2\. Oyunlaştırılmış Mizaç Testi Deneyimi (Gamified Assessment UX)**

Hedef kitlemiz olan yoğun mezunlar ve dinamik öğrenciler için klasik 1-5 arası puanlanan Likert ölçekleri sıkıcıdır ve testi terk etme (drop-off) oranını artırır.

* **Arayüz Mantığı: İkili Senaryo Kartları (Binary Choice Cards)**  
  * Kullanıcıya uzun bir liste göstermek yerine ekranda tek bir kart belirir. Ekranda "Bir kriz anında hangisi seni daha iyi anlatır?" sorusu ve altında iki net seçenek bulunur.  
  * Örnek UI: Ekranda büyük ve tıklanabilir iki buton/kart. (Örn: A Kartı: "Hemen inisiyatif alıp çözüme odaklanırım", B Kartı: "Önce verileri toplar ve riskleri analiz ederim").  
  * *Mekanik:* Kullanıcı A veya B kartına dokunduğunda (veya mobil versiyonda Tinder gibi sağa/sola kaydırdığında) kart hoş bir animasyonla ekrandan uçar (Swipe-out) ve anında yeni soru gelir. Bu akıcılık (Progressive Disclosure) testi oyun gibi hissettirir.  
* **Motivasyon ve Geri Bildirim Ögeleri:**  
  * **Dinamik İlerleme Çubuğu (Progress Bar):** Ekranın en üstünde, her seçimde hızla dolan bir çubuk.  
  * **Mikro-Geri Bildirimler:** %50'ye gelindiğinde ekranda beliren "Harika gidiyorsun, profilin şekillenmeye başladı\! Son 4 Soru" gibi kısa "Toast Message" (belirip kaybolan bildirim) kullanımı.  
  * **Haptik Geri Bildirim:** Mobilde her kart seçiminde hafif bir titreşim verilmesi, tamamlanma hissini pekiştirir.

---

### **3\. Akıllı Etiketleme (Smart Tagging) ve Profil Ekranları**

Girdi verisini temiz tutmak (Clean Data) eşleştirme motorunun sağlığı için kritik olduğundan, hiçbir kritik alanda serbest metin (Text Input) kullanılmayacaktır.

* **Tasarım Tercihleri ve Gerekçeleri:**  
  * *Kurum ve Sektör Seçimi için "Oto-Tamamlama (Auto-complete)":* STK, dernek ve sektör listeleri çok uzundur. Kullanıcı ilk 3 harfi (Örn: "Yaz...") yazdığında, sistemin alttan standartlaştırılmış bir liste ("Yazılım, Yazarlık, Yazılımcı STK'sı") önermesi en iyi UX'tir. Bu, kullanıcının hızlı bulmasını sağlarken veritabanındaki mükerrer kayıtları engeller.  
  * *Uzmanlık Alanları için "Baloncuk Seçimi (Bubble Selection)":* Mentorun nelerde iyi olduğunu seçmesi için ekranda popüler uzmanlıkların önceden yazılı olduğu baloncuklar (Chips) bulunur. Tıklandığında rengi değişerek seçilmiş olur. Kullanıcının aklına gelmeyen bir yetkinliği bile seçmesine olanak tanır (Tanıma vs. Hatırlama prensibi).  
* **Etiket Sınırı (Tag Limit):**  
  * **Maksimum 5 Etiket:** Özellikle mentorların her alanda kendini uzman hissetmesi (Jack of all trades) eşleşme kalitesini düşürür. Maksimum 5 uzmanlık alanı seçimine izin verilerek, mentorun gerçekten en güçlü kaslarına odaklanması zorlanmalıdır. (UI Ögesi: "Kalan Seçim Hakkınız: 2" sayacı eklenmelidir).

---

### **4\. 'Empty State' (Bekleme) ve Dashboard Tasarımı**

Kullanıcı testi bitirip havuza düştüğünde, onu algoritma çalışırken yalnızlık hissine itmeyen, değer üreten bir "Empty State" tasarımı uygulanacaktır.

* **Statü ve Şeffaflık Modülü:**  
  * En üstte dönen şık bir radar/tarayıcı animasyonu.  
  * *Metin:* "Profilin analiz edildi\! Algoritma şu an kriterlerine en uygun \[Mentiyi/Mentoru\] bulmak için havuzu tarıyor."  
* **Anında Değer Üretimi (Karakter Özeti):**  
  * Mizaç testi sonucunu bekletmeden kullanıcıya sunan bir kart (Örn: "Mizaç Analizine Göre: Analitik ve Sonuç Odaklısın. Seninle aynı frekansta olan profiller araştırılıyor..."). Bu, kullanıcının sisteme harcadığı vaktin anında karşılığını aldığını hissettirir.  
* **Eğitici Yönergeler (Onboarding Content):**  
  * Alt kısımda, bekleme süresini faydalı geçirmesini sağlayacak yönlendirici kartlar (Cards):  
    * "İncele: İyi Bir Mentorluk Süreci Nasıl Başlar?"  
    * "Hazırlık Yap: İlk Tanışmada Sorabileceğin 5 Kritik Soru"  
  * Bu içerikler hem boşluk hissini doldurur hem de tarafları kalite olarak sürece hazırlar.

# Büyüme, Ölçümleme ve Sürekli İyileştirme

**Menti-Mentor Eşleştirme Sistemi: Büyüme, Ölçümleme ve Sürekli İyileştirme (Faz 5\) Raporu**

### **1\. Aşamalı Yaygınlaştırma (Phased Rollout) ve "Soğuk Başlangıç" Stratejisi**

Sistemin "Tavuk-Yumurta" problemini (menti varken mentor olmaması veya tam tersi) çözmek için arz (mentor) ve talep (menti) dengesini kademeli olarak kuran 3 aşamalı operasyon planı aşağıdadır:

* **Aşama 1: Kapalı Beta (Hafta 1-2):** Sistem, dernek yönetim kurulları ve çekirdek gönüllü ekibinden oluşan maksimum 40 kişilik (20 Mentor, 20 Menti) kapalı bir gruba açılır. Amaç algoritmanın teknik stabilitesini test etmektir.  
* **Aşama 2: Önce Mentorlar (Supply-Side Onboarding \- Hafta 3-4):** Sadece dernek/vakıf mezunlarına ve sektör profesyonellerine özel davetiyeler gönderilir.  
  * *Değer Önermesi (Value Proposition):* "Tecrübeni geleceğin liderlerine aktar, kendi liderlik kaslarını geliştir ve seçkin mezun ağına katıl."  
  * *İletişim Kanalı:* LinkedIn doğrudan mesajları, kapalı WhatsApp/Telegram mezun grupları ve kişiselleştirilmiş e-postalar.  
* **Aşama 3: Büyük Lansman (Demand-Side \- Hafta 5+):** Mentor havuzu belirli bir doluluğa ulaştığında (Örn: 100+ profil), sistem öğrencilere ve genç gönüllülere açılır.  
  * *Değer Önermesi:* "Kariyer yolculuğunda sana özel seçilmiş rehberinle tanış, sıçrama yap."  
  * *İletişim Kanalı:* Üniversite kulüp duyuruları, dernek sosyal medya hesapları ve kampüs etkinlikleri.

---

### **2\. 1\. ve 3\. Ay "Mikro Geri Bildirim" (Micro-Feedback) Kurgusu**

Kullanıcıları uzun formlarla yormamak için, e-posta içerisinden doğrudan tıklanabilir (In-mail anket) veya uygulamaya girildiğinde pop-up olarak beliren oyunlaştırılmış mikro testler kurgulanmıştır.

**1\. Ay: Erken Uyum Testi (Odak: Kimya ve İletişim)**

* **Soru 1 (Emoji/Yıldız Derecelendirme):** "Mentorunla/Mentinle ilk ay nasıl geçti? Frekansınız tuttu mu?" (1-5 Yıldız)  
* **Soru 2 (Baloncuk Seçimi \- Sadece 1-3 yıldız verenlere açılır):** "Hangi konuda zorlandınız?" (Seçenekler: *Zaman uyuşmazlığı, Beklentiler farklıydı, İletişim tarzı uymadı, Ulaşamadım*)

**3\. Ay: Nihai Başarı Testi (Odak: Hedef Gerçekleşme ve Sadakat)**

* **Soru 1 (NPS \- 0-10 Puan):** "Bu eşleştirme deneyimini bir arkadaşına önerme ihtimalin nedir?"  
* **Soru 2 (İkili Seçim):** "Programa başlarken belirlediğiniz ana hedefe (örn: staj, vizyon) ulaştınız mı?" (Seçenekler: *Evet, Kesinlikle / Kısmen / Hayır*)

---

### **3\. Algoritmik Geri Besleme (Machine Learning Loop) Mimarisi**

Toplanan mikro geri bildirimlerin veritabanında durağan kalmaması, sistemi "kendi kendini eğiten" (Reinforcement Learning mantığı) bir algoritmaya dönüştürmesi için backend mimarisine aşağıdaki ağırlık güncelleme (Weight Update) kuralları eklenmelidir.

* **Puanlama Veritabanı (Feedback Log):** Her eşleşme sonucunda algoritma; `Karakter_Kombinasyonu` (Örn: Dominant \+ Sadık) ve `Sektor_Kombinasyonu` (Örn: Yazılım \+ Yazılım) bazında bir `Basari_Skoru` tutar.  
* **Ceza (Penalty) ve Ödül (Reward) Mekanizması:**  
  * *Ödül:* 1\. ve 3\. ay sonunda kullanıcılardan 4 veya 5 yıldız gelirse, o eşleşmenin arka planındaki profil kombinasyonuna (Örn: İz Bırakan \+ Ciddi) sistem `+0.5 Ödül Puanı` ekler. Bu puan eşiği geçtikçe bu iki profilin eşleşme önceliği artar (Golden Match listesi dinamikleşir).  
  * *Ceza (Örnek Senaryodaki Durum):* Sektör uyumlu ama karakterleri zıt (Örn: D ve S) iki kişi eşleşmeyi iptal ettiyse veya 1-2 yıldız verdiyse, sistem bu kombinasyona `-1 Ceza Puanı` atar.  
* **Otomatik Çatışma Kuralı Yazımı:** Bir mizaç kombinasyonunun toplam `Ceza Puanı` kritik eşik olan **-10**'a ulaştığında, sistem bu ikiliyi manuel müdahaleye gerek kalmadan otomatik olarak `Zit_Karakterler` (Anti-Match) dizisine (array) ekler. Sonraki eşleşmelerde bu iki profil %100 sektör uyumu olsa bile birbirine gösterilmez.

**ML Loop Eşik Tablosu (Backend Referansı):**

| Olay | Puan Değişimi | Eşik Noktası | Tetiklenen Aksiyon |
| :---- | :---- | :---- | :---- |
| 4-5 Yıldız geri bildirim | `+0.5 Ödül Puanı` | `+5` birikince | Kombinasyon Golden Match listesine taşınır |
| 1-2 Yıldız geri bildirim | `-1 Ceza Puanı` | `-5` birikince | Admin'e sarı uyarı gönderilir |
| 1-2 Yıldız geri bildirim | `-1 Ceza Puanı` | `-10` birikince | Kombinasyon Anti-Match listesine otomatik eklenir |
| Eşleşme iptal butonu | `-2 Ceza Puanı` | — | Anında `-2` uygulanır, eşikler hızlanır |

---

### **4\. Erken Bozulma (Churn) ve "Zarif Yeniden Eşleştirme" (Graceful Rematch) Kuralı**

1. ay geri bildiriminden 1-2 yıldız geldiğinde veya taraflardan biri "Eşleşmeyi İptal Et" butonuna bastığında, gönüllü kullanıcıyı kaybetmemek (Churn) için devreye girecek otomatik operasyon akışı:  
* **Empati ve Normalleştirme Adımı:** Kullanıcıyı suçluluk hissinden kurtarmak esastır.  
  * *Sistem Mesajı:* "Bazen kimyalar uyuşmayabilir veya zamanlar denk düşmeyebilir, bu gönüllülük projelerinde çok normal. Önemli olan senin gelişim yolculuğun."  
* **Zarif Yeniden Eşleştirme (Graceful Rematch) UX Akışı:**  
  * Ekranda doğrudan "Seni daha uygun bir adayla eşleştirmemiz için bize bir şans daha ver" butonu belirir.  
  * Kullanıcı butona tıkladığında, 1\. ay anketinden alınan olumsuz geri bildirim (Örn: "İletişim tarzı uymadı") algoritmaya anında filtre olarak eklenir (Zıtlık listesi güncellenir).  
* **Önceliklendirme Kuyruğu:** Yeniden havuza giren kullanıcı, veritabanında `Rematch_Priority = True` etiketi alır. Algoritma bir sonraki taramasında sıradaki diğer kullanıcılardan önce bu profili eşleştirerek "telafi" operasyonunu tamamlar.  
* **Yeniden Eşleşme Sınırı:** Bir kullanıcı aynı dönem içinde (3 aylık mentorluk çevrimi) en fazla **2 kez** yeniden eşleşme hakkına sahiptir. İki başarısız eşleşmeden sonra sistem, kullanıcıyı Admin'in "Özel İlgi Gerektiren Profiller" listesine taşır ve manuel müdahale planlanır. Sınır aşıldığında kullanıcıya şu mesaj gösterilir: *"Sana en uygun deneyimi sunmak için ekibimiz seni yakından destekleyecek."*

# Oyunlaştırılmış Mizaç ve Karakter Testi

İşte yazılım ekibinin doğrudan kodlayabileceği, 7 soruluk **Oyunlaştırılmış Mizaç ve Karakter Testi**:

### **1\. Kriz Yönetimi (Aksiyon mu, Stabilite mi?)**

**Senaryo (UI):** Ekipçe aylardır hazırlandığınız önemli bir projenin sunumuna/lansmanına 2 saat kala kritik bir hata fark ettin. İlk tepkin ne olur?

* **Kart A:** İnisiyatif alıp hızlıca bir B planı kurgularım. Yolda düzeltiriz, hız önemlidir.  
* **Kart B:** Ekibi toplar, hatanın kaynağını analiz eder ve durumu soğukkanlılıkla stabilize etmeye çalışırım.  
* **Backend Etiketi:**  
  * Seçim A: `+1 Dominant (D)`, `Enneagram: Tip 8 (Meydan Okuyan)`  
  * Seçim B: `+1 Sadık (S) / +1 Ciddi (C)`, `Enneagram: Tip 6 (Sadık) / Tip 9 (Barışçı)`

### **2\. İletişim Tarzı (Vizyon mu, Detay mı?)**

**Senaryo (UI):** Mentora/Mentiye yeni ve büyük bir fikir anlatıyorsun. Olayı nasıl aktarmayı tercih edersin?

* **Kart A:** Büyük resmi çizerim, işin heyecanını ve vizyonunu tutkuyla aktarırım.  
* **Kart B:** Adım adım sürecin nasıl işleyeceğini, metrikleri ve mantıksal çerçeveyi detaylıca anlatırım.  
* **Backend Etiketi:**  
  * Seçim A: `+1 İz Bırakan (I)`, `Enneagram: Tip 7 (Maceracı) / Tip 3 (Başaran)`  
  * Seçim B: `+1 Ciddi (C)`, `Enneagram: Tip 5 (Araştırmacı) / Tip 1 (Mükemmeliyetçi)`

### **3\. Motivasyon Kaynağı (Sonuç mu, Süreç mi?)**

**Senaryo (UI):** Gönüllü bir takım çalışmasında senin için en tatmin edici an hangisidir?

* **Kart A:** Belirlenen hedefe ulaştığımız ve somut, net bir sonuç (impact) elde ettiğimiz an.  
* **Kart B:** Ekip içindeki bağların güçlendiği, herkesin birbirine destek olduğu o uyumlu çalışma süreci.  
* **Backend Etiketi:**  
  * Seçim A: `+1 Dominant (D) / +1 İz Bırakan (I)`, `Enneagram: Tip 3 (Başaran) / Tip 8 (Meydan Okuyan)`  
  * Seçim B: `+1 Sadık (S)`, `Enneagram: Tip 2 (Yardımsever) / Tip 9 (Barışçı)`

### **4\. Geri Bildirim ve Çatışma (Mantık mı, Empati mi?)**

**Senaryo (UI):** Birlikte çalıştığın kişiye olumsuz bir eleştiri/geri bildirim vermen gerekiyor. Yaklaşımın nasıl olur?

* **Kart A:** Doğrudan ve net olurum. Duyguları bir kenara bırakıp işin kalitesine ve gerçeklere odaklanırım.  
* **Kart B:** Karşı tarafın motivasyonunu kırmamaya özen gösteririm. Yapıcı, yumuşak ve destekleyici bir dil kullanırım.  
* **Backend Etiketi:**  
  * Seçim A: `+1 Dominant (D) / +1 Ciddi (C)`, `Enneagram: Tip 8 (Meydan Okuyan) / Tip 1 (Mükemmeliyetçi)`  
  * Seçim B: `+1 Sadık (S) / +1 İz Bırakan (I)`, `Enneagram: Tip 2 (Yardımsever) / Tip 9 (Barışçı)`

### **5\. Karar Alma Hızı (Çeviklik mi, Kusursuzluk mu?)**

**Senaryo (UI):** Daha önce hiç yapmadığın yeni bir göreve/projeye başlıyorsun. Tarzın hangisidir?

* **Kart A:** Kervan yolda dizilir. Hemen aksiyona geçer, deneme-yanılma ile hızla öğrenirim.  
* **Kart B:** Önce sağlam bir planlama ve araştırma yaparım. Kusursuz bir altyapı kurmadan ilk adımı atmam.  
* **Backend Etiketi:**  
  * Seçim A: `+1 İz Bırakan (I) / +1 Dominant (D)`, `Enneagram: Tip 7 (Maceracı) / Tip 8 (Meydan Okuyan)`  
  * Seçim B: `+1 Ciddi (C)`, `Enneagram: Tip 5 (Araştırmacı) / Tip 1 (Mükemmeliyetçi)`

### **6\. Başarı Tanımı (Görünürlük mü, Arka Plan mı?)**

**Senaryo (UI):** Harika bir iş başardın. Bunun nasıl kutlanmasını/takdir edilmesini istersin?

* **Kart A:** Topluluk önünde, sahnede görünür bir şekilde takdir edilmek enerjimi yükseltir.  
* **Kart B:** Göz önünde olmaktansa, yaptığım işin sistemde bıraktığı kalıcı etkiyi (kaliteyi) bilmek bana yeter.  
* **Backend Etiketi:**  
  * Seçim A: `+1 İz Bırakan (I)`, `Enneagram: Tip 3 (Başaran)`  
  * Seçim B: `+1 Ciddi (C) / +1 Sadık (S)`, `Enneagram: Tip 5 (Araştırmacı)`

### **7\. Mentorluk/Mentilik Beklentisi (Zorlayıcı mı, Güvenli Alan mı?)**

**Senaryo (UI):** Mentorluk sürecinden en büyük beklentin nedir?

* **Kart A:** Beni konfor alanımdan çıkaran, potansiyelimi zorlayan, hedefler veren bir itici güç (Challenge).  
* **Kart B:** Beni yargılamadan dinleyen, tecrübelerini paylaşan güvenli bir rehberlik (Safe Space).  
* **Backend Etiketi:**  
  * Seçim A: `+1 Dominant (D)`, `Enneagram: Tip 8 (Meydan Okuyan) / Tip 3 (Başaran)`  
  * Seçim B: `+1 Sadık (S)`, `Enneagram: Tip 2 (Yardımsever) / Tip 9 (Barışçı)`

**8\. Soru: Sınır Yönetimi ve Bağlılık**

**Senaryo (UI):** Kendi iş, okul veya kişisel hayatında çok yoğun ve stresli bir döneme girdin. Bu sırada mentorluk/mentilik programında da önceden planlanmış, zaman alıcı bir görev/görüşme var. Nasıl hareket edersin?

* **Kart A (Aşırı Sorumluluk / Kendinden Ödün Verme):** Uykumdan veya dinlenme zamanımdan feragat eder, verdiğim sözü ne pahasına olursa olsun eksiksiz yerine getirmeye çalışırım.  
* **Kart B (Sınır Koruma / Rasyonel Esneklik):** Karşı tarafa durumu şeffafça açıklar, sınırlarımı koruyarak o anki enerjime uygun yeni bir beklenti/tarih belirlerim.

**Backend Etiketi:**

* *Seçim A:* `+1 Sadık (S) / +1 Ciddi (C)`, `Enneagram: Tip 1 (Mükemmeliyetçi) / Tip 2 (Yardımsever)` → *Risk:* Yüksek tükenmişlik potansiyeli.  
* *Seçim B:* `+1 Dominant (D) / +1 İz Bırakan (I)`, `Enneagram: Tip 8 (Meydan Okuyan) / Tip 5 (Araştırmacı)` → *Risk:* Algılanan soğukluk veya bağlılık eksikliği.

---

### **9\. Soru: İşbirliği Tarzı (Yapılandırma mı, Keşif mi?)**

**Senaryo (UI):** Mentorunla/Mentinle yeni bir proje başlatıyorsunuz. Sürecin nasıl yürümesini tercih edersin?

* **Kart A:** Net bir yol haritası, görev dağılımı ve takvim belirleriz; herkes ne yapacağını bilir.  
* **Kart B:** Önce birlikte beyin fırtınası yapar, süreci organik biçimde şekillendiririz.

**Backend Etiketi:**

* *Seçim A:* `+1 Ciddi (C)`, `Enneagram: Tip 1 (Mükemmeliyetçi) / Tip 6 (Sadık)`  
* *Seçim B:* `+1 İz Bırakan (I)`, `Enneagram: Tip 7 (Maceracı) / Tip 4 (Bireyci)`

---

### **10\. Soru: Geri Bildirimi Alma Tarzı (Doğrudan mı, Diplomatik mi?)**

**Senaryo (UI):** Mentor veya çalışma arkadaşın yaptığın işle ilgili sert ve doğrudan bir eleştiri yaptı. İlk tepkin ne olur?

* **Kart A:** Eleştiriyi hemen analiz eder, duygularımı bir kenara bırakır ve yapıcı olanı uygularım.  
* **Kart B:** Önce biraz zaman isterim; eleştirinin nasıl iletildiği benim için içeriği kadar önemlidir.

**Backend Etiketi:**

* *Seçim A:* `+1 Dominant (D) / +1 Ciddi (C)`, `Enneagram: Tip 8 (Meydan Okuyan) / Tip 5 (Araştırmacı)`  
* *Seçim B:* `+1 Sadık (S) / +1 İz Bırakan (I)`, `Enneagram: Tip 2 (Yardımsever) / Tip 9 (Barışçı)`

---

### **Tie-Breaking (Eşitlik Durumu) Kuralı**

10 soruda iki DISC tipi eşit puan aldığında (Örn: D=3, C=3) algoritma aşağıdaki öncelik sırasına göre baskın tipi belirler:

1. **Bağlam Filtresi:** Mentorsa → Dominant (D) veya Ciddi (C) baskın kabul edilir. Mentiyse → Sadık (S) veya İz Bırakan (I) baskın kabul edilir.  
2. **Enneagram Kanadi Tie-Breaker:** Kullanıcının en yüksek puanlı Enneagram tipine bakılır. Tipler 1, 3, 5, 8 → Dominant/Ciddi yönüne; Tipler 2, 6, 7, 9 → İz Bırakan/Sadık yönüne çözülür.  
3. **Son Çare:** Yukarıdaki iki kural da eşitliği çözemezse, kullanıcı `Mikst_Profil` etiketi alır ve algoritma onu her iki DISC tipiyle uyumlu adaylarla eşleştirir (daha geniş havuz, daha düşük öncelik puanı).

# Benchmark Küresel Vaka Analizleri

### **1\. Küresel Vaka Analizleri (Onboarding Benchmark)**

Modern eşleştirme platformları, kullanıcıları sisteme alırken bilişsel yükü (cognitive load) minimumda tutacak bir "Aşamalı Profilleme" (Progressive Profiling) stratejisi izler:

* **GrowthMentor:** Sisteme ilk girişte doğrudan psikometrik test yapmaz. Kullanıcının uzmanlık alanı, çözmek istediği 3 ana problem ve aradığı iletişim dili (örn: "Doğrudan/Sert" veya "Empatik") gibi **maksimum 5-6 etiket** seçtirir. İlk eşleşmeler bu verilerle yapılır. Testin daha derin boyutları, platformu kullanmaya devam ettikçe "profil tamamlama" görevleri olarak gelir.  
* **Catchafire (STK/Gönüllü Platformu):** Gönüllüleri STK'larla eşleştirirken karakterden ziyade amaca odaklanır. Onboarding süreci **4-5 adımdan** oluşur: Yetkinlikler, desteklenmek istenen amaçlar (örn: eğitim, iklim) ve haftalık ayrılabilecek saat.  
* **Bumble Bizz:** Tamamen hıza ve vizyona odaklıdır. Kayıt aşamasında test yoktur; **3 temel filtre** (sektör, arayış, tecrübe) ve serbest metin bırakılır. Karakter analizi algoritmadan ziyade, kullanıcının "kaydırma" (swipe) davranışlarına (Machine Learning) bırakılır.

**Çıkarım:** Başarılı platformlar, ilk girişteki bariyeri **5 ila 8 mikro etkileşim (soru/seçim)** bandında tutmaktadır.

### **2\. "Drop-off" vs. Doğruluk Dengesi ve İdeal Soru Sayısı**

Psikometrik standartlarda, bir ölçüm aracının güvenilirliği (Reliability) soru sayısı arttıkça yükselir (Spearman-Brown formülü). Ancak kullanıcı deneyiminde (UX), 5\. dakikadan sonra anketi terk etme (Drop-off) oranı eksponansiyel olarak artar.

* **Zorunlu Seçim (Forced-Choice) Dinamiği:** Bu format, standart Likert (1-5) ölçeklerine göre beyni daha fazla yorar. Kullanıcı iki geçerli senaryo arasında bir "trade-off" yapmak zorundadır.  
* **İdeal Denge (Sweet Spot):** Gönüllülük esaslı, maaş veya zorunlu KPI içermeyen sistemlerde ilk katılım testinin **ideal soru sayısı 10 ile 12 arasındadır.**  
* **Neden 7 Soru Yetmez?** 7 soru (2^7 kombinasyon) başlangıç için fena olmasa da, DISC (4 boyut) ve Enneagram (9 mizaç) gibi karmaşık matrisleri arka planda hatasız (ties/eşitlik durumu yaratmadan) hesaplamak için istatistiksel varyans yeterli gelmeyebilir. Algoritmanın kararsız kalmaması için 10-12 soru, hem 3 dakikalık UX sınırını korur hem de modeli keskinleştirir.

# Oyunlaştırma Mekanikleri

### **1\. Oyunlaştırma (Gamification) Mekanikleri ve Gerçek Vaka Referansları**

Kullanıcıya "Lütfen anketi doldur" demek yerine, ona "kendisi hakkında bilmediği bir şeyi keşfetme" veya "sistemde ayrıcalık kazanma" motivasyonu vermeliyiz.

* **Bilgi Boşluğu Teorisi (Information Gap \- Spotify / 16Personalities Yaklaşımı):** Kullanıcılar kendileri hakkındaki analizleri okumaya bayılırlar. Uygulama içinde "Karakter Analizinin Derinlikleri" başlıklı bulanık (blur effect) bir bölüm gösterilir. Altında şu yazar: *"Liderlik tarzının gizli yönünü açmak için şu 2 senaryoyu çöz."* Kullanıcı o kilidi (unlock) açmak için soruları keyifle yanıtlar.  
* **Bağlamsal Mikro-Görevler (Contextual Micro-Tasks \- Headspace / Duolingo Yaklaşımı):** Kullanıcıya rastgele bir bildirim (push notification) atmak yerine, tam bir eylem yapacağı sırada 1 adet soru sorulur. Örneğin; mentor, aylık görüşme notunu girmek için "Yeni Not" butonuna bastığında ekranda tek bir kart belirir, yanıtlar ve not girme ekranına geçer.  
* **Profil Gücü ve Statü (Profile Completeness \- LinkedIn / Bumble Yaklaşımı):** İnsanlar yarım kalan çemberleri tamamlamak ister (Zeigarnik Etkisi). Ekranda dönen bir ilerleme çubuğu (Progress Bar) bulunur. *"Profilin %80 oranında tamamlandı. Süper Mentor rozeti alıp aramalarda üstte çıkmak için eksik 2 yetkinlik senaryonu tamamla."*

---

### **2\. Adım Adım UX Akışı (1., 2\. ve 3\. Ay Senaryoları)**

Eşleşme gerçekleştikten sonra algoritmayı eğitecek ve profilleri derinleştirecek aylık akış şeması şu şekildedir:

**1\. Ay: "Buzları Eritmek ve Uyumu Keşfetmek" (Odak: İletişim Dinamikleri)** Eşleşmenin ilk ayında taraflar birbirini yeni tanımaktadır. Merak duygusu çok yüksektir.

* **Tetikleyici (Trigger):** Kullanıcı 1\. ayın sonundaki ilk toplantı notunu sisteme kaydettiğinde.  
* **UX Akışı:**  
  * \[Ekran 1 \- Başarı Modalı\]: Ekranda konfetiler patlar. *"Harika, ilk ayı devirdiniz\! Eşleştiğin mentorunla/mentinle aranızdaki zıtlıkları ve gizli uyumları görmek ister misin?"*  
  * \[Ekran 2 \- Kilitli İçerik\]: Ekranda iki tarafın profillerini kıyaslayan şık bir radar grafik belirir ancak grafik bulanıktır. Üzerinde kilit ikonu vardır.  
  * \[Ekran 3 \- Senaryo Kartları\]: Kilidi açmak için ekranda "Hızlıca 2 Karar Ver" butonu çıkar. Burada kullanıcıya (girişte sorulmayan) "Stres Yönetimi" ve "Öğrenme Stili" ile ilgili 2 adet A/B senaryo kartı gösterilir.  
  * \[Ekran 4 \- Ödül\]: Sorular yanıtlandığında kilit açılır. Algoritma arka planda yeni verileri kaydederken, kullanıcıya anında *"İkiniz de sonuç odaklısınız, bu yüzden süreç planlamasında birbirinize alan tanıyın"* gibi yapay zeka üretimi minik bir tavsiye verir.

**2\. Ay: "Derinleşme ve Statü Kazanma" (Odak: Sınır Koruma ve Esneklik)** İkinci ay, gönüllülük projelerinde motivasyonun düşmeye başladığı ve tükenmişlik (burnout) riskinin ortaya çıktığı aydır.

* **Tetikleyici (Trigger):** Kullanıcı 2\. ayda sisteme giriş yaptığında (Dashboard).  
* **UX Akışı:**  
  * \[Ekran 1 \- Dashboard Bildirimi\]: Profil fotoğrafının etrafındaki halka %85 dolu görünür. Altında bir rozet silüeti vardır.  
  * \[Ekran 2 \- Mikro Animasyon\]: Tıkladığında, *"Sistemin en uyumlu %10'luk dilimine girmeye çok yakınsın\! Algoritmanın seni daha iyi anlaması için son bir adım kaldı."* mesajı çıkar.  
  * \[Ekran 3 \- Tek Soru\]: Ekranda sadece 1 adet "Sınır Çizme/Kapasite Yönetimi" sorusu belirir. (Örn: *Beklenmedik bir kriz çıktığında, kendi özel planını mı iptal edersin yoksa görev tanımına mı sadık kalırsın?*)  
  * \[Ekran 4 \- Ödül\]: "Seçkin Gönüllü" (veya "Onaylı Mentor") rozeti profile eklenir. Arka planda algoritma, bu kişinin kriz anlarındaki esneklik payını veritabanına işler.

**3\. Ay: "Mezuniyet ve Yeni Hedefler" (Odak: Gelecek Vizyonu)** Üçüncü ay, mevcut mentorluk döngüsünün sonu ve bir sonraki eşleşme (rematch) havuzu için verilerin güncellendiği evredir.

* **Tetikleyici (Trigger):** 3\. ay bitiminde, son geri bildirim (NPS) anketi öncesi.  
* **UX Akışı:**  
  * \[Ekran 1 \- Dönem Özeti\]: Kullanıcıya "Yolculuk Haritası" (Journey Map) sunulur. Kaç saat görüştükleri, hangi konuları etiketledikleri gösterilir.  
  * \[Ekran 2 \- Geleceğe Yatırım\]: *"Bu serüveni tamamladın. Peki bir sonraki adımda seni ne heyecanlandırır?"* başlığıyla, kişinin vizyonunu ölçecek 2 senaryo kartı sunulur. (Örn: *Bir sonraki projede sıfırdan bir şey inşa etmek mi istersin, yoksa işleyen bir sistemi mükemmelleştirmek mi?*)  
  * \[Ekran 3 \- Algoritma Güncellemesi\]: Bu yanıtlara göre sistem, 3 ay önceki başlangıç verilerini günceller ve kullanıcının profilini bir sonraki dönem eşleştirmeleri için çok daha niş bir segmente (Örn: "Yenilikçi Kurucular" havuzuna) yerleştirir.

# Adaptif Karar Ağacı Mantığı

### **Adaptif Karar Ağacı Mantığı (3 Kademeli Senaryo)**

**Kademe 1: Kök Düğüm (Root Node) \- Çekirdek Eğilimin Tespiti** Kullanıcının genel eğilimini (Dominant mı yoksa Destekleyici mi olduğunu) ölçeriz.

* **Senaryo:** Değer odaklı bir hackathon organize ediyorsunuz. Etkinliğin başlamasına 2 saat kala kritik bir altyapı sorunu çıktı. İlk tepkiniz ne olur?  
* **A Seçeneği:** İnisiyatif alıp hemen kararları ben veririm, krizleri hızlıca çözerim. *(-\> Puan: Dominant (D) Eğilimi. Sistem Kademe 2'deki "Dominantlık Kontrolü" sorusuna yönlendirir.)*  
* **B Seçeneği:** Ekibi toplar, durumu analiz eder ve ortak bir akılla sorunu çözerim. *(-\> Puan: Analitik/Sadık (C/S). Sistem Kademe 2'deki "Pasiflik/İnisiyatif Kontrolü" sorusuna yönlendirir.)*

**Kademe 2: Adaptif Ayrım (Branching Node) \- Toksik mi Vizyoner mi?** (Kullanıcı 1\. soruda A seçeneğini işaretleyip Dominant profiline girdiyse tetiklenir).

* **Senaryo:** Uluslararası bir gönüllülük görevinde (örneğin Endonezya'daki bir saha projesinde) liderliğini yaptığınız ekip büyük bir hata yaptı ve süreç aksadı. Duruma nasıl müdahale edersiniz?  
* **A Seçeneği (Vizyoner Dominant):** Hatayı üstlenir, hedefleri tekrar netleştirir ve ekibe otonomi vererek sorunu kendilerinin çözmesini sağlarım. *(-\> Puan: Sağlıklı Lider / Golden Match adayı. Sistem Kademe 3'e yönlendirir.)*  
* **B Seçeneği (Toksik/Mikroyönetici):** Kontrolü tamamen elime alır, görevleri en ince ayrıntısına kadar dikte eder ve hatanın tekrarlanmamasını bizzat denetlerim. *(-\> Puan: Red Flag / Anti-Match adayı. Eşleştirme algoritmasına eksi puan yazar.)*

**Kademe 3: Davranışsal Doğrulama (Leaf Node) \- Mentorluk Tarzı** (Kullanıcı Kademe 2'de Vizyoner çıktığında tetiklenir).

* **Senaryo:** Eşleştiğiniz mentiniz, sıfır atık temalı bir çevre festivali projesinde sürekli kararsız kalıyor ve sizden onay bekliyor.  
* **A Seçeneği:** Ona doğrudan ne yapması gerektiğini söyler ve süreci hızlandırırım.  
* **B Seçeneği:** Doğru soruları sorarak, kararı kendi başına almasına rehberlik ederim.

---

### **Backend İçin Adaptif JSON Mimarisi**

Yazılım ekibinin veritabanında kolayca kurabileceği düğüm (node) tabanlı yönlendirme yapısıdır. Her sorunun bir `node_id`si vardır ve verilen cevaba göre sistem `next_node` id'sini çağırarak dinamik ilerler.

JSON  
{  
  "test\_id": "cat\_mizac\_v1",  
  "nodes": \[  
    {  
      "node\_id": "q1\_root",  
      "question\_text": "Değer odaklı bir hackathon organize ediyorsunuz. Etkinliğin başlamasına 2 saat kala kritik bir altyapı sorunu çıktı. İlk tepkiniz ne olur?",  
      "options": \[  
        {  
          "option\_id": "opt\_A",  
          "text": "İnisiyatif alıp hemen kararları ben veririm, krizleri hızlıca çözerim.",  
          "trait\_scores": {"D": 2, "I": 0, "S": 0, "C": 0},  
          "next\_node": "q2\_dominant\_check"  
        },  
        {  
          "option\_id": "opt\_B",  
          "text": "Ekibi toplar, durumu analiz eder ve ortak bir akılla sorunu çözerim.",  
          "trait\_scores": {"D": 0, "I": 0, "S": 1, "C": 1},  
          "next\_node": "q2\_analytical\_check"  
        }  
      \]  
    },  
    {  
      "node\_id": "q2\_dominant\_check",  
      "question\_text": "Uluslararası bir gönüllülük saha projesinde ekibiniz büyük bir hata yaptı. Duruma nasıl müdahale edersiniz?",  
      "options": \[  
        {  
          "option\_id": "opt\_A",  
          "text": "Hatayı üstlenir, hedefleri tekrar netleştirir ve ekibe otonomi veririm.",  
          "trait\_scores": {"Healthy\_Leadership": 2, "Toxic\_Control": 0},  
          "tags\_to\_add": \["Vizyoner", "Otonomi Sağlayan"\],  
          "next\_node": "q3\_mentor\_style"  
        },  
        {  
          "option\_id": "opt\_B",  
          "text": "Kontrolü tamamen elime alır, görevleri en ince ayrıntısına kadar bizzat denetlerim.",  
          "trait\_scores": {"Healthy\_Leadership": 0, "Toxic\_Control": 2},  
          "tags\_to\_add": \["Mikroyönetici", "Baskın"\],  
          "flag": "RED\_FLAG",  
          "next\_node": "q3\_toxic\_mitigation"  
        }  
      \]  
    },  
    {  
      "node\_id": "q3\_toxic\_mitigation",  
      "question\_text": "Ekibinle aynı hedefi paylaştığınızda, senin için en önemli olan şey nedir?",  
      "note": "Bu soru toksik kontrol eğiliminin derinliğini ölçer. Empati puanı yüksekse red flag hafifletilebilir.",  
      "options": \[  
        {  
          "option\_id": "opt\_A",  
          "text": "Ekibin başarısı ve birlikte ulaştığımız sonuç.",  
          "trait\_scores": {"Empathy": 2, "Toxic\_Control": 0},  
          "tags\_to\_add": \["Sonuç Odaklı", "Takım Oyuncusu"\],  
          "flag": "YELLOW\_FLAG",  
          "next\_node": "END\_TEST"  
        },  
        {  
          "option\_id": "opt\_B",  
          "text": "İşin doğru ve kusursuz yapıldığından emin olmak.",  
          "trait\_scores": {"Empathy": 0, "Toxic\_Control": 2},  
          "tags\_to\_add": \["Mükemmeliyetçi", "Kontrol Odaklı"\],  
          "flag": "RED\_FLAG\_CONFIRMED",  
          "next\_node": "END\_TEST"  
        }  
      \]  
    },  
    {  
      "node\_id": "q3\_mentor\_style",  
      "question\_text": "Eşleştiğiniz mentiniz, sıfır atık temalı bir projede sürekli kararsız kalıyor ve onay bekliyor. Yaklaşımınız nedir?",  
      "options": \[  
        {  
          "option\_id": "opt\_A",  
          "text": "Ona doğrudan ne yapması gerektiğini söyler ve süreci hızlandırırım.",  
          "trait\_scores": {"Directive": 2, "Coaching": 0},  
          "next\_node": "END\_TEST"  
        },  
        {  
          "option\_id": "opt\_B",  
          "text": "Doğru soruları sorarak, kararı kendi başına almasına rehberlik ederim.",  
          "trait\_scores": {"Directive": 0, "Coaching": 2},  
          "next\_node": "END\_TEST"  
        }  
      \]  
    }  
  \]  
}

**Sistem Mimarisinin Avantajları:**

* **O(1) Karmaşıklığı:** Algoritma bir cevabı aldıktan sonra tüm listeyi taramaz, sadece `next_node` parametresindeki ID'yi (Pointer) çağırır.  
* **Erken Uyarı Sistemi (`flag: RED_FLAG`):** Toksik veya aşırı baskın eğilim tespit edildiğinde, sistem anında bir etiket atar. Böylece bu mentorun, kırılgan veya içe dönük profillerle (Anti-Match kuralı) eşleşmesi daha test bitmeden engellenmiş olur.

# Çift Taraflı Kabul (Double Opt-in) UX

### **1\. Menti Ekranı: "Sana Uygun Mentorlar Bulduk" Akışı**

Algoritma, mentiyi "Karar Yorgunluğuna" (Decision Fatigue) sokmamak için tek bir dayatma yapmak yerine **en yüksek puanlı 3 alternatifi** kaydırılabilir (swipeable) kartlar halinde sunar.

* **Gizli Bilgiler:** Mentorun soyadı, telefon numarası, e-posta adresi ve (eğer gizli tutmayı seçtiyse) çalıştığı spesifik kurum.  
* **Görünen Bilgiler:** İsim ve Soyadı Baş Harfi, Sektör/Unvan, Uyum Puanı, En Güçlü 2 Uzmanlık Etiketi ve yapay zeka tarafından üretilen "Neden Eşleştiniz?" mikro-metni.

**UI Akış Diyagramı ve Microcopy:**

* **\[Ekran: Eşleşme Havuzu (Dashboard)\]**  
  * *Başlık:* "Sinerjiye Hazır Ol\! Senin İçin En Uygun 3 Mentoru Bulduk."  
  * *Kart 1 Görünümü:*  
    * **Faruk K.** | Teknoloji & Veri Analitiği  
    * **Uyum Skoru:** %94 Golden Match 🟢  
    * **Uzmanlıklar:** Sistem Modelleme, Yapay Zeka Entegrasyonu  
    * **Neden Uyumlusunuz?:** *İkiniz de "Sonuç Odaklı" iletişim tarzına sahipsiniz ve "Değerleri Kodluyoruz" gibi yoğun tempolu hackathon süreçlerinde hızlı karar alma kaslarınız çok örtüşüyor.*  
* **\[Aksiyon: Butona Tıklama\]**  
  * Kullanıcı kartın altındaki **"Mentorluk İsteği Gönder"** butonuna tıklar.  
* **\[Pop-up: Onay ve Beklenti Yönetimi\]**  
  * *Başlık:* "Harika Bir Seçim\!"  
  * *Gövde Metni:* "Faruk K.'ya hedeflerinle birlikte bir istek iletiyoruz. Mentorların genellikle 48 saat içinde dönüş yaptığını hatırlatmak isteriz. Onay geldiğinde sana hemen haber vereceğiz."  
  * *Buton:* **"İsteğimi İlet"**

---

### **2\. Mentor Ekranı: "Yeni Bir Mentorluk İsteğin Var" Akışı**

Mentorun sistemi sık kontrol etmeyeceği varsayımıyla, çok kanallı (Omni-channel) bir bildirim kurgusu tasarlanmalıdır.

* **Bildirimler:**  
  * *E-Posta Konusu:* 🌟 Yeni Bir Mentorluk İsteğin Var: \[Mentinin Adı\] Seninle Eşleşmek İstiyor\!  
  * *Push Bildirimi (Mobil):* "Deneyimlerine ihtiyaç duyan biri var\! Yeni mentorluk isteğini incelemek için tıkla."  
* **Görünen Bilgiler:** Mentinin tam adı, okuduğu üniversite/bölüm, sistemi kullanım amacı (hedefi) ve eşleşme gerekçesi.

**UI Akış Diyagramı ve Microcopy:**

* **\[Ekran: Gelen İstekler Paneli\]**  
  * *Kart Görünümü:*  
    * **Zahid Sami Ata** | Endüstri Mühendisliği Öğrencisi  
    * **Ana Hedef:** "Endonezya Gönüllü Programı ve Erasmus+ (KA220-YOU) süreçleri için stratejik veri kullanımı ve proje yönetimi kaslarımı geliştirmek."  
    * **Mizaç Uyumu:** %88 (Birbirini Tamamlayanlar 🟢) \- *Onun analitik ve planlı yapısı, senin vizyoner liderlik tarzınla harika bir sinerji yaratıyor.*  
* **\[Aksiyon: Karar Butonları\]**  
  * Kartın altında yan yana iki buton:  
    * Birincil Buton (Dolgu Renkli): **"Eşleşmeyi Kabul Et"**  
    * İkincil Buton (Sadece Çizgili/Hayalet Buton): **"Kibarca Reddet"**

---

### **3\. "Kibar Ret" (Graceful Decline) ve Geri Dönüş Akışı**

Gönüllülük esasına dayalı bir sistemde, mentorların reddetme stresi yaşamasını ve mentilerin özgüven kırılması yaşamasını engellemek en önemli UX görevidir.

**UI Akış Diyagramı ve Microcopy:**

* **\[Aksiyon: Kibarca Reddet Butonuna Tıklama\]**  
* **\[Pop-up: Ret Sebebi Seçimi (Mentor İçin)\]**  
  * *Başlık:* "Anlıyoruz, Zaman ve Enerji Yönetimi Önemli."  
  * *Gövde Metni:* "Mentiyi en doğru adaya yönlendirebilmemiz için bize kısa bir ipucu verebilir misin? (Bu seçim mentiye doğrudan gösterilmeyecektir)."  
  * *Seçenekler (Radio Buttons):*  
    * Şu an kapasitem tam dolu, yeterli vakti ayıramam.  
    * Uzmanlığım, mentinin mevcut hedefleriyle tam örtüşmüyor.  
    * Önümüzdeki birkaç ay için programım çok belirsiz.  
  * *Buton:* **"İsteği Geri Çevir"**  
* **\[Ekran: Mentiye Giden Fallback (Kurtarma) Mesajı\]**  
  * *Sistem Bildirimi:* "Mentor Havuzunda Hareketlilik Var\! 🔄"  
  * *İçerik:* "Seçtiğin mentorun mevcut programı şu an yeni bir sürece başlamak için tam dolu görünüyor. Ama hiç moral bozmak yok; senin hedeflerine ulaşman için arka planda çalışmaya devam ettik ve sıradaki **2 harika adayı** senin için hazırladık\!"  
  * *Aksiyon:* **"Yeni Adayları İncele"** (Doğrudan havuz ekranına yönlendirir).

---

### **4\. El Sıkışma (Handshake) ve İletişim Başlangıcı**

Mentor "Kabul Et" dediği an, sistem aradaki duvarları kaldırır ve iki tarafı güvenli bir şekilde birbirine bağlar.

**UI Akış Diyagramı ve Microcopy:**

* **\[Aksiyon: Eşleşmeyi Kabul Et Butonuna Tıklama\]**  
* **\[Ekran: Her İki Tarafa Giden Ortak Başarı Ekranı\]**  
  * Ekranda konfetiler patlar veya iki elin sıkıştığı şık bir mikro-animasyon oynar.  
  * *Başlık:* "Eşleşme Başarılı\! Hikaye Şimdi Başlıyor. 🎉"  
* **\[Ekran: Tanışma Odası (Handshake Dashboard)\]**  
  * Bu ekranda tarafların gizli kalmış bilgileri (Soyadı, Telefon No/WhatsApp ikonu, E-posta) açılır.  
  * *Kurallar/Çerçeve Metni (Boundary Setting):* "İletişimi başlatmak için mentinin ilk adımı atması beklenir. Karşılıklı uygunluk çerçevesinde ilk görüşmenizi planlayabilirsiniz."  
* **\[Yapay Zeka Destekli "Buz Kırıcı" (Ice-Breaker) Yönergesi\]**  
  * Ekranın alt kısmında, iletişimi kolaylaştıracak hazır sorular bulunur.  
  * *Menti İçin Örnek Yönlendirme:* "Sohbete Nereden Başlayabilirsin? Mentoruna şu soruyu sorarak harika bir giriş yapabilirsin: *'Merhaba\! Profilinizi incelediğimde sıfır atık ve sürdürülebilirlik projelerindeki vizyonunuz ilgimi çekti. Planladığımız Sıfır Atık Festivali için ilk aklınıza gelen tavsiye ne olurdu?'*"  
  * *Aksiyon Butonu:* **"WhatsApp Üzerinden Merhaba De"** (Doğrudan wp.me linki ile sohbeti açar).

# Taksonomi ve Etiket Havuzu

### **1\. Üst Kategori Mimarisi (Ana Dallar)**

Kullanıcı arayüzünde (UI) kafa karışıklığını önlemek ve algoritmanın ağırlıklandırma (%60 Sektör/Hedef Uyumu) işlemini normalize etmek için etiketler 4 ana dala ayrılmalıdır:

1. **Sektörler ve Ekosistemler (Industry & Ecosystem):** Kişinin çalıştığı veya hedeflediği makro alanı belirler. Algoritmanın ilk büyük filtresidir.  
2. **Roller ve Sahadaki Konum (Roles & Field Position):** Kişinin bu sektör/ekosistem içinde "ne iş yaptığını" veya "hangi unvanla" sahada bulunduğunu tanımlar.  
3. **Proje, Hibe ve Organizasyon Uzmanlıkları (Project & Operations Domain):** Özellikle STK, sivil toplum ve etkinlik yönetimindeki spesifik, niş tecrübeleri gruplar.  
4. **Teknik ve Analitik Yetkinlikler (Hard Skills & Tech):** Sahada veya ofiste kullanılan doğrudan mühendislik, yazılım, veri ve analitik becerilerini içerir.

---

### **2\. Kapsamlı Alt Etiket (Tag) Listeleri (Veri Sözlüğü)**

Yazılım ekibinin doğrudan JSON formatında veya ilişkisel veritabanı (SQL) tablolarında kullanabileceği standartlaştırılmış etiket havuzu şöyledir:

### **Sektörler ve Çalışma Alanları (Kategori ID: 100\)**

Kullanıcının profesyonel olarak bulunduğu veya hedeflediği makro endüstrileri ifade eder.

| Etiket Kodu | Etiket Adı | Kapsam / Açıklama |
| :---- | :---- | :---- |
| 101 | Teknoloji ve Bilişim | Yazılım, donanım, yapay zeka ve IT hizmetleri. |
| 102 | Eğitim ve Akademi | Üniversiteler, okullar, eğitim teknolojileri ve akademik araştırmalar. |
| 103 | Mühendislik ve Üretim | Sanayi, otomotiv, inşaat, endüstriyel tasarım ve üretim süreçleri. |
| 104 | Sağlık ve Tıp | Hastaneler, medikal şirketler, psikoloji ve halk sağlığı. |
| 105 | Sivil Toplum ve Sosyal Hizmetler | Vakıflar, dernekler, uluslararası yardım kuruluşları ve sosyal girişimler. |
| 106 | Finans ve Ekonomi | Bankacılık, denetim, yatırım, muhasebe ve fintech. |
| 107 | Medya ve İletişim | Reklamcılık, gazetecilik, halkla ilişkiler (PR) ve yayıncılık. |
| 108 | Kamu ve Uluslararası İlişkiler | Devlet kurumları, diplomasi, yerel yönetimler ve kamu politikaları. |

### **2\. Kurumsal ve Sivil Toplum Rolleri (Kategori ID: 200\)**

Kullanıcının bağlı bulunduğu kurumda veya STK'da üstlendiği operasyonel ya da stratejik unvanları belirler.

| Etiket Kodu | Etiket Adı | Kapsam / Açıklama |
| :---- | :---- | :---- |
| 201 | Yönetim Kurulu / Kurucu | Organizasyonun stratejik tepe yönetimi ve kurucu üyeleri. |
| 202 | Proje Yöneticisi / Koordinatör | Belirli bir projenin uçtan uca yürütülmesinden sorumlu kişi. |
| 203 | Eğitmen / Kolaylaştırıcı | Topluluklara eğitim veren veya atölye çalışmalarını yöneten kişi. |
| 204 | Saha Gönüllüsü / Sorumlusu | Etkinliklerin ve operasyonların fiziksel olarak sahada uygulayıcısı. |
| 205 | Kurumsal İletişim Uzmanı | Kurumun dış paydaşlarla ve medya ile ilişkilerini yürüten kişi. |
| 206 | Kaynak / Fon Geliştirme Uzmanı | Sponsorluk, bağış bulma ve hibe yazımı süreçlerini yürüten kişi. |
| 207 | Topluluk Yöneticisi (Community Manager) | Gönüllü ağını veya üye topluluğunu canlı tutan ve yöneten kişi. |
| 208 | İnsan Kaynakları / Gönüllü Yönetimi | İşe alım, gönüllü oryantasyonu ve ekip performans yönetimi. |

### **3\. Teknik ve Mesleki Yetkinlikler (Hard Skills) (Kategori ID: 300\)**

Doğrudan ölçülebilir, öğrenilebilir ve belirli bir uzmanlık gerektiren profesyonel beceriler.

| Etiket Kodu | Etiket Adı | Kapsam / Açıklama |
| :---- | :---- | :---- |
| 301 | Proje ve Hibe Yazımı | Ulusal/Uluslararası fon başvuruları ve proje metni hazırlama. |
| 302 | Veri Analizi ve Raporlama | Büyük veriyi okuma, Excel/SQL kullanımı ve içgörü oluşturma. |
| 303 | Dijital Pazarlama ve Sosyal Medya | SEO, içerik üretimi, sosyal medya yönetimi ve reklam kampanyaları. |
| 304 | Finansal Yönetim ve Bütçeleme | Gelir-gider tabloları oluşturma, bütçe takibi ve maliyet analizi. |
| 305 | Yazılım ve Algoritma Geliştirme | Temel programlama, web/mobil ürün geliştirme ve sistem mimarisi. |
| 306 | Görsel Tasarım ve Video Kurgu | Grafik tasarım (Illustrator, Photoshop, Canva) ve video düzenleme. |
| 307 | Hukuk ve Mevzuat Uyumu | KVKK, dernekler kanunu, sözleşme hukuku ve yasal süreç takibi. |
| 308 | Yabancı Dil ve Çeviri | İleri düzey yabancı dil kullanımı, sözlü/yazılı tercüme. |

### **4\. Sosyal ve Yönetsel Yetkinlikler (Soft Skills) (Kategori ID: 400\)**

Kişinin çalışma tarzını, insan ilişkilerini ve problem çözme yaklaşımını yansıtan aktarılabilir beceriler.

| Etiket Kodu | Etiket Adı | Kapsam / Açıklama |
| :---- | :---- | :---- |
| 401 | Liderlik ve Ekip Yönetimi | Takım kurma, motive etme, delegasyon ve vizyon belirleme. |
| 402 | Kriz ve Risk Yönetimi | Beklenmedik sorunlar karşısında soğukkanlı kalma ve B planı üretme. |
| 403 | Zaman Yönetimi ve Planlama | İş önceliklendirme, takvim uyumu ve süreç optimizasyonu. |
| 404 | Topluluk Önünde Konuşma / Sunum | Kalabalıklara hitap etme, etkili sunum teknikleri ve ikna edicilik. |
| 405 | Çatışma Çözümü ve Müzakere | Anlaşmazlıkları giderme, orta yol bulma ve uzlaşma sağlama. |
| 406 | Girişimcilik ve İnovasyon | Yeni fikirler üretme, sıfırdan sistem kurma ve çeviklik. |
| 407 | Ağ Geliştirme (Networking) | İnsan ilişkileri kurma, profesyonel bağlantılar sağlama ve lobicilik. |
| 408 | Kariyer Planlama ve Rehberlik | Kişisel gelişim hedefleri koyma, staj/iş yönlendirmesi yapma. |

---

### **3\. "Kapasite Sınırı" ve Arayüz Kuralı (UX/DB Entegrasyonu)**

Kullanıcıların her yetkinliği seçerek "Jack of all trades" (Her işin uzmanı) yanılgısına düşmesini ve algoritmanın odağını kaybetmesini engellemek için veritabanı düzeyinde katı sınırlar uygulanmalıdır.

* **Sektör/Ekosistem:** Maksimum **2 seçim**. (Örn: Sivil Toplum \+ Çevre)  
* **Saha Rolleri:** Maksimum **2 seçim**. (Örn: Yönetim Kurulu Üyesi \+ Uluslararası Gönüllü)  
* **Proje/Organizasyon Uzmanlığı:** Maksimum **3 seçim**. (Sadece en güçlü olunan projeler).  
* **Teknik Yetkinlikler:** Maksimum **4 seçim**.

**UX Kuralı:** Arayüzde kullanıcı kalan seçim hakkını görecek (Örn: *Teknik Yetkinlikler: Kalan hakkınız 1*). Toplam profil maksimum **11 etiket** ile sınırlanacak. Bu sınır, algoritmanın hedef fonksiyonunda net ağırlıklar (Weighting) oluşturmasını garanti eder.

---

### **4\. Etiket Yönetimi ve "Diğer" Akışı (Governance Model)**

Taksonomi ne kadar geniş olursa olsun, niş yetkinlikler mutlaka çıkacaktır. Sistemin etiket çöplüğüne dönmemesi için kullanıcı tarafındaki serbest metin (Free Text) girişi, bir onay mekanizmasına (Admin Approval) bağlanmalıdır.

**"Diğer" Etiketinin İşleyiş Akışı (Tag Governance Flow):**

1. **Talep Oluşturma (Kullanıcı Akışı):**  
   * Kullanıcı açılır menüde (Dropdown) aradığı etiketi bulamaz.  
   * "Diğer'i Seç ve Ekle" butonuna basar. Kendi yetkinliğini yazar (Örn: "Simplex Algoritması").  
   * Sistem bunu kullanıcıya anında atanmış gibi gösterir (UX kesintiye uğramaz) ancak veritabanına status: unapproved, user\_id: \[ID\] şeklinde kaydeder.  
2. **Yönetici Taraması (Admin Panel):**  
   * Sistem yöneticisi paneldeki "Bekleyen Etiketler" (Pending Tags) ekranına girer.  
3. **Karar Mekanizması (Admin Aksiyonu):**  
   * *Seçenek A \- Kabul Et (Approve):* Etiket gerçekten değerli ve genel kitleye uygundur. Yönetici onaylar. Etiket havuzda herkese açılır ve o kategorinin listesine eklenir.  
   * *Seçenek B \- Birleştir (Merge/Map):* Kullanıcının girdiği "Simplex Algoritması" aslında havuzdaki "Yöneylem Araştırması"nın bir alt kümesidir. Yönetici "Merge" eder. Kullanıcının profili arka planda otomatik olarak "Yöneylem Araştırması" etiketiyle güncellenir.  
   * *Seçenek C \- Reddet (Reject):* Çok kişisel, argo veya geçersiz bir giriştir. Reddedilir, kullanıcının profilinden sessizce düşürülür.

# Yönetici (Admin) Paneli Tasarım

### **1\. Profil Doğrulama ve Onay (Onboarding Approval) Modülü**

Bu modül, topluluğun kalitesini koruyan ana filtredir. Sistem, yeni kayıtları "Bekleyen Onaylar" havuzuna alır.

* **Ekran Adı:** Aday Havuzu & Onay Yönetimi  
* **Görüntülenecek Veriler:**  
  * Kullanıcı Kartı: Ad Soyad, Rol (Mentor/Menti), Kayıt Tarihi.  
  * Doğrulama Detayları: Kurum Bilgisi, Mezuniyet Yılı, LinkedIn Profil Linki (İkon olarak), Mizaç Tipi (DISC Skoru).  
* **Aksiyon Butonları:**  
  * **\[Onayla\]:** Tek tıkla profili havuzuna dahil eder.  
  * **\[Düzeltme İste\]:** Tıklandığında pop-up açılır; "Eksik bilgi" veya "Profil fotoğrafı uygun değil" gibi hazır notlar seçilerek kullanıcıya geri gönderilir.  
  * **\[Reddet\]:** Kalıcı olarak hesabı pasifize eder.  
* **Otomatik Bildirim Akışı:**  
  * *Ret Durumu:* "Profilin incelendi, ancak topluluk kriterlerimizle şu an için tam örtüşmediğini gördük. Gösterdiğin ilgi için teşekkür ederiz."  
  * *Düzeltme Durumu:* "Profilini onaylayabilmemiz için küçük bir dokunuş gerekiyor: \[Admin Notu\]. Güncellediğinde tekrar inceleyeceğiz\!"

---

### **2\. Algoritma İzleme ve "Manuel Müdahale" (Override) Modülü**

Algoritmanın tıkandığı veya özel ilgi gerektiren durumlar için tasarlanmış "İstisna Yönetimi" ekranıdır.

* **Ekran Adı:** Eşleşme İzleme & Manuel Müdahale  
* **Görüntülenecek Veriler:**  
  * **"Alarm" Listesi:** 15+ gündür bekleyen Mentiler.  
  * **Neden Bekliyor?:** (Örn: "Sektör Uyumu Yok", "Zaman Taahhüdü Çakışıyor", "Zıt Mizaç Filtresine Takıldı").  
* **UX Mantığı (Force Match):**  
  * Admin, bekleyen bir mentinin yanındaki **\[Manuel Eşleştir\]** butonuna basar. Sistem, o mentiye en yakın mentorları "uyuşmazlık sebepleriyle" birlikte listeler. Admin, riski göze alarak mentorun üzerine sürükle-bırak yaparak eşleşmeyi zorlar.  
* **Bildirim Dili (Microcopy):**  
  * "Sana özel bir eşleşme\! Algoritmanın ötesinde, profilindeki \[Detay\] sebebiyle senin için harika bir rehber/öğrenci belirledik. Tanışmaya hazır mısın?"

---

### **3\. Taksonomi ve Etiket (Tag) Yönetim Modülü**

Kullanıcıların "Diğer" seçeneği ile girdiği verilerin standartlaştırıldığı "Veri Temizleme" merkezidir.

* **Ekran Adı:** Etiket (Tag) Kütüphanesi & Onayları  
* **Görüntülenecek Veriler:**  
  1. Taslak Etiket, Öneren Kullanıcı Sayısı, Önerilen Üst Kategori.  
* **Operasyonel Akış:**  
  1. **\[Reddet\]:** Etiket hatalı veya uygunsuzsa (Örn: "Her Şey" veya argo) sistemden silinir.  
  2. **\[Birleştir \- Merge\]:** Admin, "Yazılımcı" etiketini seçer ve sistemdeki mevcut "Yazılım Geliştirme" etiketiyle birleştirir. Gelecekteki aramalar tek etikette toplanır.  
  3. **\[Onayla \- Approve\]:** Niş ama değerli bir etiket ise (Örn: "Permakültür Tasarımı") onaylanır ve artık tüm kullanıcıların seçebileceği resmi bir seçenek haline gelir.  
* **Ekran Kuralları:** Aynı isimle (Case-insensitive) etiket açılması sistem tarafından engellenir; admin ekranına "Mükerrer Kayıt" uyarısı düşer.

---

### **4\. Sistem Sağlığı ve Eşleşme Başarısı (Dashboard Analytics)**

STK yöneticisinin sabah kahvesini içerken sistemin genel nabzını ölçtüğü görsel ekrandır.

* **Ekran Adı:** Yönetici Özeti (Analytics)  
* **4 Temel KPI Paneli:**  
  * **Aktif Yolculuklar:** Şu an aktif devam eden toplam mentorluk süreci.  
  * **Boştaki Kapasite:** Eşleşme bekleyen aktif Mentor sayısı (Arz kontrolü).  
  * **Eşleşme Süresi:** Bir mentinin kayıt olduktan sonra ortalama kaç günde eşleştiği.  
  * **Mutluluk Skoru (NPS):** 1\. ve 3\. ay geri bildirimlerinin genel ortalaması.  
* **Riskli Eşleşmeler Sekmesi (Erken Uyarı):**  
  * **Görünüm:** 1\. ay mikro-anketinde 2 yıldız ve altı alan eşleşmeler kırmızı renkle en üstte listelenir.  
  * **Aksiyon:** Admin, kartın üzerine tıklayarak taraflara özel mesaj atabilir veya eşleşmeyi "Zarif Ret" akışıyla sonlandırıp iki tarafı da yeniden havuza alabilir.

---

# Sprint Haritası

## **Menti-Mentor Eşleştirme Sistemi: Sprint Haritası**

**Genel Parametreler:** Her sprint 2 haftadır. Toplam 12 sprint + 1 hazırlık sprint'i = **25 hafta (~6 ay)**. Paralel yürüyen tasarım ve geliştirme iş akışları Sprint 4'ten itibaren ayrışır.

---

### **Sprint 0 — Kickoff ve Ortam Kurulumu (1 Hafta)**

**Amaç:** Projeye başlamadan önce tüm altyapıyı ve ekip düzenini oturtmak.

| Görev | Sorumlu | Çıktı |
| :---- | :---- | :---- |
| Proje yönetim aracı kurulumu (Notion/Jira) | PM | Görev panosu canlı |
| Teknik stack kararı (Framework, DB, Cloud) | Tech Lead | Stack kararı belgesi |
| Design tool belirleme (Figma) ve şablon kurulumu | UX/UI | Boş Figma projesi |
| Git repo ve branch stratejisi | Dev | Repo + branch kuralları |
| KVKK danışman görüşmesi planlaması | PM / Hukuk | Randevu takvimi |

---

### **Sprint 1 — BRD Finalizasyonu ve Veri Mimarisi (2 Hafta) — Faz 1**

**Amaç:** Geliştirme ekibinin başlayabileceği net bir sözleşme (contract) oluşturmak.

| Görev | Sorumlu | Çıktı |
| :---- | :---- | :---- |
| BRD'deki tüm iş kurallarının onaylanması | PM + Paydaş | İmzalanmış BRD |
| KVKK aydınlatma metni ve açık rıza beyanı taslağı | Hukuk | Hukuki metin taslağı |
| Veri Sözlüğü'nün SQL/NoSQL şemasına dönüştürülmesi | Backend Dev | ERD diyagramı |
| Etiket (tag) taksonomi listesinin finalizasyonu | PM + UX | 400 kodlu etiket listesi |
| Anti-match ve scoring kurallarının backend için spec yazımı | Tech Lead | Algorithm spec doc |

**Sprint Sonu Kriteri:** ERD onaylı, BRD imzalı, etiket listesi dondurulmuş.

---

### **Sprint 2 — UX Temel Akışlar ve Wireframe (2 Hafta) — Faz 2**

**Amaç:** Tüm kullanıcı akışlarını düşük çözünürlükte çizmek ve paydaş onayı almak.

| Görev | Sorumlu | Çıktı |
| :---- | :---- | :---- |
| 6 ekranlık kullanıcı akışı wireframe (Menti ve Mentor) | UX | Figma wireframe |
| 10 soruluk mizaç testi kart tasarımı (low-fi) | UX | Test akış şeması |
| Empty State dashboard wireframe | UX | Bekleme ekranı taslağı |
| Admin panel 4 modül wireframe | UX | Admin taslağı |
| Kullanıcı akışı paydaş sunumu | PM | Revizyon notları |

**Sprint Sonu Kriteri:** Paydaş onayı alınmış wireframe seti.

---

### **Sprint 3 — Hi-Fi Prototip ve Kullanılabilirlik Testi (2 Hafta) — Faz 2**

**Amaç:** Gerçek kullanıcılarla test edilebilir, tıklanabilir bir prototip üretmek.

| Görev | Sorumlu | Çıktı |
| :---- | :---- | :---- |
| Hi-fi tasarım (renkler, tipografi, komponent kütüphanesi) | UI | Design system |
| Tıklanabilir Figma prototipi | UI | Prototype linki |
| 5 kullanıcı ile kullanılabilirlik testi | UX | Test gözlemleri |
| Mizaç testi kart animasyonu (swipe-out) prototipi | UI | Animasyon taslağı |
| Revizyon uygulama ve tasarım dondurma | UI | Final design |

**Sprint Sonu Kriteri:** Tasarım dondurulmuş, developer handoff tamamlanmış.

---

### **Sprint 4 — Backend Temel: Auth ve Profil (2 Hafta) — Faz 3**

**Amaç:** Kullanıcıların sisteme kayıt olup profil oluşturabildiği çalışan bir backend.

| Görev | Sorumlu | Çıktı |
| :---- | :---- | :---- |
| Kullanıcı kayıt / giriş API'si (e-posta + OAuth) | Backend | `/auth` endpoint'leri |
| Rol tabanlı yetkilendirme (Mentor / Menti / Admin) | Backend | JWT + rol middleware |
| Profil CRUD API'leri | Backend | `/profile` endpoint'leri |
| Etiket seçimi ve kapasite sınırı (maks 11 etiket) API | Backend | `/tags` endpoint'leri |
| Frontend bağlantısı: kayıt ve profil ekranları | Frontend | Çalışan kayıt akışı |

**Sprint Sonu Kriteri:** Kullanıcı kayıt olabiliyor, profil oluşturabiliyor.

---

### **Sprint 5 — Mizaç Testi Motoru (2 Hafta) — Faz 3**

**Amaç:** Adaptif 10 soruluk testi kodlamak ve DISC + Enneagram skorunu DB'ye yazmak.

| Görev | Sorumlu | Çıktı |
| :---- | :---- | :---- |
| Adaptif karar ağacı JSON yapısının kodlanması | Backend | `test_engine` servisi |
| DISC + Enneagram frekans analizi ve skorlama algoritması | Backend | Skor hesaplama fonksiyonu |
| Tie-breaking (eşitlik) mantığının implementasyonu | Backend | Tie-breaker modülü |
| RED_FLAG / YELLOW_FLAG etiket yazım mantığı | Backend | Flag mekanizması |
| Frontend: 10 soruluk kart arayüzü ve animasyonu | Frontend | Çalışan test ekranı |

**Sprint Sonu Kriteri:** Test tamamlanıyor, DB'ye doğru DISC/Enneagram skoru yazılıyor.

---

### **Sprint 6 — Eşleştirme Algoritması (2 Hafta) — Faz 3**

**Amaç:** Puanlama, anti-match ve fallback mekanizmasının çalışır hale gelmesi.

| Görev | Sorumlu | Çıktı |
| :---- | :---- | :---- |
| Zaman taahhüdü katı filtresi | Backend | Filtre modülü |
| Beklenti kategorisi katı filtresi | Backend | Filtre modülü |
| Anti-match (Red Flag) filtreleyicisi | Backend | Anti-match servisi |
| Sektör skorlayıcı (%60 ağırlık, oran bazlı) | Backend | Scoring servisi |
| Mizaç skorlayıcı (%40 ağırlık, DISC/Enn tabanlı) | Backend | Scoring servisi |
| 3 adımlı Fallback hiyerarşisi | Backend | Fallback controller |
| İlk 3 aday listesi API'si | Backend | `/match` endpoint'i |

**Sprint Sonu Kriteri:** Senaryo bazlı testlerde algoritma doğru eşleşme üretiyor.

---

### **Sprint 7 — AI Entegrasyonu ve Bildirim Sistemi (2 Hafta) — Faz 3**

**Amaç:** "Neden Eşleştiniz?" metnini AI ile üretmek ve çok kanallı bildirim sistemini kurmak.

| Görev | Sorumlu | Çıktı |
| :---- | :---- | :---- |
| "Neden Eşleştiniz?" prompt tasarımı ve testi | Backend / AI | Prompt şablonu |
| OpenAI / Gemini API entegrasyonu | Backend | AI servis katmanı |
| JSON output parsing ve DB'ye yazma | Backend | Parser modülü |
| E-posta bildirim şablonları (eşleşme, ret, hatırlatma) | Backend | E-posta servisi |
| Push bildirim altyapısı (FCM/APNs) | Backend | Push servisi |
| Double opt-in akışı (menti istek → mentor kabul) | Backend + Frontend | Çalışan eşleşme akışı |

**Sprint Sonu Kriteri:** Uçtan uca eşleşme akışı çalışıyor, AI metni üretiliyor.

---

### **Sprint 8 — Admin Paneli (2 Hafta) — Faz 3**

**Amaç:** İçerik moderasyonu ve sistem izlemesi için admin panelinin tamamlanması.

| Görev | Sorumlu | Çıktı |
| :---- | :---- | :---- |
| Profil onay / ret / düzeltme modülü | Backend + Frontend | Admin onay ekranı |
| Manuel eşleştirme (Force Match) modülü | Backend + Frontend | Force match ekranı |
| Etiket kütüphanesi: Approve / Merge / Reject | Backend + Frontend | Tag yönetim ekranı |
| Analytics dashboard (4 KPI + riskli eşleşmeler) | Backend + Frontend | Analytics ekranı |
| Otomatik bildirim akışı (admin ret → kullanıcı mesajı) | Backend | Bildirim tetikleyici |

**Sprint Sonu Kriteri:** Admin sistemi izleyebiliyor ve müdahale edebiliyor.

---

### **Sprint 9 — Kapalı Beta (2 Hafta) — Faz 4**

**Amaç:** 20 mentor + 20 menti ile kontrollü pilot; teknik stabil, algoritmik hata tespiti.

| Görev | Sorumlu | Çıktı |
| :---- | :---- | :---- |
| 20 mentor + 20 menti davet ve onboardingi | PM | Kapalı beta grubu |
| Stress test: zıt karakter filtreleme senaryoları | QA | Test senaryoları + log |
| Fallback hiyerarşisi uçtan uca testi | QA | Fallback test raporu |
| Tüm kritik bug'ların tespiti ve önceliklendirilmesi | Dev | Bug listesi (P0/P1) |
| Günlük admin gözlem ve log analizi | PM + Tech Lead | Gözlem notları |

**Sprint Sonu Kriteri:** P0 bug'lar sıfır, algoritma tutarlı çalışıyor.

---

### **Sprint 10 — Fine-Tuning ve ML Loop Kurulumu (2 Hafta) — Faz 4**

**Amaç:** Beta geri bildirimlerine göre ince ayar yapmak ve ML döngüsünü canlıya almak.

| Görev | Sorumlu | Çıktı |
| :---- | :---- | :---- |
| Beta geri bildirim analizi (1. ay anketi) | PM + Tech Lead | Analiz raporu |
| LLM prompt ince ayarı (başarısız eşleşme örnekleri) | AI / Backend | Güncellenmiş prompt |
| ML loop: ödül/ceza puanlama mekanizması canlıya alma | Backend | Feedback log tablosu |
| Rematch akışı testi ve sınır kontrolü (maks 2 hak) | QA | Rematch test senaryosu |
| Performans optimizasyonu (sorgu süresi < 500ms) | Backend | Optimizasyon raporu |
| P1 bug'larının kapatılması | Dev | Temizlenmiş backlog |

**Sprint Sonu Kriteri:** Sistem beta'da stabil, ML loop veri yazıyor.

---

### **Sprint 11 — Supply-Side Büyüme: Mentor Havuzu (2 Hafta) — Faz 5**

**Amaç:** Genel lansman öncesinde mentor havuzunu kritik kütleye (100+ profil) ulaştırmak.

| Görev | Sorumlu | Çıktı |
| :---- | :---- | :---- |
| LinkedIn doğrudan mesaj kampanyası (mezunlar) | Ops / PM | 100+ mentor davetiyesi |
| WhatsApp/Telegram mezun grubu duyuruları | Ops | Grup duyurusu metinleri |
| Kişiselleştirilmiş e-posta kampanyası | Ops | E-posta şablonu |
| Gelen mentor başvurularının admin onayı | Admin | Onaylı mentor havuzu |
| Mentor havuzu: hedef kitle analizi (eksik sektör tespiti) | PM | Boşluk analizi |

**Sprint Sonu Kriteri:** 100+ onaylı mentor profili, kritik sektörler kapsanmış.

---

### **Sprint 12 — Genel Lansman ve Sürekli İyileştirme (2 Hafta) — Faz 5**

**Amaç:** Sistemi tüm kullanıcılara açmak ve uzun vadeli iyileştirme döngüsünü başlatmak.

| Görev | Sorumlu | Çıktı |
| :---- | :---- | :---- |
| Üniversite kulüp duyuruları ve menti kampanyası | Ops | Duyuru materyalleri |
| Dernek sosyal medya lansmanı | Ops | Sosyal medya içeriği |
| 3. ay geri bildirim akışı aktivasyonu (NPS + ikili seçim) | Backend | Otomatik anket tetikleyicisi |
| ML loop: ilk Golden Match dinamikleştirme kontrolü | Tech Lead | Algoritma güncelleme logu |
| İlk lansman haftası metriklerinin raporlanması | PM | Haftalık KPI raporu |

**Sprint Sonu Kriteri:** Sistem canlı, ilk 50 menti eşleşme sürecinde, ML loop aktif.

---

## **Sprint Haritası Özet Takvimi**

| Sprint | Hafta | Kapsam | Faz |
| :---- | :---- | :---- | :---- |
| Sprint 0 | Hafta 1 | Kickoff ve ortam kurulumu | Hazırlık |
| Sprint 1 | Hafta 2-3 | BRD, veri mimarisi, etiket taksonomisi | Faz 1 |
| Sprint 2 | Hafta 4-5 | UX wireframe, kullanıcı akışları | Faz 2 |
| Sprint 3 | Hafta 6-7 | Hi-fi prototip, kullanılabilirlik testi | Faz 2 |
| Sprint 4 | Hafta 8-9 | Backend auth, profil, etiket API'leri | Faz 3 |
| Sprint 5 | Hafta 10-11 | Mizaç testi motoru, DISC/Enn skoru | Faz 3 |
| Sprint 6 | Hafta 12-13 | Eşleştirme algoritması, fallback | Faz 3 |
| Sprint 7 | Hafta 14-15 | AI entegrasyonu, bildirim sistemi | Faz 3 |
| Sprint 8 | Hafta 16-17 | Admin paneli | Faz 3 |
| Sprint 9 | Hafta 18-19 | Kapalı beta (20+20) | Faz 4 |
| Sprint 10 | Hafta 20-21 | Fine-tuning, ML loop, optimizasyon | Faz 4 |
| Sprint 11 | Hafta 22-23 | Mentor havuzu büyütme (100+ hedef) | Faz 5 |
| Sprint 12 | Hafta 24-25 | Genel lansman, sürekli iyileştirme | Faz 5 |

<!-- Not: Dosyanın sonunda gömülü base64 görsel vardı. Dosya boyutunu aşırı büyüttüğü için kaldırıldı. -->