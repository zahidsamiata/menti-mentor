/**
 * Test verisi fabrikaları — tip güvenli, tekrar kullanılabilir.
 *
 * Her factory, testler arası izolasyon için benzersiz e-posta üretir.
 * Üretilen kayıtlar testPrisma aracılığıyla doğrudan DB'ye yazılır;
 * HTTP katmanı bypass edilir — birim testi hızı ile entegrasyon güvenilirliği birleşir.
 */

import bcrypt from 'bcryptjs';
import { testPrisma } from './db.js';
import type { Tenant, User } from '@prisma/client';

let counter = 0;
const uid = () => `${Date.now()}-${++counter}`;

// ─── Tenant ──────────────────────────────────────────────────────────────────

export interface TenantSeed {
  name?: string;
  isSharedPoolActive?: boolean;
}

export async function createTenant(overrides: TenantSeed = {}): Promise<Tenant> {
  const id = uid();
  return testPrisma.tenant.create({
    data: {
      name: overrides.name ?? `Test Tenant ${id}`,
      slug: `tenant-${id}`,
      displayName: overrides.name ?? `Test Tenant ${id}`,
      isSharedPoolActive: overrides.isSharedPoolActive ?? false,
      primaryColor: '#6366f1',
    },
  });
}

// ─── User ─────────────────────────────────────────────────────────────────────

export interface UserSeed {
  tenantId: string;
  role?: 'ADMIN' | 'MENTOR' | 'MENTI';
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  discType?: 'D' | 'I' | 'S' | 'C';
  sectorTags?: string[];
  password?: string;
}

const DEFAULT_PASSWORD = 'Test1234!';
let hashedDefaultPw: string | null = null;

async function getDefaultHash(): Promise<string> {
  if (!hashedDefaultPw) hashedDefaultPw = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  return hashedDefaultPw;
}

export async function createUser(seed: UserSeed): Promise<User & { rawPassword: string }> {
  const id = uid();
  const hash = seed.password
    ? await bcrypt.hash(seed.password, 10)
    : await getDefaultHash();

  const role = seed.role ?? 'MENTI';

  const user = await testPrisma.user.create({
    data: {
      tenantId: seed.tenantId,
      email: `user-${id}@test.local`,
      fullName: `Test User ${id}`,
      role,
      approvalStatus: seed.approvalStatus ?? 'APPROVED',
      authProvider: 'LOCAL',
      password: hash,
      discType: seed.discType ?? null,
      sectorTags: seed.sectorTags ?? [],
      isActive: true,
    },
  });

  // requireTenant middleware TenantMembership.isActive kontrolü yapar;
  // kayıt yoksa 403 döner — tüm test kullanıcıları için üyelik oluştur.
  await testPrisma.tenantMembership.create({
    data: {
      userId:   user.id,
      tenantId: seed.tenantId,
      role,
      isActive: true,
    },
  });

  return { ...user, rawPassword: seed.password ?? DEFAULT_PASSWORD };
}

/** Admin kullanıcısı oluştur + JWT token'ı döner (test isteklerinde Authorization header için). */
export async function createAdminUser(tenantId: string): Promise<User & { rawPassword: string }> {
  return createUser({ tenantId, role: 'ADMIN', approvalStatus: 'APPROVED' });
}

export async function createMentor(tenantId: string, overrides: Partial<UserSeed> = {}) {
  return createUser({
    tenantId,
    role: 'MENTOR',
    discType: 'C',
    sectorTags: ['teknoloji', 'finans'],
    ...overrides,
  });
}

export async function createMenti(tenantId: string, overrides: Partial<UserSeed> = {}) {
  return createUser({
    tenantId,
    role: 'MENTI',
    discType: 'D',
    sectorTags: ['teknoloji'],
    ...overrides,
  });
}
