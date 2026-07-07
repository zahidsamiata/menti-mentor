/**
 * Google OAuth 2.0 + OpenID Connect provider implementasyonu.
 *
 * Endpoint'ler: Google Identity Platform (OpenID Connect Discovery uyumlu)
 * Scopes: openid + profile + email — minimum gerekli izin seti (en az ayrıcalık prensibi)
 *
 * Neden OpenID Connect? Token exchange sonrası ayrı /userinfo çağrısı yapmak yerine
 * id_token içindeki claims'i kullanabiliriz. Burada her iki yol da desteklenir;
 * userinfo endpoint'i daha güvenilir olduğundan tercih edilir.
 */

import { config } from '../../config.js';
import type { IOAuthProvider, OAuthUserProfile } from './oauthTypes.js';

// Google OAuth 2.0 sabit endpoint'leri
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

// Google userinfo endpoint'inin döndürdüğü şekli
interface GoogleUserInfo {
  sub: string;        // Google'ın benzersiz kullanıcı ID'si
  email: string;
  name: string;
  email_verified: boolean;
}

// Google token exchange endpoint'inin döndürdüğü şekli
interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  error?: string;
  error_description?: string;
}

export class GoogleOAuthProvider implements IOAuthProvider {
  readonly providerName = 'GOOGLE' as const;

  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: config.oauth.google.clientId,
      redirect_uri: config.oauth.google.redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      // prompt=select_account: Kullanıcı hesap seçim ekranını her seferinde görür.
      // Bu, çoklu Google hesabı olan kullanıcılar için önemlidir.
      prompt: 'select_account',
      access_type: 'online', // refresh_token'a ihtiyaç yok; kendi refresh sistemimiz var
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCodeForProfile(code: string): Promise<OAuthUserProfile> {
    const tokenResponse = await this.exchangeCodeForTokens(code);
    const userInfo = await this.fetchUserInfo(tokenResponse.access_token);

    if (!userInfo.email_verified) {
      // Doğrulanmamış e-posta hesapları güvenlik riski oluşturur
      throw new OAuthProviderError('E-posta adresi Google tarafından doğrulanmamış.');
    }

    return {
      providerUserId: userInfo.sub,
      email: userInfo.email.toLowerCase(),
      fullName: userInfo.name,
      provider: this.providerName,
    };
  }

  private async exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.oauth.google.clientId,
        client_secret: config.oauth.google.clientSecret,
        redirect_uri: config.oauth.google.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const data = (await response.json()) as GoogleTokenResponse;
    if (data.error) {
      throw new OAuthProviderError(`Google token exchange hatası: ${data.error_description ?? data.error}`);
    }
    return data;
  }

  private async fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new OAuthProviderError(`Google userinfo endpoint hatası: ${response.status}`);
    }
    return response.json() as Promise<GoogleUserInfo>;
  }
}

/** Provider katmanından fırlatılan hatalar için özel hata sınıfı. */
export class OAuthProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthProviderError';
  }
}
