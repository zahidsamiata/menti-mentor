export interface PlatformSession {
  accessToken: string;
}

const KEY = 'platform_session';

export function getPlatformSession(): PlatformSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlatformSession) : null;
  } catch {
    return null;
  }
}

export function setPlatformSession(session: PlatformSession): void {
  localStorage.setItem(KEY, JSON.stringify(session));
  document.cookie = 'platform_auth=1; path=/; max-age=86400';
}

export function clearPlatformSession(): void {
  localStorage.removeItem(KEY);
  document.cookie = 'platform_auth=; path=/; max-age=0';
}
