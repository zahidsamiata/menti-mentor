import type { TenantVerificationStatus } from '@prisma/client';

/**
 * Y1-B9 — Kurum askı kapısı: platformun dondurduğu ya da başvurusu reddedilen kurumun
 * kullanıcıları kurum uçlarını kullanamaz, kuruma yeni üye alınamaz.
 *
 * Neden iki alan: "askıda" kodda iki ayrı yazımla oluşur ve ikisi de NİYETLİDİR:
 *  - `Tenant.isActive=false` YALNIZ platform işlemleriyle yazılır: dondurma
 *    (`platformController.freezeTenant`, `adminSettingsController.updateTenantStatus`) ve
 *    süper-yönetici reddi (`adminSettingsController.verifyTenant` reject). Kurum kaydı
 *    (`selfServeController.selfServeRegister`) şema varsayılanı `true` ile açılır; kurulum/taslak
 *    kurum HİÇBİR akışta `isActive=false` olmaz — kurulum durumu ayrı alandadır (`onboardingStep`).
 *  - `verificationStatus=REJECTED` platform reddidir (`platformController.rejectTenant` isActive'e
 *    dokunmaz → bu yüzden durum ayrıca okunur).
 *
 * Bilerek KAPATILMAYANLAR: `PENDING_REVIEW` (inceleme bekleyen kurum yöneticisi bekleme ekranını
 * ve kurulum uçlarını kullanır; yeni üye kaydı zaten ayrı `TENANT_ONAY_BEKLENIYOR` kapısıyla kapalı)
 * ve `CORRECTION_REQUESTED` (yönetici düzeltme gönderebilmeli).
 */
export interface TenantStatusFields {
  isActive: boolean;
  verificationStatus: TenantVerificationStatus;
}

/** Saf karar fonksiyonu — veritabanından bağımsız birim testlenir. */
export function isTenantSuspended(tenant: TenantStatusFields): boolean {
  return !tenant.isActive || tenant.verificationStatus === 'REJECTED';
}

/**
 * Askı kapısından MUAF uçlar — TEK liste (requireTenant adım 4b burayı okur).
 *
 * - `GET /api/auth/me`: oturum/durum okuma. Reddedilen kurumun yöneticisi ret ekranını
 *   (`/onboarding/stk/pending-review`), askıdaki üye askı bilgisini (`tenant.isSuspended`) buradan görür.
 * - `GET /api/me/data-export`, `POST /api/me/delete-account`: KVKK md.11 veri sahibi hakları
 *   (verisini öğrenme/alma, silinmesini isteme; hesap kapatma ACIK_RIZA'yı da geri çeker).
 *   Bunlar YASAL haktır, ürün tercihi değildir: kurumun askıya alınması üyenin kendi verisi
 *   üzerindeki hakkını kesemez. Uçlar kimliği token'dan alır (IDOR yok) ve rate-limitlidir.
 *
 * Yeni bir uç buraya eklenmeden önce: yalnız KENDİ verisini okuyan/silen ya da oturum durumunu
 * gösteren uç olmalı; kurum verisi dönen ya da kurum adına yazan uç ASLA eklenmez.
 */
const SUSPENSION_EXEMPT_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'GET',  path: '/api/auth/me' },
  { method: 'GET',  path: '/api/me/data-export' },
  { method: 'POST', path: '/api/me/delete-account' },
];

/**
 * İstek askı kapısından muaf mı? `originalUrl` kullanılır (router mount'undan bağımsız tam yol);
 * sorgu dizesi atılır, Express'in varsayılan yönlendirmesiyle uyumlu olsun diye büyük/küçük harf
 * ve sondaki "/" normalize edilir.
 */
export function isSuspensionExemptRequest(method: string, originalUrl: string): boolean {
  const rawPath = originalUrl.split('?')[0] ?? '';
  const path = (rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath).toLowerCase();
  const upperMethod = method.toUpperCase();
  return SUSPENSION_EXEMPT_ROUTES.some((r) => r.method === upperMethod && r.path === path);
}

/** Askıdaki kurumun üyesine dönen yanıt (403). Dondurma/ret ayrımı ve iç detay verilmez. */
export const TENANT_SUSPENDED_BODY = {
  error:   'KURUM_ASKIDA',
  message: 'Kurumunuzun hesabı şu an askıda. Kurum yöneticinizle iletişime geçin.',
} as const;

/**
 * Askıdaki kuruma yeni üye kaydı / davetle katılım denemesine dönen yanıt (403).
 * Komşu kapı `TENANT_ONAY_BEKLENIYOR` ile aynı düzeyde bilgi verir: kurumun var olduğu zaten
 * slug/davet ile biliniyor; dondurma mı ret mi olduğu söylenmez.
 */
export const TENANT_CLOSED_FOR_SIGNUP_BODY = {
  error:   'KURUM_KAYDA_KAPALI',
  message: 'Bu kuruma şu an yeni kayıt alınmıyor. Kurum yöneticinizle iletişime geçin.',
} as const;
