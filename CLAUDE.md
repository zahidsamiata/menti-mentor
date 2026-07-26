# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Menti-Mentor** — a multi-tenant SaaS backend for mentor-mentee matching. Written in TypeScript (Node.js, Express 5), backed by PostgreSQL via Prisma. The LLM (OpenAI) is used only for ice-breaker generation, not for ranking.

## Commands

```bash
npm run dev                # Start dev server with tsx watch
npm run build              # Compile TypeScript → dist/
npm start                  # Run compiled output (production)
npm run lint               # ESLint
npm run format             # Prettier

npm run prisma:generate    # Regenerate Prisma client after schema changes
npm run prisma:migrate     # Apply pending migrations
npm run prisma:studio      # Open Prisma Studio GUI
```

Environment setup: copy `.env.example` → `.env` and fill in `DATABASE_URL`, `OPENAI_API_KEY`, and `DEFAULT_TENANT_ID`.

## Architecture

### Request Flow

```
HTTP → tenant middleware (X-Tenant-Id header required) → controller → service → Prisma
```

Every request must carry `X-Tenant-Id`. The `tenant.ts` middleware validates it and attaches a `TenantContext` to `req`. All database queries are scoped to that tenantId.

### Core Modules

| Path | Responsibility |
|------|---------------|
| `src/server.ts` | Express app + route registration |
| `src/config.ts` | Environment variable validation/export |
| `src/db.ts` | Prisma client singleton |
| `src/middleware/tenant.ts` | X-Tenant-Id extraction and validation |
| `src/services/scoring.ts` | Sector (60%) + DISC (40%) score computation |
| `src/services/matching.ts` | `rankMentisForMentor` — sorts candidates by score |
| `src/services/tenantSharing.ts` | Cross-tenant pool logic (`isSharedPoolActive` flag) |
| `src/services/iceBreaker.ts` | OpenAI call (decommissioned — no longer wired to any controller) |
| `src/controllers/` | HTTP handlers for tenants, users, matching, requests |

### Data Model (Prisma)

Five models: `Tenant`, `User`, `VisibilityOptIn`, `MatchRequest`, `JobListing`.

- All tenant-scoped tables carry a `tenantId` foreign key.
- `UserRole`: `ADMIN | MENTOR | MENTI`
- `DiscType` drives the 40% personality compatibility score via a hardcoded matrix in `scoring.ts`.
- `MatchTargetType`: `USER | JOB_LISTING` — match requests are polymorphic to support a future job board.

### Key Business Rules

1. **Tenant isolation** — tenants share the candidate pool only when both have `isSharedPoolActive = true`.
2. **Opt-in gate** — a mentor must approve a menti's `VisibilityOptIn` before profile details are revealed.
3. **LLM removed** — `iceBreaker.ts` is decommissioned. Mentis write their own `requestMessage` on `VisibilityOptIn` (Akış B) and on `MatchRequest`. No OpenAI dependency at runtime.
4. **Scoring** — purely mathematical (no LLM): sector tag overlap (60%) + DISC matrix (40%).

### ES Modules

The project uses `"type": "module"` (ESM). All imports must use explicit `.js` extensions even for TypeScript source files (e.g., `import { foo } from './foo.js'`).

---

## Analytics & Compliance Standards

### PII vs Analytical Data Segregation

All data in this system is classified into two categories. Code must never mix them:

| Category | Fields | Rules |
|---|---|---|
| **PII (Personal Identifiable Information)** | `fullName`, `email`, `bioSummary`, `expertiseDetails`, `targetAudience`, `volunteerHistory`, `pastProjects`, `education`, `selfProfile`, `discVector`, `discType`, `temperamentJson`, `iceBreaker`, `requestMessage`, `UserProfile.schools`, `UserProfile.companies`, `UserProfile.communities`, `UserProfile.discD/I/S/C`, `UserProfile.oceanO..N`, `UserProfile.archetype` | Never expose in aggregate analytics. Covered by KVKK Art.7 / GDPR Art.17. Subject to anonymization and hard-delete. `schools/companies/communities` re-identify a person (school+company); keep out of KPI/aggregate/export. |
| **Analytical (Non-PII)** | `sectorTags`, `role`, `tenantId`, `createdAt`, `npsScore`, `starRating`, `isActive`, `rematchCount`, `expectationCategories`, `timeCommitment`, `UserProfile.skillTags`, `UserProfile.goalTags`, `UserProfile.industryCode`, `UserProfile.yearsExp` | Safe for aggregate reporting. May appear in KPI dashboards. Must NOT be linked to specific user identity in any exported report. |

### Compliance Rules for Claude Code

1. **Never add a new field** to any user-facing select/export without classifying it as PII or Analytical first.
2. **Analytics endpoints** (`/api/analytics/*`, `/api/admin/kpi`) must return only aggregate counts, averages, and distributions — never row-level PII.
3. **gdprService.ts** is the single source of truth for KVKK/GDPR operations. All anonymization/deletion logic must go through it, never inline.
4. **LLM calls** (`iceBreaker.ts`, `matchReason.ts`) must never receive raw email addresses, full names beyond what is needed for the prompt, or any field not explicitly listed in the service's argument type.
5. **Logs** (`logger.ts`, `requestLogger.ts`) must not contain PII. Log `userId` and `tenantId` only — never `email`, `fullName`, or `discVector`.
6. **Rate limiting**: `llmRateLimiter` middleware exists but is no longer applied (LLM removed). Keep it for future integrations but do not add it to any route.
7. **sectorTags** input must always be sanitized: trim, lowercase, max 50 chars per tag, alphanumeric + limited special chars only. The same applies to `UserProfile` tag fields (`skillTags`, `goalTags`, `schools`, `companies`, `communities`) — sanitized via `sanitizeTags()` in `onboardingController.ts` (trim, lowercase, whitelist regex, length cap, dedupe) before persistence.

### Data Retention Policy (KVKK Art.7)

| Table | Retention | Enforcement |
|---|---|---|
| `SystemLog` | 90 days | `purgeExpiredData()` cron — weekly |
| `FeedbackLog` | 3 years | Manual admin review |
| `UserResponse` | Until user anonymized/deleted | `anonymizeUser()` / `hardDeleteUser()` |
| `VisibilityOptIn` | Until hard-delete | Cascades with user |

### Security Invariants

- **Tenant isolation**: Every DB query on tenant-scoped tables MUST include `tenantId` in the `where` clause.
- **Self-match**: No user may opt-in to themselves. Enforced at controller level (not just DB).
- **Cross-tenant**: Only allowed when both tenants have `isSharedPoolActive = true`. Checked via `canCrossTenantMatch()`.
- **JWT**: Tokens are scoped to a single tenant. Cross-tenant tokens are logged as WARN and rejected.
- **sectorTags poison prevention**: Tags validated by `SECTOR_TAG_SCHEMA` in `userController.ts` before persistence.
