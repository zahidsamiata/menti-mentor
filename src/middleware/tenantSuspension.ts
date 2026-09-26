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
