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
| `src/services/iceBreaker.ts` | OpenAI call for 2-sentence intro + fallback |
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
3. **LLM trigger** — `iceBreaker.ts` is called only after a visibility opt-in is approved; it generates exactly 2 sentences and has an offline fallback.
4. **Scoring** — purely mathematical (no LLM): sector tag overlap (60%) + DISC matrix (40%).

### ES Modules

The project uses `"type": "module"` (ESM). All imports must use explicit `.js` extensions even for TypeScript source files (e.g., `import { foo } from './foo.js'`).
