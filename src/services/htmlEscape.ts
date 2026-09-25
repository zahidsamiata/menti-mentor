/**
 * GV-15 — e-posta HTML gövdesi için kaçış yardımcıları (saf, DB/SMTP'siz).
 *
 * Neden: e-posta şablonları kullanıcı/kurum kaynaklı metni (ad, kurum adı, not, gerekçe…)
 * HTML'e doğrudan gömüyordu; bu metin e-postanın görünümünü değiştirebiliyordu.
 * Kural: şablondaki SABİT HTML güvenilirdir; `${…}` ile giren HER dinamik değer
 * `escapeHtml` ile kaçırılır. `href="…"` içindeki URL'ler de aynı yardımcıyla kaçırılır
 * (tırnak dahil) — URL'nin kullanıcı kaynaklı parçaları ayrıca `encodeURIComponent` alır.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Metni HTML gövdesine VE çift/tek tırnaklı attribute değerine güvenle yerleştirilebilir hâle getirir.
 * null/undefined → boş dize; sayı/Date gibi değerler String() ile metne çevrilir.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * E-posta başlığı (subject) düz metindir — HTML kaçışı GEREKMEZ, ama satır sonu
 * başlık enjeksiyonuna açıktır. CR/LF ve diğer kontrol karakterleri boşluğa çevrilir.
 * (nodemailer da başlık değerlerindeki CR/LF'yi boşluğa çeviriyor; bu, ona bağımlı
 * kalmamak için savunma katmanıdır.)
 */
export function sanitizeHeaderText(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ');
}
