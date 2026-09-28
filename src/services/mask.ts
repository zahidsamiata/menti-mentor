/**
 * KVKK veri minimizasyonu — kişisel veri maskeleme yardımcıları.
 *
 * Platform panelinde kişisel veri (e-posta) varsayılan olarak maskeli gösterilir.
 * Maskeleme BACKEND'de yapılır; ham veri response'a hiç girmez (frontend'e sızmasın).
 */

/**
 * E-postayı `f***@domain.com` biçiminde maskeler.
 * Yerel kısmın yalnızca ilk karakteri gösterilir; domain aynen kalır (yönlendirme/iletişim için gerekli).
 * Saf fonksiyon — birim testi kolaydır.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '***';
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***'; // '@' yok ya da yerel kısım boş → tamamen maskele
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const first = local[0] ?? '*';
  return `${first}***@${domain}`;
}

/**
 * Ad/soyad gibi serbest kişi adını `f***` biçiminde maskeler (yalnız ilk harf görünür).
 * `maskEmail` ile aynı minimal desen — kimlik gizlenir, boş/whitespace tamamen maskelenir.
 * Saf fonksiyon — birim testi kolaydır.
 */
export function maskName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return '***';
  const first = trimmed[0] ?? '*';
  return `${first}***`;
}

/**
 * Serbest iletişim alanını maskeler. Alan e-posta ise `maskEmail`, değilse (telefon/handle)
 * yalnız ilk karakteri gösterir. Yeni maskeleme mantığı icat etmez; mevcut deseni yeniden kullanır.
 */
export function maskContact(contact: string | null | undefined): string {
  const trimmed = contact?.trim();
  if (!trimmed) return '***';
  if (trimmed.includes('@')) return maskEmail(trimmed);
  const first = trimmed[0] ?? '*';
  return `${first}***`;
}

/**
 * k-anonimlik eşiği — bir grubun BÜYÜKLÜĞÜNÜ açıklamak için gereken en az üye sayısı.
 * 3 seçildi: 1 ya da 2 kişilik bir grupta "kaç kişi var" bilgisi, kurumu tanıyan biri için
 * doğrudan kimlik çıkarımına dönüşür (n=1'de kesin, n=2'de ikiye indirger).
 */
export const K_ANONYMITY_THRESHOLD = 3;

/** `applyKAnonymity` dönüşü — `count` her zaman güvenli, `suppressed` gizlenip gizlenmediğini söyler. */
export interface KAnonymousCount {
  count: number;
  suppressed: boolean;
}

/**
 * Bir grup sayımını k-anonimlik eşiğine göre güvenli hale getirir.
 * Eşiğin ALTINDAKİ gerçek sayı response'a HİÇ girmez — 0'a indirgenir (sızıntı değil, eksik bildirim).
 *
 * Neden 0: tüketiciler sayıyı "en az N kişi var mı" eşik kontrolüyle okuyor; 0 döndürmek
 * her eşik kontrolünden güvenli tarafa düşer. `suppressed` bayrağı, gerçekten 0 olan grubu
 * gizlenmiş gruptan ayırt etmek isteyen tüketiciler için eklendi.
 *
 * Saf fonksiyon — birim testi kolaydır (bkz. `tests/mentor-count-k-anonymity.unit.test.ts`).
 */
export function applyKAnonymity(rawCount: number): KAnonymousCount {
  if (rawCount < K_ANONYMITY_THRESHOLD) {
    return { count: 0, suppressed: true };
  }
  return { count: rawCount, suppressed: false };
}

/** Bir NPS örneği: ortalama + yanıt sayısı. `suppressed` yalnız zaten maskelenmiş kayıtta bulunur. */
export interface NpsSample {
  avgNps: number | null;
  sampleSize: number;
  suppressed?: boolean;
}

/**
 * `maskNpsSample` dönüşü — dışarı (API yanıtı, e-posta, kayıtlı öneri) çıkan tek NPS biçimi.
 * `minSampleSize` = K_ANONYMITY_THRESHOLD; ekran "gizli (<N yanıt)" metnini sabitten kurabilsin diye.
 */
export interface MaskedNpsSample {
  avgNps: number | null;
  sampleSize: number;
  suppressed: boolean;
  minSampleSize: number;
}

/**
 * AJ-69 (V-05 kalanı): NPS ortalamasını k-anonimlik eşiğine göre gösterime hazırlar.
 * Eşiğin altındaki yanıta dayanan ortalama DÖNMEZ (null) ve yanıt sayısı 0'a indirgenir —
 * küçük kurumda 1-2 kişinin puanı ortalamadan okunmasın. `kpiReport.service.ts` ile aynı kural.
 *
 * - Hiç yanıt yoksa gizlenecek veri yoktur → `suppressed: false` (ekran "yetersiz veri" der).
 * - Zaten maskelenmiş kayıt (`suppressed: true`) yeniden maskelenince gizli kalır — sayısı 0 olsa da
 *   "veri yok"a dönüşmez (kayıtlı öneri okuma anında tekrar maskelenir).
 *
 * Saf fonksiyon — birim testi: `tests/algorithm-tuner-nps-scale.unit.test.ts`.
 */
export function maskNpsSample(sample: NpsSample): MaskedNpsSample {
  const hidden: MaskedNpsSample = {
    avgNps: null,
    sampleSize: 0,
    suppressed: true,
    minSampleSize: K_ANONYMITY_THRESHOLD,
  };
  if (sample.suppressed === true) return hidden;
  if (sample.sampleSize <= 0) {
    return { avgNps: null, sampleSize: 0, suppressed: false, minSampleSize: K_ANONYMITY_THRESHOLD };
  }
  const safeCount = applyKAnonymity(sample.sampleSize);
  if (safeCount.suppressed) return hidden;
  return {
    avgNps: sample.avgNps,
    sampleSize: safeCount.count,
    suppressed: false,
    minSampleSize: K_ANONYMITY_THRESHOLD,
  };
}

/** Gizlenmiş NPS ortalamasının kullanıcıya görünen metni (e-posta). Eşik sabitten gelir. */
export const NPS_HIDDEN_LABEL = `gizli (<${K_ANONYMITY_THRESHOLD} yanıt)`;

/**
 * NPS örneğini metne çevirir — ÖNCE maskeler (çağıran ham veri verse bile ortalama sızmaz).
 * Veri yoksa `emptyLabel`, eşik altıysa NPS_HIDDEN_LABEL, değilse ortalama.
 */
export function formatNpsSample(sample: NpsSample, emptyLabel = 'Yetersiz veri'): string {
  const masked = maskNpsSample(sample);
  if (masked.suppressed) return NPS_HIDDEN_LABEL;
  return masked.avgNps === null ? emptyLabel : String(masked.avgNps);
}

/**
 * `maskDefaultProfileRate` dönüşü — platform kurum analizindeki "varsayılana düşen profil" metriği.
 * `minGroupSize` = K_ANONYMITY_THRESHOLD; ekran "gizli (<N üye)" metnini sabitten kurabilsin diye.
 */
export interface DefaultProfileRate {
  withoutVector: number;
  activeMembers: number;
  ratePercent: number | null;
  suppressed: boolean;
  minGroupSize: number;
}

/**
 * AJ-79 (md.111 / G2-06): kurumun aktif üyelerinden DISC vektörü OLMAYANLARIN oranı.
 * Vektörü olmayan menti eşleştirmede vektör skoru yerine sınıflı matrise ya da nötr 50'ye düşer
 * (`scoring.ts` `computeDiscScore`) — bu oran "kaç profil varsayılana düşüyor" izleme metriğidir.
 *
 * k-anonimlik: grup = kurumun aktif üyeleri. Grup eşiğin altındaysa sayılar 0'a, oran null'a
 * indirgenir — 1-2 kişilik kurumda oran tek tek kişilerin durumunu söylerdi.
 * Hiç üye yoksa gizlenecek veri yoktur → `suppressed: false`, oran null (ekran "veri yok" der).
 *
 * Saf fonksiyon — birim testi: `tests/default-profile-rate.unit.test.ts`.
 */
export function maskDefaultProfileRate(withoutVector: number, activeMembers: number): DefaultProfileRate {
  if (activeMembers <= 0) {
    return { withoutVector: 0, activeMembers: 0, ratePercent: null, suppressed: false, minGroupSize: K_ANONYMITY_THRESHOLD };
  }
  if (activeMembers < 0 && applyKAnonymity(activeMembers).suppressed) { // MUTASYON: maske kaldırıldı
    return { withoutVector: 0, activeMembers: 0, ratePercent: null, suppressed: true, minGroupSize: K_ANONYMITY_THRESHOLD };
  }
  // Tek ondalık yeterli (kurum ölçeğinde %0,1 hassasiyet).
  const ratePercent = Math.round((withoutVector / activeMembers) * 1000) / 10;
  return { withoutVector, activeMembers, ratePercent, suppressed: false, minGroupSize: K_ANONYMITY_THRESHOLD };
}
