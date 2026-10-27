# AICTE Approval Control Tower (SIH26262) — Task List & Implementation Roadmap

> Aligned with the mandate of AICTE Regulation Bureau & Problem SIH26262.
> Rule: Automation never approves or rejects. Only authorised humans make final decisions.

---

## Part 0: Monorepo Foundation & Infrastructure Setup (CURRENT MILESTONE)
- [x] Git repository initialization and `.gitignore` setup
- [x] `pnpm` monorepo configuration (`pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`)
- [x] Setup `packages/shared`:
  - [x] Core Enums: Roles, 15 Workflow States, 4 Tracks (A, B, C, D), Clock Owners, Compliance Categories, Audit Actions
  - [x] Zod Schemas: Auth, Applications, Scrutiny, Deficiencies, EVC Inspections, Committee Decisions, Compliance Radar, Audit Ledger, AI Suggestions
  - [x] Shared TypeScript types and API interfaces
- [x] Setup `infra/`:
  - [x] `docker-compose.yml` (PostgreSQL 16 + pgvector + pgcrypto, Redis 7, MinIO S3, Prometheus, Grafana, Nginx)
  - [x] Database migration framework (`node-pg-migrate` / plain SQL: `001_initial_schema.sql` with append-only audit trigger)
  - [x] Nginx reverse proxy configuration (`nginx.conf`)
  - [x] Prometheus scrape targets configuration (`prometheus.yml`)
- [x] Setup `apps/api`:
  - [x] NestJS with Fastify adapter, strict TypeScript
  - [x] Kysely typed SQL database integration
  - [x] OpenAPI Swagger documentation setup
  - [x] Zod validation pipeline (`nestjs-zod`)
  - [x] Health check endpoint (`/api/v1/health`)
- [x] Setup `apps/worker`:
  - [x] BullMQ worker service separate from API
  - [x] 4 queue consumers: notifications, clock-escalation, compliance-radar, document-processing
- [x] Setup `services/ai`:
  - [x] Python 3.11 FastAPI microservice skeleton
  - [x] LLM provider abstraction (Claude API default, Ollama optional, mock fallbacks)
  - [x] OCR, APH RAG query, and XGBoost/Lifelines delay-risk prediction endpoints
  - [x] Dockerfile and dependencies
- [x] Setup `apps/web`:
  - [x] Next.js 14 App Router + TypeScript + Tailwind CSS
  - [x] shadcn/ui components (`Button`, `Card`, `Badge`, `Input`)
  - [x] TanStack Query provider
  - [x] `next-intl` bilingual localization (English / हिन्दी)
  - [x] Government Control Tower Command Center homepage
- [x] Setup Documentation:
  - [x] `docs/TASK_LIST.md`
  - [x] `docs/ARCHITECTURE.md`
  - [x] `docs/RUNBOOK.md`
  - [x] `README.md`

---

## Part 1: Database Architecture & Integrity (COMPLETED)
- [x] Ordered and reversible plain SQL migrations (`infra/db/migrations/001_...` through `012_...`)
  - [x] Extensions: `uuid-ossp`, `pgcrypto`, `citext`, `pg_trgm`, `btree_gist`, `vector`
  - [x] Enums for roles, states, tracks, clocks, document statuses, deficiency statuses, task statuses, compliance
  - [x] Tenancy CHECK constraints on users (`INSTITUTION` requires institution_id; officers require region_id)
  - [x] Immutability trigger on `documents` (only status and verified_by mutable)
  - [x] Partial UNIQUE index on `clock_events` (`(application_id, clock)` WHERE `stopped_at IS NULL`)
  - [x] Exclusion constraint on `clock_events` (`ex_no_simultaneous_open_clocks` using `btree_gist`)
  - [x] Idempotency constraints on `compliance_alerts(item_id, threshold_days)` and `notifications(dedupe_key)`
  - [x] Append-only audit trigger on `audit_log` prohibiting `UPDATE`, `DELETE`, `TRUNCATE`
  - [x] SHA-256 hash chaining trigger with `pg_advisory_xact_lock` for unbroken concurrency
  - [x] Audit chain verification function `fn_verify_audit_chain(from_seq, to_seq)`
  - [x] State machine guard trigger `trg_applications_state_guard` and optimistic locking `version`
  - [x] Separation of duties checks (deficiency raiser cannot clear scrutiny; decider cannot be scrutiny officer)
  - [x] Row-Level Security (RLS) policies on core tables with dedicated `aicte_app` role
  - [x] Functions, views (`fn_business_seconds`, `v_clock_elapsed`, `v_application_timeline`)
  - [x] 6 Materialized views with unique indexes for concurrent refresh
  - [x] Comprehensive indexing (every FK, composite hot queries, partial worklists, GIN trigram)
- [x] Realistic seed generator (`infra/db/seeds/seed_generator.ts` and `pnpm seed`)
  - [x] 4 regions, 40 institutions, 60 users covering all 7 roles
  - [x] 85 APH clauses with 1024-dim vector embeddings
  - [x] 600 applications distributed across all 15 states and 4 tracks
  - [x] 150 compliance items (−30 to +400 days spectrum)
  - [x] 120 synthetic documents with SHA-256
  - [x] Cryptographic hash-chained audit ledger initialization
  - [x] Concurrent refresh of all materialized views
- [x] Generated Kysely typed schema package (`packages/db-types` and `pnpm db:types`)
- [x] Data model documentation (`docs/DATA_MODEL.md` with Mermaid ER diagram, rules, EXPLAIN ANALYZE, and DPDP retention policy)
- [x] Database test suite (`infra/db/tests/` and `pnpm test:db` including 200 concurrent audit inserts test)
- [x] Backup & restore scripts (`infra/db/backup.sh`, `infra/db/restore_test.sh`)

---

## Part 2: Rule-Gated State Machine & Dual-Clock Engine
- [ ] Single DB transaction state transition engine:
  - Updates application state
  - Inserts clock event
  - Appends to hash-chained audit ledger
  - Enqueues notification job in BullMQ
- [ ] Dual-Clock Engine:
  - Institution clock vs AICTE clock derived purely from inserted clock events
  - Active clock toggle on deficiency raise / response
  - SLA calculation (Within SLA, Near Breach, Breached, Escalated)
- [ ] Track routing engine:
  - Track A: Only Scrutiny
  - Track B: Scrutiny + EVC
  - Track C: EVC + SAC/SHC
  - Track D: Only EVC

---

## Part 3: Append-Only Hash-Chained Audit Ledger
- [ ] Cryptographic hash chaining: `SHA-256(prev_hash + sequence + timestamp + actor + action + payload)`
- [ ] Genesis block initialization
- [ ] PostgreSQL trigger enforcing append-only (rejecting UPDATE/DELETE)
- [ ] Audit verification endpoint (re-computing full chain to verify integrity)
- [ ] Officer/Admin audit ledger explorer UI with verification badge

---

## Part 4: Document Storage & Compliance Expiry Radar
- [ ] MinIO / S3 document upload with presigned URLs and SHA-256 checksum verification
- [ ] Compliance registry:
  - Mandatory certificates (Fire NOC, Building Stability, Land Use, Affiliation)
  - Expiry date tracking and status calculation (`VALID`, `EXPIRING_SOON`, `EXPIRED`, `UNDER_RENEWAL`)
- [ ] Real-time Compliance Expiry Radar UI with −30 to +400 days status indicators
- [ ] BullMQ scheduled cron scanner generating automated reminders and warnings

---

## Part 5: Deficiency & Resubmission Loop
- [ ] Clause-linked deficiency creation by Scrutiny Officers
- [ ] Institution deficiency response portal with document attachment
- [ ] Scrutiny review of deficiency responses (Accept / Reject)
- [ ] Automatic clock resumption upon institution response

---

## Part 6: Digital EVC Inspection & Committee Review
- [ ] EVC Committee formation and visit scheduling
- [ ] Digital EVC inspection checklist form with geo-coordinates and accuracy validation
- [ ] Photo upload with EXIF / geo-validation
- [ ] Standing Hearing Committee (SAC/SHC) docket and decision recording
- [ ] Conditional approval tracker

---

## Part 7: AI Assistance (Suggestions with Human In The Loop)
- [ ] Document OCR & Classification pipeline (PaddleOCR / Tesseract)
- [ ] Certificate expiry date extraction via dateparser & regex
- [ ] APH Handbook Clause RAG assistant using vector embeddings (`bge-m3`) with citations
- [ ] Delay-Risk Predictor using XGBoost / survival analysis
- [ ] AI suggestion banner in officer UI: clearly labelled, confidence score, explicit human override option, audit-logged

---

## Part 8: Real-Time Control Tower & Regional Dashboards
- [ ] Server-Sent Events (SSE) stream for live application status updates
- [ ] National & Regional Pendency Dashboard with Recharts
- [ ] Workload & SLA breach heatmaps
- [ ] Search, multi-facet filtering, and CSV/PDF export

---

## Part 9: Realistic Demonstration Dataset (pnpm seed)
- [ ] 4 regions (Northern, Western, Southern, Eastern)
- [ ] 40 accredited technical institutions
- [ ] 60 users covering all 7 roles with default credentials
- [ ] 600 applications distributed across all 15 states and 4 tracks
- [ ] 150 compliance items with expiries (−30 to +400 days)
- [ ] 120 synthetic PDF documents with noise and labels
- [ ] ≥ 80 APH clauses structured like the official handbook for RAG
- [ ] Single executable command: `pnpm seed`
