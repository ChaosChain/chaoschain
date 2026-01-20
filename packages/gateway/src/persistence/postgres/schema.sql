-- Gateway Workflow Persistence Schema
-- 
-- Reflects WorkflowRecord exactly.
-- No derived state stored.
-- Supports write-ahead + atomic transitions.

-- Workflows table
CREATE TABLE IF NOT EXISTS workflows (
    -- Identity
    id UUID PRIMARY KEY,
    type VARCHAR(64) NOT NULL,
    created_at BIGINT NOT NULL,           -- Unix timestamp ms
    updated_at BIGINT NOT NULL,           -- Unix timestamp ms
    
    -- State
    state VARCHAR(32) NOT NULL,           -- CREATED, RUNNING, STALLED, COMPLETED, FAILED
    step VARCHAR(64) NOT NULL,            -- Current step name
    step_attempts INTEGER NOT NULL DEFAULT 0,
    
    -- Context (immutable after creation)
    input JSONB NOT NULL,
    
    -- Progress (append-only)
    progress JSONB NOT NULL DEFAULT '{}',
    
    -- Failure info
    error JSONB,
    
    -- Signer coordination
    signer VARCHAR(42) NOT NULL,          -- Ethereum address
    
    -- Indexes for common queries
    CONSTRAINT valid_state CHECK (state IN ('CREATED', 'RUNNING', 'STALLED', 'COMPLETED', 'FAILED'))
);

-- Index for finding active workflows on startup
CREATE INDEX IF NOT EXISTS idx_workflows_active 
    ON workflows (state) 
    WHERE state IN ('RUNNING', 'STALLED');

-- Index for querying by type and state
CREATE INDEX IF NOT EXISTS idx_workflows_type_state 
    ON workflows (type, state);

-- Index for querying by signer (for tx serialization awareness)
CREATE INDEX IF NOT EXISTS idx_workflows_signer 
    ON workflows (signer);

-- Index for studio queries (extracts studio_address from input JSONB)
CREATE INDEX IF NOT EXISTS idx_workflows_studio 
    ON workflows ((input->>'studio_address'));

-- Index for updated_at (for monitoring/debugging)
CREATE INDEX IF NOT EXISTS idx_workflows_updated 
    ON workflows (updated_at DESC);
