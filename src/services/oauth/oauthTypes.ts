/**
 * OAuth katmanının paylaşılan tipleri ve interface'leri.
 *
 * Tasarım kararı: Her provider (Google, LinkedIn, vb.) bu interface'i implement eder.
 * Yeni provider eklemek için sadece yeni bir sınıf oluşturmak yeterli —
 * controller veya service katmanı değişmez (Open/Closed prensibi).
 */

// ─── Provider interface ───────────────────────────────────────────────────────

/** Tüm OAuth provider'larının uyması gereken sözleşme. */
export interface IOAuthProvider {
  /** Provider kimliği — DB'deki authProvider alanı ile eşleşir. */
  readonly providerName: OAuthProviderName;

  /**
   * Kullanıcıyı yönlendirmek için provider'a özgü authorization URL'ini döner.
   * @param state - CSRF koruması için imzalanmış JWT
   */
  buildAuthUrl(state: string): string;

  /**
   * Authorization code'u provider ile exchange ederek normalize edilmiş kullanıcı
   * profilini döner. Her provider'ın farklı token + profile endpoint'i vardır;
   * bu metod farkı soyutlar.
   */
  exchangeCodeForProfile(code: string): Promise<OAuthUserProfile>;
}

// ─── Veri tipleri ─────────────────────────────────────────────────────────────

/** Desteklenen OAuth provider'ları — DB enum değerleri ile aynı kasada tutulur. */
export type OAuthProviderName = 'GOOGLE' | 'LINKEDIN';

/** Provider'lardan normalize edilerek dönen kullanıcı profil verisi. */
export interface OAuthUserProfile {
  /** Provider tarafında kullanıcının benzersiz ID'si (ileride provider_sub saklama için). */
  providerUserId: string;
  email: string;
  fullName: string;
  provider: OAuthProviderName;
  avatarUrl?: string;
}

/**
 * OAuth state JWT içeriği.
 *
 * Neden JWT? Session store gerekmeden stateless CSRF koruması sağlar.
 * State, callback URL'ine Google/LinkedIn tarafından iletilir; imzayı
 * doğrulamak için yeniden JWT_SECRET ile verify ederiz.
 */
export interface OAuthStatePayload {
  /** Kullanıcının kayıt olmak istediği tenant. */
  tenantSlug: string;
  /** Kullanıcının seçtiği rol. */
  role: 'MENTOR' | 'MENTI';
  /**
   * Replay saldırısını önlemek için rastgele nonce.
   * State JWT'si tek kullanımlık değildir (stateless), bu yüzden
   * kısa expiry (10 dk) + bu nonce birlikte yeterli koruma sağlar.
   */
  nonce: string;
  /**
   * U-06: kayıt sayfasındaki davet token'ı (varsa). OAuth akışı boyunca state içinde taşınır;
   * callback'te form kaydıyla aynı kuralla doğrulanır (doğru kurum + doğru rol → APPROVED).
   */
  inviteToken?: string;
}

/**
 * oauthService.handleOAuthCallback'in dönüş tipi.
 *
 * AN-30 / KARAR-34 (OAuth ayağı, 2026-09-26): granüler rıza flag'i (`config.oauth
 * .granularConsentEnabled`) AÇIKKEN yeni kullanıcı için kullanıcı HENÜZ oluşturulmamıştır —
 * bunun yerine `pendingConsent: true` + kısa ömürlü `pendingToken` döner (bkz.
 * oauthPendingRegistration.ts). Flag KAPALIYKEN (varsayılan) ilk üye her zaman döner —
 * davranış eskisiyle BİREBİR aynı kalır.
 */
export type OAuthCallbackResult =
  | {
      accessToken: string;
      refreshToken: string;
      /** Yeni kullanıcıysa true — frontend "onay bekleniyor" ekranını gösterir. */
      isNewUser: boolean;
    }
  | {
      pendingConsent: true;
      /** `POST /api/auth/oauth/complete-registration` ucuna geri gönderilecek imzalı token. */
      pendingToken: string;
    };
