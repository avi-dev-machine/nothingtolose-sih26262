# SECTION 0 — SHARED CONTEXT (paste with every part)

## Mission
Build **AICTE Approval Control Tower**: a production-ready platform that automates AICTE approval workflow, compliance monitoring and alert management (SIH26262, AICTE Regulation Bureau).

Institutions submit applications. Officers scrutinise. EVC members inspect. Committees decide. The system routes files through a rule-gated state machine, tracks **two clocks** (institution vs AICTE), watches compliance document expiry, sends reminders, escalates overdue work, and records everything in a tamper-evident audit ledger. AI assists officers with suggestions only.

## Non-negotiable rules
1. **Automation never approves or rejects.** Only authorised humans make final decisions.
2. **AI output is a suggestion**: labelled, with confidence, overridable, audit-logged.
3. **Every state change happens in one DB transaction** that also updates clocks, writes the audit row and enqueues notifications.
4. **Audit log is append-only and hash-chained.** No UPDATE or DELETE possible.
5. **Clocks are derived from inserted events**, never from an editable duration field.
6. **Workflow tracks, SLAs, escalation levels and document types are configuration**, not hard-coded.
7. **No placeholder code, no TODOs, no mocked core logic.** External integrations (SMS, DSC, DigiLocker) may be adapter interfaces with a working stub, clearly labelled.
8. Production quality: typed, validated, tested, documented, containerised, observable, secure.

## Fixed stack (do not substitute)
| Layer | Choice |
|---|---|
| Monorepo | `pnpm` workspaces: `apps/web`, `apps/api`, `apps/worker`, `services/ai`, `packages/shared`, `infra/` |
| DB | PostgreSQL 16 + `pgvector` + `pgcrypto`, migrations by **node-pg-migrate** (plain SQL) |
| API | **NestJS (TypeScript, strict)**, Fastify adapter, Zod validation (via `nestjs-zod`), OpenAPI generated |
| Data access | **Kysely** (typed SQL) with generated types from the schema |
| Queue / scheduler | Redis 7 + **BullMQ** (worker app separate from API) |
| Storage | S3-compatible (MinIO in dev) via AWS SDK v3 |
| Auth | JWT access (15 min) + rotating refresh (HttpOnly cookie), Argon2id, TOTP for officer/admin roles |
| AI service | **FastAPI (Python 3.11)**: PaddleOCR/Tesseract, spaCy, dateparser, sentence-transformers (`bge-m3`), scikit-learn, XGBoost, lifelines; LLM via provider interface (Claude API default, Ollama optional) |
| Frontend | **Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + TanStack Query + React Hook Form + Zod + Recharts + next-intl (en/hi)** |
| Realtime | Server-Sent Events from API |
| Tests | Vitest/Jest, Supertest, Pytest, Playwright, k6 |
| DevOps | Docker Compose (dev + prod profiles), Nginx, GitHub Actions, Sentry, Prometheus + Grafana, pino JSON logs |
| Shared contract | `packages/shared`: Zod schemas, enums, types, generated OpenAPI client used by both API and web |

## Roles
`INSTITUTION`, `SCRUTINY_OFFICER`, `REGIONAL_OFFICER`, `EVC_MEMBER`, `COMMITTEE_MEMBER`, `BUREAU_OFFICER`, `ADMIN`.

## Workflow states
```
DRAFT → SUBMITTED → UNDER_SCRUTINY ⇄ DEFICIENCY_RAISED → RESUBMITTED → UNDER_SCRUTINY
→ SCRUTINY_CLEARED → EVC_REQUIRED → EVC_SCHEDULED → EVC_IN_PROGRESS → EVC_COMPLETED
→ COMMITTEE_REVIEW → FINAL_DECISION → APPROVED | APPROVED_WITH_CONDITIONS | REJECTED | COMPLIANCE_REQUIRED
```
Tracks (config): **A** Only Scrutiny · **B** Scrutiny + EVC · **C** EVC + SAC/SHC · **D** Only EVC.

## Feature tiers (all must ship)
- **MVP:** RBAC login/dashboards, application form + upload, validation, state machine, deficiency/resubmission loop, dual clocks, reminders, basic escalation, audit log, pendency dashboard.
- **Must-have:** secure storage, fine-grained RBAC, task assignment, EVC scheduling, compliance registry + expiry alerts, workload dashboard, search/filters, exports, admin console, notification templates/preferences.
- **Best:** APH rule engine, clause-linked deficiencies, digital EVC inspection form, document versioning, SLA designer, daily digest, regional analytics, conditional approvals, bulk actions.
- **Star:** Dual-clock engine, rule-gated state machine, compliance expiry radar, smart deficiency loop, escalation matrix, hash-chained audit ledger, AI document assistant (OCR → classify → expiry extract → missing/duplicate), RAG APH assistant with citations, real-time control tower, delay-risk predictor.

## Working method for the agent
1. Read this whole prompt, then create a task list per Part.
2. Build in the order given, committing after each milestone with a clear message.
3. After each milestone run lint, typecheck, tests. Fix before moving on.
4. Seed realistic demo data (Section 0.1).
5. At the end, produce `README.md`, `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, and a final report of what was built, what was verified, and any known gaps. **Do not claim a check passed unless you ran it.**

### 0.1 Seed data (required)
- 4 regions, 40 institutions, ~60 users covering every role (default passwords from env, forced change on first login).
- 600 applications spread across all states and tracks with plausible timelines, deficiencies, EVC visits, clock events (so dashboards are meaningful).
- 150 compliance items with expiries spread from −30 to +400 days.
- 120 synthetic documents (lease deeds, Fire NOCs, undertakings, land records) as generated PDFs/scans with noise, labelled for AI evaluation.
- APH clause set (≥ 80 clauses, synthetic text structured like a handbook, clearly marked as sample content) for RAG and clause linking.
- One command: `pnpm seed`.
