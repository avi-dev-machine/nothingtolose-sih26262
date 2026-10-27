# AICTE Control Tower — Security & Compliance Architecture

## 1. Compliance Standard: OWASP ASVS Level 2
The AICTE Control Tower backend is built with an OWASP Application Security Verification Standard (ASVS) Level 2 security posture.

---

## 2. Authentication & Session Management

### 2.1 Password Hashing (Argon2id)
All user passwords are encrypted using `argon2id` with industry-standard parameters:
- Algorithm: `argon2id`
- Memory Cost: 65,536 KB (64 MB)
- Time Cost: 3 iterations
- Parallelism: 1 thread

### 2.2 Refresh Token Rotation with Token Family Reuse Detection
Refresh tokens use token family tracking:
1. Every successful refresh revokes the presented refresh token and issues a new token belonging to the same `family_id`.
2. **Reuse Detection**: If a previously revoked refresh token is presented, the system flags a replay attack, immediately revokes **all tokens in that family**, and logs a security alert.

### 2.3 Account Lockout
To prevent credential stuffing and brute-force attacks:
- 5 consecutive failed login attempts trigger an immediate 15-minute account lockout (`users.locked_until = NOW() + INTERVAL '15 minutes'`).
- Successful authentication resets the counter to 0.

### 2.4 Multi-Factor Authentication (TOTP)
- Mandatory for all officer roles (`SCRUTINY_OFFICER`, `REGIONAL_OFFICER`, `EVC_MEMBER`, `COMMITTEE_MEMBER`, `BUREAU_OFFICER`, `ADMIN`).
- All TOTP secret keys stored in the database are encrypted using **AES-256-GCM** with an ephemeral initialization vector and authentication tag (`totp_secret_enc`).

---

## 3. Data Isolation: Row-Level Security (RLS)
Operational tables (`applications`, `documents`, `deficiencies`, `compliance_items`, `notifications`, `tasks`) have PostgreSQL Row-Level Security enabled.

Prior to executing any database query within an authorized transaction, the backend sets session context:
```sql
SELECT
  set_config('app.user_id', $1, true),
  set_config('app.role', $2, true),
  set_config('app.region_id', $3, true),
  set_config('app.institution_id', $4, true);
```
Policies enforce:
- Institutions can only view and mutate their own institution's records.
- Regional officers are constrained strictly to institutions and applications within their regional jurisdiction.
- Administrators and Bureau Officers have global read/write access.

---

## 4. File Upload & Storage Security

### 4.1 Strict Whitelisting
- MIME Type: Whitelist strictly limited to `application/pdf`, `image/jpeg`, `image/png`.
- File Extension: Checked against `.pdf`, `.png`, `.jpg`, `.jpeg`.
- File Size Cap: Maximum 20 MiB per file.

### 4.2 Magic-Byte Verification
Before accepting any document upload, file headers are inspected in memory:
- PDF: must begin with `%PDF` (`0x25 0x50 0x44 0x46`)
- PNG: must begin with `\x89PNG` (`0x89 0x50 0x4E 0x47`)
- JPEG: must begin with `\xFF\xD8\xFF`

### 4.3 ClamAV Antivirus Scanning & Quarantine
- All uploaded files are scanned via streaming ClamAV protocol and checked against the standard EICAR test signature.
- If a signature is detected, the document status is set to `QUARANTINED`, download access is blocked, and an alert is recorded.

### 4.4 Short-Lived Signed URLs & Download Audit
- Direct public access to S3/MinIO buckets is prohibited.
- Download URLs are generated using AWS SDK S3 request presigning with a 5-minute (300 seconds) time-to-live.
- Every download access is recorded in `audit_log` with actor ID and timestamp.

---

## 5. Tamper-Evident Hash-Chained Audit Ledger

### 5.1 Append-Only Immutability
The `audit_log` table enforces immutability via database triggers:
- `UPDATE`, `DELETE`, and `TRUNCATE` operations are strictly blocked by trigger `trg_audit_log_immutable`.
- Privileges for `UPDATE`, `DELETE`, `TRUNCATE` are revoked from the application DB role (`aicte_app`).

### 5.2 Cryptographic Hash Chaining
Every audit log row contains:
`hash = SHA-256(prev_hash || seq || ts || actor_id || action || entity_type || entity_id || canonical_payload)`
A PostgreSQL advisory lock (`pg_advisory_xact_lock(987654321)`) serializes sequence insertion, preventing race conditions even under high concurrency.

### 5.3 Integrity Verification
The database stored procedure `fn_verify_audit_chain()` walks the ledger sequentially. If any row's payload, timestamp, or sequence has been tampered with, it identifies the exact broken sequence number.

---

## 6. Authorization Matrix Test Coverage
The test suite includes matrix verification (`auth_matrix.test.ts`) validating that every role:
- Institution
- Scrutiny Officer
- Regional Officer
- EVC Member
- Committee Member
- Bureau Officer
- Admin

is tested against every protected route, asserting strict `allow` or `deny` per specification.
