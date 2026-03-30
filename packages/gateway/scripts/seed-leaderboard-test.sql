-- Seed COMPLETED ScoreSubmission workflows + matching sessions for local
-- leaderboard smoke tests.
--
-- Usage (from host, Postgres exposed on 5432):
--   PGPASSWORD=gateway psql -h localhost -U postgres -d gateway -f packages/gateway/scripts/seed-leaderboard-test.sql
--
-- Or from the postgres container:
--   docker compose exec -T postgres psql -U postgres -d gateway < packages/gateway/scripts/seed-leaderboard-test.sql
--
-- Idempotent: deletes prior seed rows by fixed UUIDs, then inserts fresh rows.
--
-- The leaderboard JOINs workflows to sessions on data_hash so the real
-- agent_address (from the session) appears instead of the gateway signer
-- stored as worker_address.
--
-- Expected leaderboard results (after per-row normalization + JOIN):
--   Agent 0x08109bab... — resolved via session rows (worker_address was 0x1111... = gateway signer)
--                         two rows at 0–100 scale: AVG([80,70,90,75,85], [60,60,60,60,60])
--                         → init=70, collab=65, reason=75, comply=68, effi=73 → overall ≈ 70
--   Agent 0x2222...     — no matching session, falls back to worker_address
--                         one row at basis-point scale [8500,7200,9000,8800,7600]
--                         → normalized to [85,72,90,88,76] → overall ≈ 82

BEGIN;

DELETE FROM workflows WHERE id IN (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003'
);

DELETE FROM session_events WHERE session_id IN (
  'sess_leaderboard_seed_01',
  'sess_leaderboard_seed_02'
);
DELETE FROM sessions WHERE session_id IN (
  'sess_leaderboard_seed_01',
  'sess_leaderboard_seed_02'
);

-- Worker 0x1111... is the gateway signer; the real agent is 0x08109bab...
-- Sessions below link data_hash → agent_address so the leaderboard resolves correctly.
INSERT INTO workflows (
  id, type, created_at, updated_at,
  state, step, step_attempts,
  input, progress, error, signer
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001',
  'ScoreSubmission',
  1743000000000,
  1743010000000,
  'COMPLETED',
  'COMPLETED',
  0,
  '{
    "studio_address": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "epoch": 1,
    "validator_address": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "data_hash": "0x0000000000000000000000000000000000000000000000000000000000000001",
    "scores": [80, 70, 90, 75, 85],
    "salt": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "signer_address": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "worker_address": "0x1111111111111111111111111111111111111111",
    "mode": "direct"
  }'::jsonb,
  '{"score_confirmed": true}'::jsonb,
  NULL,
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
);

INSERT INTO workflows (
  id, type, created_at, updated_at,
  state, step, step_attempts,
  input, progress, error, signer
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002',
  'ScoreSubmission',
  1743020000000,
  1743030000000,
  'COMPLETED',
  'COMPLETED',
  0,
  '{
    "studio_address": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "epoch": 1,
    "validator_address": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "data_hash": "0x0000000000000000000000000000000000000000000000000000000000000002",
    "scores": [60, 60, 60, 60, 60],
    "salt": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "signer_address": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "worker_address": "0x1111111111111111111111111111111111111111",
    "mode": "direct"
  }'::jsonb,
  '{"score_confirmed": true}'::jsonb,
  NULL,
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
);

-- Agent 0x2222... — different studio; no matching session row (tests COALESCE fallback).
-- Scores as basis points (0–10000); CTE detects max > 100 → divides by 100 → [85,72,90,88,76].
INSERT INTO workflows (
  id, type, created_at, updated_at,
  state, step, step_attempts,
  input, progress, error, signer
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003',
  'ScoreSubmission',
  1743040000000,
  1743050000000,
  'COMPLETED',
  'COMPLETED',
  0,
  '{
    "studio_address": "0xcccccccccccccccccccccccccccccccccccccccc",
    "epoch": 1,
    "validator_address": "0xdddddddddddddddddddddddddddddddddddddddd",
    "data_hash": "0x0000000000000000000000000000000000000000000000000000000000000003",
    "scores": [8500, 7200, 9000, 8800, 7600],
    "salt": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "signer_address": "0xdddddddddddddddddddddddddddddddddddddddd",
    "worker_address": "0x2222222222222222222222222222222222222222",
    "mode": "direct"
  }'::jsonb,
  '{"score_confirmed": true}'::jsonb,
  NULL,
  '0xdddddddddddddddddddddddddddddddddddddddd'
);

-- Sessions linking data_hash to the real agent_address.
-- Workflow 0001 → session with data_hash ...0001
-- Workflow 0002 → session with data_hash ...0002
-- Both point to the real agent 0x08109bab... instead of signer 0x1111...

INSERT INTO sessions (
  session_id, session_root_event_id,
  studio_address, studio_policy_version, work_mandate_id, task_type,
  agent_address, status, started_at, completed_at,
  event_count, workflow_id, data_hash, epoch
) VALUES (
  'sess_leaderboard_seed_01', NULL,
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'engineering-studio-default-v1', 'generic-task', 'feature',
  '0x08109bab0000000000000000000000000000aaaa', 'completed', '2025-03-26T10:00:00Z', '2025-03-26T11:00:00Z',
  3, NULL, '0x0000000000000000000000000000000000000000000000000000000000000001', 1
);

INSERT INTO sessions (
  session_id, session_root_event_id,
  studio_address, studio_policy_version, work_mandate_id, task_type,
  agent_address, status, started_at, completed_at,
  event_count, workflow_id, data_hash, epoch
) VALUES (
  'sess_leaderboard_seed_02', NULL,
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'engineering-studio-default-v1', 'generic-task', 'bugfix',
  '0x08109bab0000000000000000000000000000aaaa', 'completed', '2025-03-26T12:00:00Z', '2025-03-26T13:00:00Z',
  5, NULL, '0x0000000000000000000000000000000000000000000000000000000000000002', 1
);

COMMIT;
