-- AN-30 / KARAR-34 — kayıt ekranında AYRI AYRI rıza kutuları için 6 yeni ConsentType değeri.
-- Additive: yalnız enum'a YENİ değer ekler; mevcut satır/veri DOKUNULMAZ (veri kaybı yok).
-- Neon shadow-DB uyumu: `ALTER TYPE ... ADD VALUE IF NOT EXISTS` (CLAUDE.md migration kuralı).
-- Uygulama (PO onayı sonrası): `prisma db execute --file <bu dosya>` + ardından
--           `prisma migrate resolve --applied 20260926150000_add_granular_consent_types`
-- (CLAUDE.md kuralı: `db push --accept-data-loss` YASAK; canlı=lokal DB → PO onayı ile.)
--
-- Gruplar (bkz. backend/src/services/consentService.ts):
--   ZORUNLU:      DISC_ESLESTIRME, YURT_DISI_SAKLAMA, VERI_ISLEME, ANONIM_IYILESTIRME
--   İSTEĞE BAĞLI: KURUMLARARASI_PAYLASIM, OCEAN_PROFIL

ALTER TYPE "ConsentType" ADD VALUE IF NOT EXISTS 'DISC_ESLESTIRME';
ALTER TYPE "ConsentType" ADD VALUE IF NOT EXISTS 'YURT_DISI_SAKLAMA';
ALTER TYPE "ConsentType" ADD VALUE IF NOT EXISTS 'VERI_ISLEME';
ALTER TYPE "ConsentType" ADD VALUE IF NOT EXISTS 'ANONIM_IYILESTIRME';
ALTER TYPE "ConsentType" ADD VALUE IF NOT EXISTS 'KURUMLARARASI_PAYLASIM';
ALTER TYPE "ConsentType" ADD VALUE IF NOT EXISTS 'OCEAN_PROFIL';
