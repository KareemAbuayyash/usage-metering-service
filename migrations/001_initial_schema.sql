
-- 001_initial_schema.sql

BEGIN;

-- 1. Accounts
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    api_key_hash CHAR(64) NOT NULL UNIQUE,
    account_plan_id UUID,
    account_plan_scope VARCHAR(10) NOT NULL DEFAULT 'account'
        CHECK (account_plan_scope = 'account'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Plans
CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    scope VARCHAR(10) NOT NULL CHECK (scope IN ('account', 'user')),
    name VARCHAR(100) NOT NULL,
    monthly_limit BIGINT NOT NULL CHECK (monthly_limit > 0),
    max_units_per_request BIGINT NOT NULL
        CHECK (max_units_per_request > 0),
    is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        (is_builtin = TRUE AND owner_account_id IS NULL)
        OR
        (is_builtin = FALSE AND owner_account_id IS NOT NULL)
    ),

    UNIQUE (id, scope)
);

-- An account can only use an account-scoped plan.
ALTER TABLE accounts
ADD CONSTRAINT fk_accounts_account_plan
FOREIGN KEY (account_plan_id, account_plan_scope)
REFERENCES plans (id, scope)
DEFERRABLE INITIALLY DEFERRED;

-- 3. Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    plan_id UUID NOT NULL,
    plan_scope VARCHAR(10) NOT NULL DEFAULT 'user'
        CHECK (plan_scope = 'user'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (id, account_id),

    CONSTRAINT fk_users_user_plan
        FOREIGN KEY (plan_id, plan_scope)
        REFERENCES plans (id, scope)
);

-- 4. Monthly usage.
-- user_id IS NULL represents the account's shared total.
CREATE TABLE usage_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id UUID,
    month_start DATE NOT NULL,
    consumed_units BIGINT NOT NULL DEFAULT 0
        CHECK (consumed_units >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (EXTRACT(DAY FROM month_start) = 1),

    CONSTRAINT fk_usage_period_user
        FOREIGN KEY (user_id, account_id)
        REFERENCES users (id, account_id)
);

CREATE UNIQUE INDEX uq_account_usage_month
    ON usage_periods (account_id, month_start)
    WHERE user_id IS NULL;

CREATE UNIQUE INDEX uq_user_usage_month
    ON usage_periods (account_id, user_id, month_start)
    WHERE user_id IS NOT NULL;

-- 5. Request history and idempotency.
CREATE TABLE usage_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    request_id VARCHAR(200) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    units BIGINT NOT NULL CHECK (units > 0),
    status VARCHAR(10) NOT NULL
        CHECK (status IN ('accepted', 'rejected')),
    rejection_scope VARCHAR(10)
        CHECK (rejection_scope IN ('account', 'user')),
    rejection_reason VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_usage_request_user
        FOREIGN KEY (user_id, account_id)
        REFERENCES users (id, account_id),

    UNIQUE (account_id, request_id),

    CHECK (
        (status = 'accepted'
            AND rejection_scope IS NULL
            AND rejection_reason IS NULL)
        OR
        (status = 'rejected'
            AND rejection_scope IS NOT NULL
            AND rejection_reason IS NOT NULL)
    )
);

-- 6. Indexes for lookups and history.
CREATE INDEX idx_users_account
    ON users (account_id);

CREATE INDEX idx_usage_requests_history
    ON usage_requests (account_id, created_at DESC, id DESC);

CREATE INDEX idx_usage_requests_user_history
    ON usage_requests (account_id, user_id, created_at DESC, id DESC);

-- 7. Built-in plans.
INSERT INTO plans (
    owner_account_id,
    scope,
    name,
    monthly_limit,
    max_units_per_request,
    is_builtin
)
VALUES
    (NULL, 'account', 'Starter', 10000, 100, TRUE),
    (NULL, 'account', 'Pro', 100000, 1000, TRUE),
    (NULL, 'user', 'Basic', 1000, 20, TRUE),
    (NULL, 'user', 'Premium', 10000, 100, TRUE);

COMMIT;
