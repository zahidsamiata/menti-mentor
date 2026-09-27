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

// ─── Kayıt yapısı + normalize (E-3d: liste/kaldırma uçları da bunu paylaşır) ──

export interface BlockedPairRecord {
  fromUserId: string;
  toUserId:   string;
  blockedAt:  string;
  blockedBy:  string; // adminUserId
}

/**
 * Yön bağımsız çift kimliği: `POST /block-pair` (oluştur), `GET /block-pairs`
 * (listele) ve `DELETE /block-pair/:pairId` (kaldır) AYNI algoritmayı kullanır —
 * A→B ve B→A aynı pairId'yi üretir (fromUserId/toUserId sırası önemsiz). Ayrı
 * bir `id` sütunu/alanı EKLENMEDİ (şema değişmez, E-3d kapsamı) — bu iki
 * kullanıcı ID'sinden türeyen deterministik anahtar, mevcut duplicate-engelleme
 * mantığıyla (sanitizeBlockedPairs) zaten aynı.
 */
export function pairKey(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join('::');
}

/**
 * DB'den okunan blockedPairs JSON blob'unu güvenli şekilde parse eder.
 * - Array değilse boş dizi döner (bozuk blob koruması)
 * - Her kaydın zorunlu alanlarını doğrular; bozuk kayıtları sessizce filtreler
 * - Kendi kendini bloke eden ve duplicate kayıtları normalleştirir
 */
export function sanitizeBlockedPairs(raw: unknown): BlockedPairRecord[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.filter((item): item is BlockedPairRecord => {
    if (typeof item !== 'object' || item === null) return false;
    const r = item as Record<string, unknown>;
    if (
      typeof r['fromUserId'] !== 'string' || r['fromUserId'].length === 0 ||
      typeof r['toUserId']   !== 'string' || r['toUserId'].length   === 0 ||
      typeof r['blockedAt']  !== 'string' ||
      typeof r['blockedBy']  !== 'string'
    ) return false;
    // Self-block filtrele
    if (r['fromUserId'] === r['toUserId']) return false;
    // Yön-bağımsız duplicate filtrele
    const key = pairKey(r['fromUserId'], r['toUserId']);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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

/**
 * AJ-28 (KR-19 kalanı): aday LİSTESİ için idari blok kümesi — eylem uçlarıyla AYNI kural.
 *
 * Eylem anı kontrolü (KR-19b `isPairBlockedInTenants`: konuşma başlatma/mesaj, eşleşme isteği)
 * çifti İKİ tarafın kurumunda arar: çağıranın istek kurumu + karşı tarafın kendi kurumu;
 * herhangi birinde blok varsa eylem durur. Liste ise önceden yalnız çağıranın kurumunu
 * okuyordu → kurumlar arası havuzda karşı kurumun yöneticisinin koyduğu blok listede
 * görünmüyordu (eylemler engelliyken kart görünmeye devam ediyordu).
 *
 * Kural: aday, (a) çağıranın kurumunun listesinde ya da (b) ADAYIN KENDİ kurumunun
 * listesinde self ile engellenmişse kümeye girer. Üçüncü bir kurumun listesi sayılmaz —
 * eylem uçları da yalnız bu iki kurumu okur (birebir hizalı).
 */
export function buildListBlockedSet(
  selfUserId: string,
  callerTenantBlockedPairs: unknown,
  poolTenants: ReadonlyArray<{ id: string; blockedPairs?: unknown }>,
  candidates: ReadonlyArray<{ id: string; tenantId: string | null }>,
): Set<string> {
  const blocked = buildBlockedCounterpartSet(selfUserId, callerTenantBlockedPairs);
  const byTenant = new Map<string, Set<string>>();
  for (const t of poolTenants) {
    const set = buildBlockedCounterpartSet(selfUserId, t.blockedPairs);
    if (set.size > 0) byTenant.set(t.id, set);
  }
  if (byTenant.size === 0) return blocked;
  for (const c of candidates) {
    if (c.tenantId && byTenant.get(c.tenantId)?.has(c.id)) blocked.add(c.id);
  }
  return blocked;
}
