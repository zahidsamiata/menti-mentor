// Prisma `select` için paylaşılan, adlandırılmış alan kümeleri (AJ-09).
//
// Neden: `email`/`fullName` gibi aynı alan kümesi onlarca yerde satır içi tekrar ediyordu.
// Burada yalnız BİREBİR aynı alan kümesini kullanan yerler birleştirildi — farklı alan kümesi
// olan `select`'lere (over-fetch/under-fetch riski doğurmamak için) DOKUNULMADI.
//
// ⛔ `password` / `passwordHash` / token alanları buraya ASLA eklenmez (bkz. Güvenlik Kuralları,
// "Veri döndürürken" — CLAUDE.md). Yeni bir alan eklerken önce PII mi Analytical mi diye sınıflandır.

// Bildirim/e-posta gönderimi gibi yalnızca iletişim bilgisi gereken yerlerde kullanılan minimal küme.
export const USER_CONTACT_SELECT = { email: true, fullName: true } as const;

// Kimlik + iletişim (id dahil) — örn. bir kayda referans + görünen ad + e-posta birlikte gerektiğinde.
export const USER_IDENTITY_SELECT = { id: true, fullName: true, email: true } as const;

// Onay/red akışları (admin) — kimlik + iletişim + onay durumu.
export const USER_APPROVAL_SELECT = {
  id: true,
  email: true,
  fullName: true,
  approvalStatus: true,
} as const;
