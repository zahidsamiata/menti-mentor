/**
 * AJ-75 — kurum-kapsamlı modellerde findUnique lint bekçisi.
 *
 * `src/db.ts` kurum filtresi findUnique/findUniqueOrThrow'u bilinçli olarak filtrelemez;
 * `eslint.config.mjs` içindeki `no-restricted-syntax` kuralı kurum-kapsamlı modelde gerekçesiz
 * findUnique'i hata sayar. Bu test (1) kuralın gerçekten yakaladığını / muafiyetleri, (2) config
 * listesinin `db.ts` TENANT_SCOPED ile eşit kaldığını ölçer.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import { TENANT_SCOPED } from '../src/db.js';

const BACKEND_ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(BACKEND_ROOT, 'eslint.config.mjs');
// Kural yalnız src/**/*.ts için açık; sanal dosya yolu bu kapsamda olmalı (diskte bulunması gerekmez).
const VIRTUAL_SRC_FILE = path.join(BACKEND_ROOT, 'src', '__aj75_lint_fixture__.ts');
const RULE_ID = 'no-restricted-syntax';

const eslint = new ESLint({ cwd: BACKEND_ROOT, overrideConfigFile: CONFIG_FILE });

async function ruleHits(code: string, filePath = VIRTUAL_SRC_FILE): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.filter((m) => m.ruleId === RULE_ID).length;
}

describe('AJ-75 findUnique lint kuralı', () => {
  it('kurum-kapsamlı modelde düz findUnique({ where: { id } }) → hata', async () => {
    const code = `declare const prisma: any;\nexport const f = (id: string) => prisma.user.findUnique({ where: { id } });\n`;
    expect(await ruleHits(code)).toBe(1);
  });

  it('kurum-kapsamlı modelde findUniqueOrThrow ve tx istemcisi de yakalanır', async () => {
    const code = `declare const tx: any;\nexport const f = (id: string) => tx.meeting.findUniqueOrThrow({ where: { id } });\n`;
    expect(await ruleHits(code)).toBe(1);
  });

  it('hata mesajı Türkçe ve yol gösterici (findFirst + tenantId ya da gerekçeli istisna)', async () => {
    const code = `declare const prisma: any;\nexport const f = (id: string) => prisma.user.findUnique({ where: { id } });\n`;
    const [result] = await eslint.lintText(code, { filePath: VIRTUAL_SRC_FILE });
    const msg = result!.messages.find((m) => m.ruleId === RULE_ID)!.message;
    expect(msg).toContain('findFirst');
    expect(msg).toContain('tenantId');
    expect(msg).toContain('eslint-disable-next-line no-restricted-syntax --');
  });

  it('tenantId içeren bileşik anahtar (userId_tenantId) → temiz', async () => {
    const code = `declare const prisma: any;\nexport const f = (userId: string, tenantId: string) =>\n  prisma.tenantMembership.findUnique({ where: { userId_tenantId: { userId, tenantId } } });\n`;
    expect(await ruleHits(code)).toBe(0);
  });

  it('bileşik anahtarlı muafiyet yalnız where içinde geçerli (select içinde aynı ad muaf tutmaz)', async () => {
    const code = `declare const prisma: any;\nexport const f = (id: string) =>\n  prisma.tenantMembership.findUnique({ where: { id }, select: { userId_tenantId: true } });\n`;
    expect(await ruleHits(code)).toBe(1);
  });

  it('kurum-kapsamlı OLMAYAN model (tenant) → temiz', async () => {
    const code = `declare const prisma: any;\nexport const f = (id: string) => prisma.tenant.findUnique({ where: { id } });\n`;
    expect(await ruleHits(code)).toBe(0);
  });

  it('gerekçeli disable yorumu → temiz', async () => {
    const code = `declare const prisma: any;\nexport const f = (id: string) =>\n  // eslint-disable-next-line no-restricted-syntax -- kişinin kendi kaydı, kimlik oturumdan\n  prisma.user.findUnique({ where: { id } });\n`;
    expect(await ruleHits(code)).toBe(0);
  });

  it('kural yalnız src/ için açık (tests/ altında aynı kod temiz)', async () => {
    const code = `declare const prisma: any;\nexport const f = (id: string) => prisma.user.findUnique({ where: { id } });\n`;
    expect(await ruleHits(code, path.join(BACKEND_ROOT, 'tests', '__aj75_lint_fixture__.ts'))).toBe(0);
  });

  it('config listesi (eslint.config.mjs TENANT_SCOPED_MODELS) db.ts TENANT_SCOPED ile birebir eşit', async () => {
    const configModule = (await import(pathToFileURL(CONFIG_FILE).href)) as { TENANT_SCOPED_MODELS: string[] };
    const fromConfig = [...configModule.TENANT_SCOPED_MODELS].sort();
    const fromDb = [...TENANT_SCOPED].sort();
    expect(fromConfig).toEqual(fromDb);
    expect(new Set(fromConfig).size).toBe(fromConfig.length);
  });
});
