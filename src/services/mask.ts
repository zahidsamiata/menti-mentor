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
