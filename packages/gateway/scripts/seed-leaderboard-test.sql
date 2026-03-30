-- Seed COMPLETED ScoreSubmission workflows for local leaderboard smoke tests.
--
-- Usage (from host, Postgres exposed on 5432):
--   PGPASSWORD=gateway psql -h localhost -U postgres -d gateway -f packages/gateway/scripts/seed-leaderboard-test.sql
--
-- Or from the postgres container:
--   docker compose exec -T postgres psql -U postgres -d gateway < packages/gateway/scripts/seed-leaderboard-test.sql
--
-- Idempotent: deletes prior seed rows by fixed UUID prefix, then inserts fresh rows.
--
-- Expected leaderboard results (after per-row normalization):
--   Agent 0x1111... — two rows at 0–100 scale: AVG([80,70,90,75,85], [60,60,60,60,60])
--                     → init=70, collab=65, reason=75, comply=68, effi=73 → overall ≈ 70
--   Agent 0x2222... — one row at basis-point scale [8500,7200,9000,8800,7600]
--                     → normalized to [85,72,90,88,76] → overall ≈ 82
--   Both agents land on a comparable 0–100 scale.

BEGIN;

DELETE FROM workflows WHERE id IN (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003'
);

-- Agent 0x1111... — two completed scores on studio A (0–100 style integers)
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

-- Agent 0x2222... — different studio; scores as basis points (0–10000).
-- The leaderboard CTE detects max > 100 and divides by 100 → [85,72,90,88,76].
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

COMMIT;
