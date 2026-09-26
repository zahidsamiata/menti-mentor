// Yönetici blok listesi (Tenant.blockedPairs) için ortak okuma yardımcıları.
//
// KR-19: blok önceden yalnız rankMentisForMentor (mentör→menti listesi) yolunda
// uygulanıyordu — matching.ts içindeki buildBlockedMentiSet BİDİRECTİONAL'dı (hem
// fromUserId hem toUserId yönünü kontrol ediyordu) ama yalnız o dosyada, yalnız o
// yönde çağrılıyordu. Menti→mentör listesi, mesajlaşma, randevu ve anlaşma
// oluşturma yolları blok kontrolü hiç YAPMIYORDU (rapor: kod-inceleme-2026-09-24.md D4).
// Bu dosya, JSON blob'un ("Array<{fromUserId,toUserId,blockedAt,blockedBy}>") tüm
// okuyucularının aynı mantığı paylaşması için matching.ts'teki mevcut fonksiyonu
// genelleştirir — yeni bir blok MODELİ değil, tek bir okuma yolu.

type BlockPairLike = { fromUserId?: unknown; toUserId?: unknown };

/**
 * Bir kullanıcının (selfUserId) bu tenant'ta idari olarak bloklandığı KARŞI TARAF
 * ID kümesini döner. Yön farketmez: selfUserId ister fromUserId ister toUserId
 * tarafında olsun, karşı taraf kümeye eklenir (bkz. dosya başı notu — bidirectional).
 * JSON blob bozuk veya array değilse boş küme döner (defensive).
 */
export function buildBlockedCounterpartSet(selfUserId: string, blockedPairs: unknown): Set<string> {
  if (!Array.isArray(blockedPairs)) return new Set();
  const blocked = new Set<string>();
  for (const pair of blockedPairs as BlockPairLike[]) {
    if (typeof pair !== 'object' || pair === null) continue;
    const from = pair.fromUserId;
    const to   = pair.toUserId;
    if (from === selfUserId && typeof to === 'string') blocked.add(to);
    if (to === selfUserId && typeof from === 'string') blocked.add(from);
  }
  return blocked;
}

/**
 * Verilen bir tenant'ın blockedPairs JSON blob'unda, iki kullanıcı arasında
 * (yön bağımsız) idari blok var mı kontrol eder. Konuşma/randevu/anlaşma gibi
 * "eylem anı" kontrolleri için — liste filtrelemesi yerine tekil çift sorgusu.
 */
export function isPairBlocked(blockedPairs: unknown, userIdA: string, userIdB: string): boolean {
  if (!Array.isArray(blockedPairs)) return false;
  for (const pair of blockedPairs as BlockPairLike[]) {
    if (typeof pair !== 'object' || pair === null) continue;
    const from = pair.fromUserId;
    const to   = pair.toUserId;
    if ((from === userIdA && to === userIdB) || (from === userIdB && to === userIdA)) return true;
  }
  return false;
}
