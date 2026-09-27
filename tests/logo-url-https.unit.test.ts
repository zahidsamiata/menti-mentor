/**
 * F-04 / AJ-05 — kurum logosu adresi güvenlik kısıtları (saf şema testi, DB'siz).
 */
import { describe, it, expect } from 'vitest';
import { logoUrlSchema, isSafeLogoUrl } from '../src/services/logoUrl.js';

describe('F-04/AJ-05: logoUrlSchema', () => {
  it('izinli uzantılı https adresleri kabul edilir', () => {
    for (const good of [
      'https://cdn.example.com/logo.png',
      'https://cdn.example.com/logo.jpg',
      'https://cdn.example.com/logo.jpeg',
      'https://cdn.example.com/logo.webp',
      'https://cdn.example.com/assets/LOGO.PNG', // büyük/küçük harf duyarsız
      'https://cdn.example.com/logo.png?v=2&x=y', // sorgu dizesi uzantıyı bozmaz
      'https://sub.cdn.example.com/logo.png', // alt alan adı serbest
    ]) {
      expect(logoUrlSchema.safeParse(good).success, good).toBe(true);
    }
  });

  it('negatif: https dışındaki şemalar ve bozuk adres reddedilir', () => {
    for (const bad of [
      'http://example.com/logo.png',
      'javascript:alert(1)',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'ftp://example.com/logo.png',
      '//example.com/logo.png',
      'logo.png',
      '',
    ]) {
      expect(logoUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('negatif: aşırı uzun adres reddedilir (geçerli uzantıya rağmen)', () => {
    expect(logoUrlSchema.safeParse('https://e.com/' + 'a'.repeat(2100) + '.png').success).toBe(false);
  });

  it('negatif: izinsiz/eksik dosya uzantısı reddedilir (SVG dahil)', () => {
    for (const bad of [
      'https://cdn.example.com/logo.svg', // XSS riski gerekçesiyle kasıtlı reddedilir
      'https://cdn.example.com/logo.gif',
      'https://cdn.example.com/logo.bmp',
      'https://cdn.example.com/logo', // uzantısız
      'https://cdn.example.com/logo.png/../evil.php',
    ]) {
      expect(logoUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('negatif: kullanıcı bilgisi (userinfo) içeren adres reddedilir', () => {
    expect(logoUrlSchema.safeParse('https://user:pass@cdn.example.com/logo.png').success).toBe(false);
  });

  it('negatif: açık port belirtilen adres reddedilir', () => {
    expect(logoUrlSchema.safeParse('https://cdn.example.com:8443/logo.png').success).toBe(false);
    // https varsayılan portu (443) normalize edilip boş kaldığı için bu geçerli kalır
    expect(logoUrlSchema.safeParse('https://cdn.example.com:443/logo.png').success).toBe(true);
  });

  it('negatif: localhost ve iç/mDNS/kurumsal ağ host adları reddedilir', () => {
    for (const bad of [
      'https://localhost/logo.png',
      'https://LOCALHOST/logo.png',
      'https://foo.localhost/logo.png',
      'https://printer.local/logo.png',
      'https://cdn.internal/logo.png',
      'https://fileserver.corp/logo.png',
      'https://nas.lan/logo.png',
    ]) {
      expect(logoUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('negatif: HER IPv4 literal reddedilir — genel/özel ayrımı yapılmaz (gizlenmiş biçimler dahil)', () => {
    for (const bad of [
      'https://93.184.216.34/logo.png', // herhangi bir genel IPv4 literal — alan adı değil
      'https://127.0.0.1/logo.png', // loopback
      'https://10.0.0.5/logo.png', // RFC1918
      'https://172.16.0.5/logo.png', // RFC1918
      'https://192.168.1.5/logo.png', // RFC1918
      'https://169.254.169.254/logo.png', // bulut metadata servisi (AWS/GCP/Azure)
      'https://0.0.0.0/logo.png',
      'https://0x7f.0.0.1/logo.png', // hex-gizlenmiş 127.0.0.1 → URL ayrıştırıcı normalize eder
      'https://0177.0.0.1/logo.png', // oktal-gizlenmiş 127.0.0.1
      'https://2130706433/logo.png', // tek sayı olarak gizlenmiş 127.0.0.1
      'https://127.1/logo.png', // kısaltılmış biçim → 127.0.0.1'e normalize edilir
    ]) {
      expect(logoUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('negatif: HER IPv6 literal reddedilir (loopback, link-local, unique-local, IPv4-eşlemeli, genel)', () => {
    for (const bad of [
      'https://[::1]/logo.png',
      'https://[fe80::1]/logo.png',
      'https://[fc00::1]/logo.png',
      'https://[::ffff:127.0.0.1]/logo.png', // IPv4-eşlemeli loopback
      'https://[::ffff:169.254.169.254]/logo.png', // IPv4-eşlemeli bulut metadata
      'https://[2606:4700:4700::1111]/logo.png', // genel bir IPv6 literal dahi reddedilir
    ]) {
      expect(logoUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('isSafeLogoUrl doğrudan çağrıldığında da aynı kuralları uygular', () => {
    expect(isSafeLogoUrl('https://cdn.example.com/logo.png')).toBe(true);
    expect(isSafeLogoUrl('https://127.0.0.1/logo.png')).toBe(false);
  });
});
