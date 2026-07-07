/**
 * LinkedIn OAuth 2.0 + OpenID Connect provider implementasyonu.
 *
 * LinkedIn, 2023'ten itibaren OpenID Connect (OIDC) scope'larını desteklemektedir.
 * Scope: openid + profile + email
 * Bu scope seti, /userinfo endpoint'ini kullanmamıza olanak tanır —
 * eski /v2/me + email-address API'lerinden daha basit ve stabil bir yaklaşım.
 *
 * Referans: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
 */

import { config } from '../../config.js';
import { OAuthProviderError } from './googleProvider.js';
import type { IOAuthProvider, OAuthUserProfile } from './oauthTypes.js';

// LinkedIn OAuth 2.0 sabit endpoint'leri
const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';

// LinkedIn OIDC userinfo endpoint şekli
interface LinkedInUserInfo {
  sub: string;            // LinkedIn'in benzersiz kullanıcı ID'si
  email: string;
  name: string;
  email_verified: boolean;
}

// LinkedIn token exchange yanıt şekli
interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

export class LinkedInOAuthProvider implements IOAuthProvider {
  readonly providerName = 'LINKEDIN' as const;

  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.oauth.linkedin.clientId,
      redirect_uri: config.oauth.linkedin.redirectUri,
      state,
      scope: 'openid profile email',
    });
    return `${LINKEDIN_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCodeForProfile(code: string): Promise<OAuthUserProfile> {
    const tokenResponse = await this.exchangeCodeForTokens(code);
    const userInfo = await this.fetchUserInfo(tokenResponse.access_token);

    if (!userInfo.email_verified) {
      throw new OAuthProviderError('E-posta adresi LinkedIn tarafından doğrulanmamış.');
    }

    return {
      providerUserId: userInfo.sub,
      email: userInfo.email.toLowerCase(),
      fullName: userInfo.name,
      provider: this.providerName,
    };
  }

  private async exchangeCodeForTokens(code: string): Promise<LinkedInTokenResponse> {
    // LinkedIn, form-encoded body gerektirir (JSON değil)
    const response = await fetch(LINKEDIN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.oauth.linkedin.redirectUri,
        client_id: config.oauth.linkedin.clientId,
        client_secret: config.oauth.linkedin.clientSecret,
      }),
    });

    const data = (await response.json()) as LinkedInTokenResponse;
    if (data.error) {
      throw new OAuthProviderError(`LinkedIn token exchange hatası: ${data.error_description ?? data.error}`);
    }
    return data;
  }

  private async fetchUserInfo(accessToken: string): Promise<LinkedInUserInfo> {
    const response = await fetch(LINKEDIN_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new OAuthProviderError(`LinkedIn userinfo endpoint hatası: ${response.status}`);
    }
    return response.json() as Promise<LinkedInUserInfo>;
  }
}
