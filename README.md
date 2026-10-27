# AICTE Approval Control Tower

[![SIH26262](https://img.shields.io/badge/SIH-26262-blue.svg)](https://sih.gov.in)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)]()
[![Stack](https://img.shields.io/badge/Stack-NestJS_Fastify_%7C_Next.js_14_%7C_FastAPI_%7C_Kysely-emerald.svg)]()

> **Automated AICTE Approval Workflow, Compliance Monitoring and Alert Management**
> Problem Statement SIH26262 • AICTE Regulation Bureau

---

## 🏛️ Mission & Core Philosophy

The **AICTE Approval Control Tower** is a production-grade platform built for the All India Council for Technical Education (AICTE). It orchestrates institutional approval dossiers through a rule-gated 15-state workflow, calculates dual SLA clocks (Institution vs AICTE), monitors compliance document expirations, escalates overdue work, and records every action in a tamper-evident, append-only, cryptographic audit ledger.

### 🔒 Non-Negotiable Rules
1. **Automation never approves or rejects.** Only authorized human officers make final regulatory decisions.
2. **AI output is strictly a suggestion:** Clearly labelled with confidence scores, explicitly overridable, and logged to the audit ledger upon acceptance or override.
3. **Atomic state transitions:** Every workflow change executes in a single database transaction updating application state, clock events, append-only audit rows, and notification queues.
4. **Append-only cryptographic audit ledger:** Enforced at the database engine level; `UPDATE` and `DELETE` queries are rejected by PostgreSQL triggers.
5. **Event-derived dual clocks:** Timers are derived from chronological event sequences, never mutable duration fields.

---

## 🏗️ Monorepo Architecture

```
.
├── apps/
│   ├── api/          # NestJS (Fastify adapter), strict TypeScript, Kysely, Zod, OpenAPI
│   ├── web/          # Next.js 14 (App Router), Tailwind CSS, shadcn/ui, TanStack Query, next-intl
│   └── worker/       # BullMQ worker service running queues for notifications, clock SLAs & OCR
├── services/
│   └── ai/           # Python 3.11 FastAPI microservice: OCR, BGE-M3 RAG, XGBoost delay-risk
├── packages/
│   └── shared/       # Shared TypeScript types, Zod schemas, enums, contracts
├── infra/
│   ├── docker-compose.yml  # PostgreSQL 16 (pgvector + pgcrypto), Redis 7, MinIO, Prometheus, Grafana
│   ├── migrations/         # Plain SQL database migrations (node-pg-migrate)
│   ├── nginx/              # Gateway reverse proxy
│   └── prometheus/         # Metrics configuration
└── docs/
    ├── ARCHITECTURE.md     # In-depth architectural blueprint
    ├── RUNBOOK.md          # Operations, development, and deployment runbook
    └── TASK_LIST.md        # Milestone task list aligned with problem parts
```

---

## ⚡ Quick Start

### 1. Prerequisites
- Node.js 20+
- pnpm 10+
- Python 3.11+
- Docker & Docker Compose

### 2. Environment Setup
```bash
cp .env.example .env
pnpm install
```

### 3. Start Infrastructure Datastores
```bash
pnpm docker:up
```

### 4. Run Migrations
```bash
pnpm migrate:up
```

### 5. Seed Realistic Demo Data
```bash
pnpm seed
```

### 6. Start Development Servers
```bash
# Start all services concurrently
pnpm dev

# Or start services individually:
pnpm dev:api    # NestJS API on http://localhost:4000
pnpm dev:web    # Next.js Web on http://localhost:3000
pnpm dev:worker # BullMQ Worker
pnpm dev:ai     # FastAPI AI on http://localhost:8000
```

---

## 📖 Detailed Documentation

- [System Architecture Blueprint](docs/ARCHITECTURE.md)
- [Operations & Troubleshooting Runbook](docs/RUNBOOK.md)
- [Comprehensive Implementation Roadmap](docs/TASK_LIST.md)
