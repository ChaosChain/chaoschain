-- Identity + leaderboard E2E seed (extends repo-root seed.md intent).
-- Run: docker compose exec -T postgres psql -U postgres -d gateway -f - < packages/gateway/scripts/seed-identity-e2e.sql
-- Or from host: PGPASSWORD=gateway psql -h localhost -U postgres -d gateway -f packages/gateway/scripts/seed-identity-e2e.sql

BEGIN;

-- From seed.md: sessions + workflows for leaderboard (agent_name + JOIN)
DELETE FROM session_events WHERE session_id IN ('sess_test_identity_1', 'sess_test_identity_2', 'sess_e2e_live_submit');
DELETE FROM sessions WHERE session_id IN ('sess_test_identity_1', 'sess_test_identity_2', 'sess_e2e_live_submit');
DELETE FROM workflows WHERE id IN (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000099'
);

INSERT INTO sessions (
  session_id, session_root_event_id, studio_address, studio_policy_version,
  work_mandate_id, task_type, agent_address, agent_name, status,
  started_at, completed_at, event_count, epoch, workflow_id, data_hash
) VALUES (
  'sess_test_identity_1', NULL,
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'engineering-studio-default-v1', 'generic-task', 'general',
  '0x08109bab53bd44a8a6ed1f584ff02856dad01225',
  'claude-code',
  'completed',
  '2026-03-27T03:11:45Z', '2026-03-27T03:13:03Z',
  10, 50,
  '00000000-0000-0000-0000-000000000101',
  '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0001'
);

INSERT INTO workflows (
  id, type, created_at, updated_at, state, step, step_attempts,
  input, progress, error, signer
) VALUES (
  '00000000-0000-0000-0000-000000000101',
  'WorkSubmission', 1711500000000, 1711500060000, 'COMPLETED',
  'DONE', 0,
  '{"studio_address":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","agent_address":"0x08109bab53bd44a8a6ed1f584ff02856dad01225","data_hash":"0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0001","epoch":50}'::jsonb,
  '{"onchainTxHash":"0xfake_work_tx_1"}'::jsonb,
  NULL,
  '0x81Ca4F6D7Cc60418284e9002608f8b3Eb7e8Cec7'
);

INSERT INTO workflows (
  id, type, created_at, updated_at, state, step, step_attempts,
  input, progress, error, signer
) VALUES (
  '00000000-0000-0000-0000-000000000102',
  'ScoreSubmission', 1711500120000, 1711500180000, 'COMPLETED',
  'DONE', 0,
  '{"studio_address":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","data_hash":"0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0001","worker_address":"0x81Ca4F6D7Cc60418284e9002608f8b3Eb7e8Cec7","validator_address":"0xf81043d7866F5a90836a65E6ea37d38a38716F69","scores":[70,65,80,75,72],"mode":"direct"}'::jsonb,
  '{"scoreTxHash":"0xfake_score_tx_1"}'::jsonb,
  NULL,
  '0x81Ca4F6D7Cc60418284e9002608f8b3Eb7e8Cec7'
);

INSERT INTO sessions (
  session_id, session_root_event_id, studio_address, studio_policy_version,
  work_mandate_id, task_type, agent_address, agent_name, status,
  started_at, completed_at, event_count, epoch, workflow_id, data_hash
) VALUES (
  'sess_test_identity_2', NULL,
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'engineering-studio-default-v1', 'generic-task', 'general',
  '0x6bae4e3fd6fb47fa85258f3f6dd382c319f7839c',
  'gpt-coder',
  'completed',
  '2026-03-27T03:12:50Z', '2026-03-27T03:12:50Z',
  13, 51,
  '00000000-0000-0000-0000-000000000201',
  '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB0002'
);

INSERT INTO workflows (
  id, type, created_at, updated_at, state, step, step_attempts,
  input, progress, error, signer
) VALUES (
  '00000000-0000-0000-0000-000000000201',
  'WorkSubmission', 1711500300000, 1711500360000, 'COMPLETED',
  'DONE', 0,
  '{"studio_address":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","agent_address":"0x6bae4e3fd6fb47fa85258f3f6dd382c319f7839c","data_hash":"0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB0002","epoch":51}'::jsonb,
  '{"onchainTxHash":"0xfake_work_tx_2"}'::jsonb,
  NULL,
  '0x81Ca4F6D7Cc60418284e9002608f8b3Eb7e8Cec7'
);

INSERT INTO workflows (
  id, type, created_at, updated_at, state, step, step_attempts,
  input, progress, error, signer
) VALUES (
  '00000000-0000-0000-0000-000000000202',
  'ScoreSubmission', 1711500420000, 1711500480000, 'COMPLETED',
  'DONE', 0,
  '{"studio_address":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","data_hash":"0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB0002","worker_address":"0x81Ca4F6D7Cc60418284e9002608f8b3Eb7e8Cec7","validator_address":"0xf81043d7866F5a90836a65E6ea37d38a38716F69","scores":[8500,7200,9000,8800,7600],"mode":"direct"}'::jsonb,
  '{"scoreTxHash":"0xfake_score_tx_2"}'::jsonb,
  NULL,
  '0x81Ca4F6D7Cc60418284e9002608f8b3Eb7e8Cec7'
);

-- Live POST /workflows/score-submission: no prior ScoreSubmission for this data_hash.
-- WorkSubmission.signer = on-chain participant (gateway from historical submit); Docker uses Anvil #0 for signing txs.
INSERT INTO sessions (
  session_id, session_root_event_id, studio_address, studio_policy_version,
  work_mandate_id, task_type, agent_address, agent_name, status,
  started_at, completed_at, event_count, epoch, workflow_id, data_hash
) VALUES (
  'sess_e2e_live_submit', NULL,
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'engineering-studio-default-v1', 'generic-task', 'general',
  '0x08109bab53bd44a8a6ed1f584ff02856dad01225',
  'e2e-runner',
  'completed',
  '2026-03-27T04:00:00Z', '2026-03-27T04:00:00Z',
  0, 52,
  '00000000-0000-0000-0000-000000000099',
  '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC0003'
);

INSERT INTO workflows (
  id, type, created_at, updated_at, state, step, step_attempts,
  input, progress, error, signer
) VALUES (
  '00000000-0000-0000-0000-000000000099',
  'WorkSubmission', 1711600000000, 1711600060000, 'COMPLETED',
  'DONE', 0,
  '{"studio_address":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","agent_address":"0x08109bab53bd44a8a6ed1f584ff02856dad01225","data_hash":"0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC0003","epoch":52}'::jsonb,
  '{}'::jsonb,
  NULL,
  '0x81Ca4F6D7Cc60418284e9002608f8b3Eb7e8Cec7'
);

COMMIT;
