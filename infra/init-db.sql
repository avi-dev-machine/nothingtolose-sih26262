-- Extensions for AICTE Approval Control Tower
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Verify extensions
SELECT extname, extversion FROM pg_extension;
