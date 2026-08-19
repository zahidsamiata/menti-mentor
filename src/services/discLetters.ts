/**
 * DISC çoklu-harf gösterimi (KARAR 1 · iş #12).
 *
 * Kişinin DISC kimliğini tek baskın harf yerine, gerçek profiline göre 1–3 harflik bir
 * dizge olarak TÜRETİR (ör. "D", "DI", "Di", "DIs"). Saf hesaplama — DB/HTTP bağımlılığı yok.
 *
 * Kaynak veri: normalize DISC vektörü (D + I + S + C = 1.0). Harf HER SEFERİNDE bu vektörden
 * türetilir; ayrı bir alan SAKLANMAZ (migration yok — en risksiz yol).
 *
 * Güvenlik/mahremiyet: gösterilen, türetilmiş bir KATEGORİ (harf) — ham yüzde vektörü DEĞİL.
 * KARAR 5 (DISC görünürlük) ile uyumludur: bu fonksiyon yalnız harfi üretir; "kim görebilir"
 * kararı çağıran katmanda `canViewerSeeDiscType` ile verilir (menti→mentör harfi gösterilmez).
 *
 * Not (normalize modelin sonucu): D+I+S+C = 1.0 ve orta çizgi 0.25 iken, dört tipin HEPSİNİN
 * aynı anda 0.25 üstü olması matematiksel olarak imkânsızdır → pratikte sonuç 1–3 harftir.
 */

export type DiscScores = { D: number; I: number; S: number; C: number };

/**
 * DISC harf eşikleri — TEK MERKEZİ AYAR NOKTASI.
 *
 * ⚠️ BAŞLANGIÇ DEĞERLERİ — gerçek kullanıcı verisi biriktikçe ileride kalibre edilecek.
 * Eşikleri değiştirmek için YALNIZCA burayı düzenle; hesaplama mantığı (aşağıda) sabit kalır.
 * Değerler dağıtılmaz; her yerde bu config kullanılır.
 *
 * (Onay: ürün sahibi, 2026-08-17 — orta çizgi = 0.25 normalize vektör; BÜYÜK/küçük = birincilin %75'i.)
 */
export const DISC_LETTER_CONFIG = {
  /**
   * Orta çizgi (midline): normalize vektörde eşit pay = 0.25. Bir tip bu eşiği GEÇERSE
   * (strict `>`) gösterilir. Birincil (baskın) tip eşiği geçmese bile DAİMA gösterilir
   * (düz/eşit profil güvencesi — en az bir harf).
   */
  midline: 0.25,
  /**
   * BÜYÜK/küçük harf eşiği: orta çizgiyi geçen İKİNCİL bir tip, birincilin bu oranı
   * (0.75 = %75) veya üstündeyse BÜYÜK; altındaysa küçük harf yazılır. Birincil her zaman BÜYÜK.
   */
  uppercaseRatioOfPrimary: 0.75,
} as const;

// Tie-break sırası — baskın harf mantığıyla birebir tutarlı
// (adaptiveTestEngine.getDominantType: eşitlikte D > I > S > C).
const DISC_ORDER = ['D', 'I', 'S', 'C'] as const;

/**
 * Normalize DISC skorlarından 1–3 harflik DISC kimlik dizgesini üretir.
 *
 * Kural (KARAR 1):
 *  - Orta çizgiyi geçen tipler güçten zayıfa (büyükten küçüğe) sıralanır; birincil başta.
 *  - Birincile yakın olanlar (≥ %75) BÜYÜK, zayıfça geçenler küçük harf.
 *  - Yalnız tek tip geçiyorsa tek harf ("saf stil") — ikincil zorla atanmaz.
 *
 * @param scores normalize DISC vektörü ({ D, I, S, C }, toplam ≈ 1.0)
 * @returns 1–3 harflik dizge (ör. "D", "DI", "Di", "DIs"); geçersiz/eksik girdi → "".
 */
export function computeDiscLetters(scores: DiscScores | null | undefined): string {
  if (!scores) return '';

  const vals = DISC_ORDER.map((key) => ({ key, score: Number(scores[key]) }));
  if (vals.some((v) => !Number.isFinite(v.score))) return '';

  // Güçten zayıfa; eşitlikte sabit D > I > S > C sırası.
  const ranked = [...vals].sort((a, b) =>
    b.score !== a.score
      ? b.score - a.score
      : DISC_ORDER.indexOf(a.key) - DISC_ORDER.indexOf(b.key),
  );

  const primary = ranked[0];
  const { midline, uppercaseRatioOfPrimary } = DISC_LETTER_CONFIG;

  // Gösterilecekler: birincil (daima) + orta çizgiyi GEÇEN diğer tipler.
  const shown = ranked.filter((r) => r.key === primary.key || r.score > midline);

  const upperThreshold = primary.score * uppercaseRatioOfPrimary;
  return shown
    .map((r) => (r.score >= upperThreshold ? r.key : r.key.toLowerCase()))
    .join('');
}

/**
 * Prisma `Json` (discVector) → DISC harf dizgesi. Tip-güvenli: geçersiz/eksik JSON → "".
 * Kaynak vektör {D,I,S,C,confidence} olabilir; yalnız D/I/S/C kullanılır.
 * Çağıran katman ham vektörü response'a KOYMAZ — yalnız bu türetilmiş harfi gönderir (KARAR 5/PII).
 */
export function discLettersFromVector(raw: unknown): string {
  if (raw === null || typeof raw !== 'object') return '';
  const v = raw as Record<string, unknown>;
  if (
    typeof v['D'] !== 'number' ||
    typeof v['I'] !== 'number' ||
    typeof v['S'] !== 'number' ||
    typeof v['C'] !== 'number'
  ) {
    return '';
  }
  return computeDiscLetters({ D: v['D'], I: v['I'], S: v['S'], C: v['C'] });
}
