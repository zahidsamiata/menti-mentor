/**
 * DISC görünürlük kuralı (KARAR 5) — tek gerçek kaynağı.
 *
 * Kural: bir MENTİ, önerilen/listelenen MENTÖRÜN DISC tipini (ve arketip kartını) GÖRMEZ —
 * yalnızca uyum skorunu görür. Mentör ise adayını (menti) değerlendirebilmek için menti'nin
 * DISC tipini görebilir. Bu yardımcı hem liste (listUsers) hem detay (getUser) yollarında
 * aynı kuralı uygular; ileride "havuz kartı" işi (KARAR 2/7) de buradan beslenir — kural
 * iki yere elle kopyalanmaz.
 *
 * Matris (bakan → hedef):
 *   - ADMIN  → her hedefin DISC tipini görür.
 *   - MENTOR → yalnızca MENTI hedefin DISC tipini görür (aday değerlendirmesi meşru).
 *   - MENTI  → hiç kimsenin DISC tipini göremez (mentörün tipi gizli — KARAR 5).
 *
 * Kendi kaydı bu yardımcının kapsamı DIŞINDADIR: self erişimi getUser'da USER_FULL_SELECT
 * ile ayrıca ele alınır (kullanıcı kendi DISC tipini her zaman görür).
 *
 * Not: bakan-rol kaynağı req.auth.role'dur (JWT) — bu, listUsers/getUser'ın halihazırda
 * güvendiği kimlik kaynağıyla aynıdır. Platform admin bu tenant-kapsamlı endpoint'lere
 * bu rolle gelmez; buradaki ADMIN = tenant admin.
 */
export function canViewerSeeDiscType(
  viewerRole: string | undefined,
  targetRole: string | null | undefined,
): boolean {
  if (viewerRole === 'ADMIN') return true;
  if (viewerRole === 'MENTOR' && targetRole === 'MENTI') return true;
  return false;
}
