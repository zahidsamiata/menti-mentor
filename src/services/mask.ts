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
