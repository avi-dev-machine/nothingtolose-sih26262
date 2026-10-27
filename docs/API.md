# AICTE Control Tower — API Reference

## 1. Overview
The AICTE Control Tower API (`apps/api`) provides the transactional backend for institutions, scrutiny officers, EVC inspectors, committee members, and AICTE administrators.

- **Base Path**: `/api/v1`
- **Protocol**: HTTP/1.1 (JSON) via Fastify + NestJS
- **Authentication**: JWT Bearer Access Token (15-minute expiry) + HTTP-only Rotating Refresh Token Cookie
- **Interactive Documentation**: Available at `/api/docs` (Swagger UI), exported to `packages/shared/openapi.json`

---

## 2. Global Conventions

### 2.1 Standard Error Shape
All error responses across all modules strictly conform to:
```json
{
  "code": "BAD_REQUEST",
  "message": "Human-readable error description",
  "details": [ ... ],
  "requestId": "req-8f5c3a21-998b-4bfe-9831-41e976839fa2",
  "timestamp": "2026-10-27T16:45:00.000Z"
}
```

### 2.2 Standard Success Response Shape
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional descriptive status message",
  "timestamp": "2026-10-27T16:45:00.000Z"
}
```

### 2.3 Optimistic Locking
Mutating operations on applications support optimistic concurrency control via:
- Request Header: `If-Match: "3"`
- Request Body Field: `expectedVersion: 3`

If the database version has changed concurrently, the API immediately halts execution, rolls back the transaction, and returns:
`409 Conflict: Application version conflict (expected 3, found 4)`.

### 2.4 Idempotency
Mutating endpoints (`POST /applications`, `POST /applications/:id/transition`, `POST /documents/complete`) support the `Idempotency-Key` header:
```http
Idempotency-Key: idemp-9a8b7c6d-5e4f
```
If an identical request is replayed within 24 hours, the cached response is returned with the header `Idempotent-Replayed: true`.

---

## 3. Endpoints Directory

### 3.1 Authentication (`/api/v1/auth`)
| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/login` | Public | Authenticate email, password, and mandatory TOTP for officers |
| `POST` | `/refresh` | Public | Refresh token rotation with token family reuse detection |
| `POST` | `/logout` | Authenticated | Revoke refresh token and clear cookie |
| `GET` | `/me` | Authenticated | Return currently authenticated actor profile |
| `POST` | `/change-password` | Authenticated | Change user password; revokes all existing sessions |
| `POST` | `/forgot-password` | Public | Dispatches password reset link via outbox email |
| `POST` | `/reset-password` | Public | Resets password using cryptographically verified token |
| `GET` | `/sessions` | Authenticated | Lists active login sessions (IP, user agent, timestamps) |
| `DELETE` | `/sessions/:id` | Authenticated | Revoke a specific active session |
| `DELETE` | `/sessions` | Authenticated | Revoke all other active sessions |
| `POST` | `/totp/setup` | Authenticated | Generates TOTP secret and QR code data URL |
| `POST` | `/totp/confirm` | Authenticated | Verifies 6-digit TOTP code and activates MFA |

### 3.2 Applications (`/api/v1/applications`)
| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/` | Institution | Create new application draft (`version: 1`) |
| `GET` | `/` | Scoped | List applications with filtering, search, pagination |
| `GET` | `/:id` | Scoped | Retrieve full application details, form, and validation report |
| `PUT` | `/:id/draft` | Institution | Update draft form data with optimistic locking |
| `POST` | `/:id/validate` | Scoped | Execute 3-layer validation engine (Schema, Mandatory Docs, APH Rules) |
| `POST` | `/:id/submit` | Institution | Validate and submit application (moves `DRAFT` → `SUBMITTED`) |
| `GET` | `/:id/allowed-actions`| Scoped | Query valid state transitions from current state |
| `POST` | `/:id/transition` | Scoped | Execute workflow state transition in a single atomic transaction |
| `GET` | `/:id/clocks` | Scoped | Retrieve dual-clock elapsed duration and SLA status |

### 3.3 Tasks & Workload (`/api/v1/tasks`)
| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/my` | Authenticated | List open tasks assigned to the current user |
| `GET` | `/team` | Officer | List team tasks within jurisdiction |
| `PATCH`| `/:id/reassign` | Officer | Reassign task with mandatory audited reason |
| `POST` | `/bulk-reassign/preview` | Officer | Preview tasks matching reassignment criteria |
| `POST` | `/bulk-reassign` | Officer | Confirm bulk task reassignment |
| `POST` | `/bulk-remind` | Officer | Dispatch reminder notifications for overdue tasks |

### 3.4 Documents (`/api/v1/documents`)
| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/presign` | Scoped | Generate presigned S3 upload URL with hash validation |
| `POST` | `/complete` | Scoped | Verify uploaded object, execute ClamAV scan, check duplicates |
| `GET` | `/:id/download` | Scoped | Generate short-lived (5 min) download URL with download audit |

### 3.5 Deficiencies (`/api/v1/deficiencies`)
| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/` | Scrutiny Officer | Issue deficiency linked to APH clause; starts Institution clock |
| `POST` | `/respond` | Institution | Submit explanation and documents; returns to same reviewer |
| `POST` | `/resolve` | Scrutiny Officer | Accept/close or waive deficiency with remarks |
| `GET` | `/applications/:id/deficiencies` | Scoped | List all deficiency items for an application |

### 3.6 EVC Inspection (`/api/v1/evc`)
| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/schedule` | Regional Officer | Schedule visit with conflict-of-interest check |
| `POST` | `/applications/:id/start` | EVC Member | Mark physical inspection in progress |
| `POST` | `/report` | EVC Member | Submit structured report with geo-tagged photos |

### 3.7 Committee & Decision (`/api/v1/committee`)
| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/decisions` | Committee Member | Record recommendation/decision with mandatory remarks |
| `POST` | `/applications/:id/finalize` | Bureau Officer | Finalize approval outcome; auto-creates compliance conditions |

### 3.8 Compliance Radar (`/api/v1/compliance`)
| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/` | Scoped | Register compliance record |
| `PATCH`| `/:id` | Scoped | Update status or submit renewal document |
| `GET` | `/radar` | Scoped | Query expiring compliance items (`90/30/7/0` days) |

### 3.9 Audit Ledger (`/api/v1/audit`)
| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/` | Admin/Bureau | Query append-only audit trail with filters |
| `GET` | `/verify` | Admin/Bureau | Run `fn_verify_audit_chain()` and verify cryptographic hash chain |

### 3.10 Control Tower Analytics (`/api/v1/dashboard` & `/api/v1/analytics`)
| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/pendency` | Officer | Materialized pendency by stage, region, and track |
| `GET` | `/workload` | Officer | Materialized officer open task counts and capacity |
| `GET` | `/events` | Authenticated | Server-Sent Events (SSE) stream for real-time dashboard updates |

### 3.11 Observability (`/`)
| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/healthz` | Public | Liveness probe returning process uptime |
| `GET` | `/readyz` | Public | Readiness probe verifying DB, Redis, S3, AI connectivity |
| `GET` | `/metrics` | Public | Prometheus format metrics (latency, SLA breaches, queues) |
| `POST` | `/api/v1/admin/time-travel` | Admin | Advance virtual clock for SLA demo |
