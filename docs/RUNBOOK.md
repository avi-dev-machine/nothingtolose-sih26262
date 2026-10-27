# AICTE Approval Control Tower (SIH26262) — Operations Runbook

## 1. Prerequisites

Before running the project locally or in a deployment environment, ensure the following tools are installed:
- **Node.js**: v20+ (v22/v24 recommended)
- **pnpm**: v10+ (`npm install -g pnpm`)
- **Python**: v3.11+ (with `pip` and `venv`)
- **Docker & Docker Compose**: v24+
- **Git**

---

## 2. Environment Configuration

Copy the example environment configuration into `.env`:
```bash
cp .env.example .env
```
Default ports configured:
- Frontend (Next.js): `http://localhost:3000`
- API (NestJS + Fastify): `http://localhost:4000`
- Worker (BullMQ metrics): `http://localhost:4001`
- AI Microservice (FastAPI): `http://localhost:8000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- MinIO S3 Console: `http://localhost:9001` (S3 API: `http://localhost:9000`)
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`

---

## 3. Starting Infrastructure Services (Docker Compose)

Start the supporting datastores and observability services:
```bash
pnpm docker:up
```

Verify that all containers are healthy:
```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

To stop all services:
```bash
pnpm docker:down
```

---

## 4. Database Migrations

Apply the plain SQL database migrations (including `pgvector`, `pgcrypto`, and the append-only trigger on `audit_ledger`):
```bash
pnpm migrate:up
```

To rollback:
```bash
pnpm migrate:down
```

---

## 5. Seeding Realistic Demo Data

To populate the database with realistic data (4 regions, 40 institutions, 60 users, 600 applications, 150 compliance items, 120 synthetic documents, 80 APH clauses):
```bash
pnpm seed
```

---

## 6. Running Development Services

### Running All Services Concurrently
```bash
pnpm dev
```

### Running Services Individually
- **API Service (NestJS + Fastify)**:
  ```bash
  pnpm dev:api
  ```
  Swagger Docs will be available at `http://localhost:4000/api/docs`.

- **Web Frontend (Next.js 14 App Router)**:
  ```bash
  pnpm dev:web
  ```
  Accessible at `http://localhost:3000`.

- **Background Worker (BullMQ + Redis)**:
  ```bash
  pnpm dev:worker
  ```

- **AI Microservice (FastAPI)**:
  ```bash
  pnpm dev:ai
  ```
  Swagger Docs will be available at `http://localhost:8000/docs`.

---

## 7. Quality Checks, Linting & Testing

Run all typechecks across workspace packages:
```bash
pnpm typecheck
```

Run linter:
```bash
pnpm lint
```

Run test suite:
```bash
pnpm test
```

---

## 8. Health Checks & Verification Endpoints

- API Health: `curl http://localhost:4000/api/v1/health`
- AI Health: `curl http://localhost:8000/health`
- MinIO S3 Health: `curl http://localhost:9000/minio/health/live`
- Redis Ping: `redis-cli -h localhost -p 6379 ping`
- PostgreSQL Connection: `psql postgresql://postgres:postgres@localhost:5432/aicte_db -c "SELECT COUNT(*) FROM audit_ledger;"`
