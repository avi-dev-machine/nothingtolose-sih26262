-- 003_identity_and_tenancy.sql
-- Identity, Tenancy, RBAC, Tokens, and trigger-maintained updated_at

-- Updated at trigger function
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Regions
CREATE TABLE IF NOT EXISTS regions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_regions_updated_at
BEFORE UPDATE ON regions
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 2. Institutions
CREATE TABLE IF NOT EXISTS institutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aicte_id VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    region_id UUID NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
    state VARCHAR(100) NOT NULL,
    district VARCHAR(100) NOT NULL,
    address JSONB NOT NULL DEFAULT '{}'::jsonb,
    contact JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_institutions_updated_at
BEFORE UPDATE ON institutions
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 3. Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email CITEXT NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role role_enum NOT NULL,
    institution_id UUID REFERENCES institutions(id) ON DELETE RESTRICT,
    region_id UUID REFERENCES regions(id) ON DELETE RESTRICT,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    totp_secret_enc VARCHAR(500),
    totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    locale VARCHAR(10) NOT NULL DEFAULT 'en',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    failed_logins INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_user_tenancy_role CHECK (
        (role = 'INSTITUTION' AND institution_id IS NOT NULL) OR
        (role IN ('SCRUTINY_OFFICER', 'REGIONAL_OFFICER', 'EVC_MEMBER', 'COMMITTEE_MEMBER') AND region_id IS NOT NULL) OR
        (role IN ('BUREAU_OFFICER', 'ADMIN'))
    )
);

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 4. Refresh Tokens (with Token Family tracking for rotating refresh tokens)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    family_id UUID NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    user_agent TEXT,
    ip INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);

-- 5. Permissions
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Role Permissions
CREATE TABLE IF NOT EXISTS role_permissions (
    role role_enum NOT NULL,
    permission_key VARCHAR(100) NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
    PRIMARY KEY (role, permission_key)
);
