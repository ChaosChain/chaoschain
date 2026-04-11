-- Migration 005: Cross-workflow ScoreSubmission idempotency
-- Run with: psql -d gateway -f 005_score_dedup.sql
--
-- Background: prior to this migration, SubmitScoreDirectStep had no
-- cross-workflow idempotency guard. Multiple verifier instances polling
-- the same gateway pending queue could both discover the same work
-- item, both run their local scoring pipeline, and both create separate
-- ScoreSubmission workflows that each reached COMPLETED for the same
-- data_hash. The compare-page leaderboard SQL AVGs across all COMPLETED
-- ScoreSubmission rows per agent, so duplicate rows directly polluted
-- canonical per-agent scores.
--
-- Fix layers (defence in depth):
--   1. Application-level check in SubmitScoreDirectStep.execute before
--      marking score_confirmed — catches the common case.
--   2. This partial unique index — catches the TOCTOU race when two
--      workflows pass the check above in the same millisecond and
--      both try to transition to COMPLETED. Whichever UPDATE fires
--      second receives pg error 23505, which the workflow step handler
--      catches and converts into a no-op success ("first winner is
--      canonical, this workflow is a duplicate").
--
-- The filter `state = 'COMPLETED'` means rows in CREATED/RUNNING/
-- STALLED/FAILED states can coexist freely for the same data_hash —
-- only the transition _into_ COMPLETED is serialised, which is exactly
-- where duplication matters.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_score_submission_data_hash_completed
    ON workflows ((input->>'data_hash'))
    WHERE type = 'ScoreSubmission' AND state = 'COMPLETED';

INSERT INTO schema_migrations (version) VALUES (5)
    ON CONFLICT (version) DO NOTHING;

COMMIT;
