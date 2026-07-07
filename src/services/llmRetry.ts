/**
 * OpenAI API Retry Yardımcısı — Üstel Geri Çekilme (Exponential Backoff)
 *
 * matchReason.ts (eşleşme gerekçesi) tarafından kullanılır.
 * Sistemde OpenAI çağrısı yapan tek aktif servis budur; iceBreaker kaldırıldı.
 *
 * Retry stratejisi:
 *   - Yalnızca geçici hatalar yeniden denenir: ağ hatası, 429, 500, 502, 503, 504
 *   - 400, 401, 403 gibi kalıcı hatalar anında fallback'e geçer
 *   - Her denemede bekleme süresi: baseDelay * 2^(attempt-1) + random jitter
 *   - Maksimum bekleme: 10 saniye (DoS koruması)
 *
 * Örnek gecikme profili (baseDelay=200ms):
 *   Deneme 1: 0ms   (ilk deneme)
 *   Deneme 2: ~400ms
 *   Deneme 3: ~800ms
 */

/** Geçici hata olarak sınıflandırılan HTTP durum kodları */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const BASE_DELAY_MS = 200;
const MAX_DELAY_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * fetch çağrısını otomatik üstel geri çekilme ile yeniden dener.
 *
 * @param fn           - Her denemede çağrılacak fetch factory fonksiyonu
 * @param maxAttempts  - Maksimum deneme sayısı (varsayılan: 3)
 * @returns            - Başarılı Response veya son başarısız Response
 * @throws             - Yalnızca ağ hatası (DNS, connection refused vb.)
 */
export async function fetchWithRetry(
  fn: () => Promise<Response>,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<Response> {
  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fn();
    } catch (networkErr) {
      // Ağ hatası — son denemede fırlat, değilse bekle ve yeniden dene
      if (attempt === maxAttempts) throw networkErr;
      await sleep(calcDelay(attempt));
      continue;
    }

    // Başarılı yanıt
    if (response.ok) return response;

    lastResponse = response;

    // Kalıcı hata (401, 403, 400 vb.) — hemen geri dön, retry yok
    if (!RETRYABLE_STATUS_CODES.has(response.status)) return response;

    // Son denemeyse geri dön
    if (attempt === maxAttempts) return response;

    // 429 Rate Limit: Retry-After başlığına uy
    const retryAfter = response.headers.get('Retry-After');
    const delay = retryAfter
      ? Math.min(parseInt(retryAfter, 10) * 1000, MAX_DELAY_MS)
      : calcDelay(attempt);

    await sleep(delay);
  }

  // Bu noktaya ulaşılmamalı; tip güvenliği için
  return lastResponse!;
}

/** Üstel gecikme + rastgele jitter hesabı */
function calcDelay(attempt: number): number {
  const exponential = BASE_DELAY_MS * Math.pow(2, attempt - 1);
  const jitter = Math.random() * BASE_DELAY_MS;
  return Math.min(exponential + jitter, MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
