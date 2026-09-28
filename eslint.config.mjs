import tseslint from 'typescript-eslint';

// ─── AJ-75: kurum-kapsamlı modellerde findUnique bekçisi ─────────────────────
// `src/db.ts` kurum filtresi (RLS eklentisi) findUnique/findUniqueOrThrow'u BİLİNÇLİ olarak
// filtrelemez (imza uyumsuzluğu). Bu yüzden kurum-kapsamlı bir modelde yeni bir findUnique
// sessizce kurum sınırını aşabilir (somut vaka: AJ-74). Kural bunu lint'te yakalar.
//
// Liste `src/db.ts` TENANT_SCOPED ile AYNI olmalı. .mjs config .ts dosyasını içe aktaramadığı
// için liste burada tutulur; eşitliği `tests/eslint-tenant-findunique.unit.test.ts` ölçer —
// db.ts'e model eklenip buraya eklenmezse test kırmızı olur.
export const TENANT_SCOPED_MODELS = [
  'User',
  'VisibilityOptIn',
  'MatchRequest',
  'FeedbackLog',
  'MatchCombinationScore',
  'Meeting',
  'Feedback',
  'JobListing',
  'Club',
  'ClubMembership',
  'PendingTag',
  'TenantMembership',
  'Match',
  'AvailabilityBlock',
];

// Prisma istemcisinde model erişimi küçük harfle başlar: `prisma.tenantMembership`.
const delegateNames = TENANT_SCOPED_MODELS.map((m) => m[0].toLowerCase() + m.slice(1));

// Muafiyet: `where` içinde adında tenantId geçen bileşik benzersiz anahtar
// (ör. `userId_tenantId`, `tenantId_value`) — sorgu zaten tek kuruma bağlı.
const TENANT_FIND_UNIQUE_SELECTOR =
  `CallExpression[callee.property.name=/^findUnique(OrThrow)?$/]` +
  `[callee.object.property.name=/^(${delegateNames.join('|')})$/]` +
  `:not(:has(Property[key.name='where'] > ObjectExpression > Property[key.name=/(^tenantId_|_tenantId(_|$))/]))`;

const TENANT_FIND_UNIQUE_MESSAGE =
  'Kurum-kapsamlı modelde findUnique/findUniqueOrThrow kurum filtresinin (src/db.ts) DIŞINDADIR ' +
  've başka kurumun kaydını döndürebilir. Ya findFirst + where: { tenantId, ... } kullanın ' +
  '(ya da tenantId içeren bileşik anahtar, ör. userId_tenantId), ya da neden güvenli olduğunu ' +
  'yazarak istisna koyun: // eslint-disable-next-line no-restricted-syntax -- <gerekçe>';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Codebase has intentional `as unknown as RequestHandler` casts throughout Express routes
      '@typescript-eslint/no-explicit-any': 'off',
      // Warn (not error) for unused vars; underscore prefix = intentional
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-undef': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: TENANT_FIND_UNIQUE_SELECTOR,
        message: TENANT_FIND_UNIQUE_MESSAGE,
      }],
    },
  },
);
