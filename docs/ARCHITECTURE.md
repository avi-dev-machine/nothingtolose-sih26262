# AICTE Approval Control Tower (SIH26262) — System Architecture

## 1. System Overview

The **AICTE Approval Control Tower** is a high-reliability, government-grade platform designed for the AICTE Regulation Bureau to automate technical education approval workflows, enforce compliance monitoring, and manage deadline escalations with full transparency.

```
+--------------------------------------------------------------------------------------------------+
|                                    Nginx Reverse Proxy (:80)                                     |
+--------------------------------------------------------------------------------------------------+
               |                                      |                                  |
               v                                      v                                  v
+-----------------------------+        +-----------------------------+        +--------------------+
|  apps/web (Next.js 14 App)  |        |  apps/api (NestJS Fastify)  |        | services/ai (FastAPI)|
|  - React 18 / Tailwind      |        |  - Kysely Typed SQL         |        | - OCR / NER        |
|  - TanStack Query           |        |  - Zod Validation           |        | - BGE-M3 RAG       |
|  - Recharts / Lucide        |        |  - OpenAPI Swagger          |        | - XGBoost Delay    |
|  - next-intl (en / hi)      |        |  - Argon2id / JWT / TOTP    |        | - Claude / Ollama  |
+-----------------------------+        +-----------------------------+        +--------------------+
                                                      |
                                    +-----------------+-----------------+
                                    |                                   |
                                    v                                   v
                      +---------------------------+       +---------------------------+
                      |   apps/worker (BullMQ)    |       |   PostgreSQL 16 DB        |
                      |   - Notifications Queue   |       |   - pgvector & pgcrypto   |
                      |   - Clock & SLA Escalation|       |   - Hash-Chained Audit    |
                      |   - Compliance Radar Cron |       |   - Append-Only Triggers  |
                      |   - Document OCR Queue    |       +---------------------------+
                      +---------------------------+                     |
                                    |                                   v
                                    v                     +---------------------------+
                      +---------------------------+       |      MinIO S3 Storage     |
                      |          Redis 7          |       |   - Encrypted Documents   |
                      |   - BullMQ Queue Broker   |       |   - Inspection Photos     |
                      +---------------------------+       +---------------------------+
```

---

## 2. Non-Negotiable Core Rules

1. **Human Authority Only**: Automation never issues final approvals or rejections. State transitions to `APPROVED`, `APPROVED_WITH_CONDITIONS`, `REJECTED`, or `COMPLIANCE_REQUIRED` require verified human officer credentials with TOTP.
2. **AI as an Audit-Logged Suggestion**: Every AI model output (document classification, date extraction, clause recommendation, delay risk) is returned inside a standard wrapper containing model name, version, confidence score, overridable flag, and override audit reason.
3. **Atomic State Transactions**: Any application state change occurs inside a single ACID database transaction that simultaneously:
   - Updates `applications.state` and timestamp
   - Inserts the next event in `clock_events`
   - Appends a cryptographically verified block in `audit_ledger`
   - Enqueues background notification jobs in Redis
4. **Append-Only Hash-Chained Audit Ledger**: The `audit_ledger` table employs a PostgreSQL row-level trigger that unconditionally aborts any `UPDATE` or `DELETE` statement. Each row includes `previous_hash` and `current_hash` computed over all payload fields using SHA-256.
5. **Event-Derived Dual Clocks**: Durations are never stored in mutable columns. Institution clock and AICTE clock are computed at query time by integrating time intervals across ordered `clock_events` records.

---

## 3. Workflow State Machine & Tracks

### 15 States
```
DRAFT -> SUBMITTED -> UNDER_SCRUTINY <-> DEFICIENCY_RAISED -> RESUBMITTED -> UNDER_SCRUTINY
-> SCRUTINY_CLEARED -> EVC_REQUIRED -> EVC_SCHEDULED -> EVC_IN_PROGRESS -> EVC_COMPLETED
-> COMMITTEE_REVIEW -> FINAL_DECISION -> APPROVED | APPROVED_WITH_CONDITIONS | REJECTED | COMPLIANCE_REQUIRED
```

### 4 Tracks
- **Track A (Only Scrutiny)**: Extension of Approval (EoA) and non-infrastructure adjustments. Bypasses EVC directly to clearance.
- **Track B (Scrutiny + EVC)**: New courses, major intake expansion, shift of campus.
- **Track C (EVC + SAC/SHC)**: New technical institution establishment, university conversion, disputed cases requiring Standing Hearing Committee.
- **Track D (Only EVC)**: Surprise verification inspections, complaint investigation visits.

---

## 4. Dual-Clock Engine Architecture

Every dossier has two distinct timers:
- **Institution Clock**: Accumulates time while the dossier is in `DEFICIENCY_RAISED` awaiting institution response.
- **AICTE Clock**: Accumulates time while the dossier is in `UNDER_SCRUTINY`, `EVC_IN_PROGRESS`, or `COMMITTEE_REVIEW`.

```
Application Submitted
        │
        ▼ (AICTE Clock Starts)
[UNDER_SCRUTINY]
        │
        ├─────────────────────────────┐
        │ Scrutiny Officer Raises      │ Scrutiny Officer
        │ Deficiency                  │ Clears
        ▼                             ▼
[DEFICIENCY_RAISED]           [SCRUTINY_CLEARED]
(AICTE Clock Paused)                  │
(Institution Clock Runs)              ▼
        │                      [EVC / Committee]
        ▼ Institution Responds
[RESUBMITTED]
(Institution Clock Paused)
(AICTE Clock Resumes)
```

---

## 5. Security & Cryptographic Ledger

### Cryptographic Hash-Chain Formula
For sequence $N$:
$$\text{CurrentHash}_N = \text{SHA256}(\text{PreviousHash}_{N-1} \parallel \text{Seq}_N \parallel \text{Timestamp}_N \parallel \text{ActorId}_N \parallel \text{Action}_N \parallel \text{PayloadJson}_N)$$
The genesis block ($N=1$) anchors on 64 zero characters (`0000000000000000000000000000000000000000000000000000000000000000`).

### Authentication & RBAC
- Access Token: Short-lived JWT (15 minutes).
- Refresh Token: Long-lived rotating token (7 days) stored in secure `HttpOnly`, `SameSite=Strict` cookie.
- Passwords hashed using `Argon2id` (memory cost 64MB, 3 iterations).
- Two-Factor Authentication (`TOTP` via Google/Microsoft Authenticator) enforced for all administrative and officer roles.

---

## 6. AI Microservice Architecture

- **Document Analysis**: Optical Character Recognition (`pytesseract` / `PaddleOCR`) + rule-based NER for date and authority parsing.
- **APH RAG Engine**: Vector database embeddings (`BAAI/bge-m3`) with cosine similarity retrieval across 80+ Approval Process Handbook clauses.
- **Predictive Delay Model**: Gradient boosted decision tree (`XGBoost`) combined with survival analysis (`lifelines`) to calculate risk scores and expected completion dates.
