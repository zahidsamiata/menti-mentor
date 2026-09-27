/**
 * F-04 (AJ-05): kurum logosu adresi güvenlik kısıtları.
 *
 * Neden: logo her üye ekranında `<img src>` olarak çizilir — TARAYICIDA, kullanıcının kendi
 * bilgisayarından. Backend bu adresi asla fetch etmez (grep doğrulandı), yani klasik sunucu-taraflı
 * SSRF riski yok; asıl risk (1) kimlik avı — `https://kurum-gibi@evil.com` biçiminde userinfo ile
 * yanıltma, (2) tarayıcı üzerinden iç ağ/localhost'a görsel isteği (bir yönetici/üye tarayıcısı bu
 * adrese istek atar — SSRF-BENZERİ, "browser-side" varyant) ve bulut metadata adresi
 * (169.254.169.254) gibi hassas iç adreslere link verilmesi, (3) beklenmeyen dosya türü.
 *
 * IP-literal kararı: meşru bir CDN/görsel barındırma servisi HER ZAMAN bir alan adı kullanır (https
 * sertifikaları da pratikte alan adına bağlıdır). Bu yüzden IP-literal (IPv4/IPv6) hostname'ler
 * ayrım yapmadan (özel/genel fark etmez) TÜMÜYLE reddedilir — bu hem "çıplak IP" hem de "özel ağ"
 * riskini tek kontrolle kapatır. WHATWG URL ayrıştırıcısı gizlenmiş biçimleri (hex/oktal/tek-sayı/
 * kısaltılmış) ayrıştırırken kanonik noktalı-ondalık/IPv6 forma normalize eder — yani
 * `0x7f.0.0.1`, `0177.0.0.1`, `2130706433` gibi gizlenmiş adresler de `hostname` alanında
 * `127.0.0.1` olarak görünür ve aynı kontrolden yakalanır (regex bypass'ı yok). Alan adı sonundaki
 * "kök bölge noktası" (`localhost.`, `x.local.` — DNS'te geçerli bir FQDN gösterimi, tarayıcı aynı
 * host'u ÇÖZER) URL ayrıştırıcısı tarafından SİLİNMEZ; bu yüzden `isSafeLogoUrl` içinde hostname
 * karşılaştırmadan ÖNCE sondaki nokta(lar) ayıklanır — aksi halde `https://localhost./logo.png`
 * iç-host kontrolünü atlatırdı.
 *
 * Kapsam: bu kısıt yalnız YAZMA (tenant oluşturma/güncelleme, self-serve onboarding) yolunda
 * uygulanır — mevcut kayıtlı logoUrl değerleri OKUMADA hiç doğrulanmaz, geriye dönük kırılma yok.
 *
 * SVG kasıtlı olarak reddedilir (izin verilen uzantı listesinde YOK): `<img src>` ile yüklenen SVG
 * içindeki `<script>` modern tarayıcılarda ÇALIŞMAZ, ama XML tabanlı SVG'nin `xlink:href`/CSS
 * `url()` gibi ikincil kaynak çekme yolları ve bazı eski/özel görüntüleyiciler (ör. sunucu tarafı
 * thumbnail üretimi) risk taşımaya devam eder. Basit ve tutarlı bir kural için SVG tümüyle
 * reddedilir; kendi `/uploads` yolumuz için ayrık istisna açmıyoruz — yükleme uçları zaten kendi
 * uzantı/MIME kontrolünü ayrıca yapar (bu dosya yalnız DIŞARIDAN girilen logoUrl'i kısıtlar).
 *
 * Frontend `frontend/src/lib/logoUrl.ts` `isLogoUrlSafeToSave` ile AYNI kural seti — biri değişirse
 * diğeri de güncellenir (ayrı paket olduğu için kod paylaşılamıyor, kural paylaşılıyor).
 */
import { z } from 'zod';

export const LOGO_URL_MESSAGE =
  'Logo adresi https:// ile başlayan, gerçek bir alan adına ait (IP adresi, localhost, port veya ' +
  'kullanıcı bilgisi İÇERMEYEN) ve desteklenen bir uzantıyla biten (.png, .jpg, .jpeg, .webp) bir ' +
  'görsel adresi olmalı.';

/** İzin verilen logo dosya uzantıları — SVG kasıtlı olarak dışarıda (yukarıdaki gerekçe). */
const ALLOWED_LOGO_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** `hostname` dört noktalı ondalık bir IPv4 literal mi? (WHATWG URL zaten kanonik forma normalize eder.) */
function isIPv4Literal(hostname: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

/** `hostname` köşeli parantezli bir IPv6 literal mi? (WHATWG URL, IPv6 host'ları hep `[...]` yazar.) */
function isIPv6Literal(hostname: string): boolean {
  return hostname.startsWith('[') && hostname.endsWith(']');
}

/** `localhost`, `*.localhost`, `*.local` (mDNS/zeroconf) ve yaygın iç ağ TLD'leri. */
function isLocalOrInternalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') || // mDNS/zeroconf
    hostname.endsWith('.internal') ||
    hostname.endsWith('.intranet') ||
    hostname.endsWith('.corp') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.home.arpa')
  );
}

/**
 * Kapsamlı logo URL güvenlik kontrolü:
 * - yalnız `https:` şeması
 * - kullanıcı bilgisi (`user:pass@`) YOK — kimlik avı vektörü
 * - port YOK (varsayılan 443 dışında bir port belirtilemez)
 * - IP-literal (IPv4/IPv6) tamamen YASAK — genel/özel ayrımı yapılmaz (üstteki gerekçe)
 * - `localhost` / `*.localhost` / `*.local` / yaygın iç ağ TLD'leri YASAK
 * - yol, izinli bir görsel uzantısıyla bitmeli (SVG hariç — üstteki gerekçe)
 */
export function isSafeLogoUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.port !== '') return false;

  // DNS'te sondaki nokta kök-bölge (FQDN) gösterimidir; tarayıcı/URL ayrıştırıcısı bunu SİLMEZ
  // (`localhost.` != `localhost` string olarak) ama çözümlenen host AYNIDIR — normalize etmezsek
  // `https://localhost./logo.png` gibi bir adres iç-host kontrolünü atlatır.
  const hostname = url.hostname.replace(/\.+$/, '');
  if (isIPv4Literal(hostname) || isIPv6Literal(hostname)) return false;
  if (isLocalOrInternalHostname(hostname)) return false;

  const lowerPath = url.pathname.toLowerCase();
  if (!ALLOWED_LOGO_EXTENSIONS.some((ext) => lowerPath.endsWith(ext))) return false;

  return true;
}

export const logoUrlSchema = z.string().max(2048).refine(isSafeLogoUrl, { message: LOGO_URL_MESSAGE });
