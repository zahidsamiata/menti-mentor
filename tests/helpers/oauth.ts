/**
 * AN-30 / KARAR-34 (OAuth ayağı) — `OAuthCallbackResult` union oldu (flag açıkken
 * `{ pendingConsent: true, pendingToken }` döner). Testler `GRANULAR_CONSENT_ENABLED` KAPALI
 * ortamda koşar → sonuç HER ZAMAN token içeren varyanttır. Bu yardımcı TS'e bunu kanıtlar ve
 * (regresyon ihtimaline karşı) `pendingConsent` gelirse testi açıkça patlatır.
 */
import type { OAuthCallbackResult } from '../../src/services/oauth/oauthTypes.js';

export function expectTokenResult(
  result: OAuthCallbackResult,
): Extract<OAuthCallbackResult, { accessToken: string }> {
  if ('pendingConsent' in result) {
    throw new Error(
      'Beklenmeyen pendingConsent sonucu — bu test GRANULAR_CONSENT_ENABLED kapalıyken token dönmesini varsayar.',
    );
  }
  return result;
}
