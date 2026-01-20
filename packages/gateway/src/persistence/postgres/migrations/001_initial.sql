-- Migration 001: Initial schema
-- Gateway Workflow Persistence
--
-- Run with: psql -d gateway -f 001_initial.sql

BEGIN;

-- Workflows table
CREATE TABLE IF NOT EXISTS workflows (
    -- Identity
    id UUID PRIMARY KEY,
    type VARCHAR(64) NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    
    -- State
    state VARCHAR(32) NOT NULL,
    step VARCHAR(64) NOT NULL,
    step_attempts INTEGER NOT NULL DEFAULT 0,
    
    -- Context
    input JSONB NOT NULL,
    progress JSONB NOT NULL DEFAULT '{}',
    error JSONB,
    signer VARCHAR(42) NOT NULL,
    
    CONSTRAINT valid_state CHECK (state IN ('CREATED', 'RUNNING', 'STALLED', 'COMPLETED', 'FAILED'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_workflows_active 
    ON workflows (state) 
    WHERE state IN ('RUNNING', 'STALLED');

CREATE INDEX IF NOT EXISTS idx_workflows_type_state 
    ON workflows (type, state);

CREATE INDEX IF NOT EXISTS idx_workflows_signer 
    ON workflows (signer);

CREATE INDEX IF NOT EXISTS idx_workflows_studio 
    ON workflows ((input->>'studio_address'));

CREATE INDEX IF NOT EXISTS idx_workflows_updated 
    ON workflows (updated_at DESC);

-- Migration tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO schema_migrations (version) VALUES (1);

COMMIT;
