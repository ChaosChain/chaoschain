/**
 * Prometheus Metrics — Unit Tests
 *
 * Tests for:
 *   - /metrics endpoint returns HTTP 200
 *   - Metrics are exposed in Prometheus format
 *   - Counter tracking works
 */

import { describe, it, expect, afterAll } from 'vitest';
import {
  metricsRegistry,
  trackWorkflowCreated,
  trackWorkflowCompleted,
  trackWorkflowFailed,
  startMetricsServer,
} from '../../src/metrics/index.js';
import type { Server } from 'http';

let server: Server | undefined;

afterAll(() => {
  if (server) server.close();
});

describe('Prometheus Metrics', () => {
  it('/metrics returns HTTP 200 with Prometheus content', async () => {
    const port = 19090 + Math.floor(Math.random() * 1000);
    server = startMetricsServer(port);

    await new Promise((r) => setTimeout(r, 200));

    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);

    const text = await res.text();
    expect(text).toContain('work_submission_started_total');
    expect(text).toContain('work_submission_completed_total');
    expect(text).toContain('score_submission_completed_total');
    expect(text).toContain('close_epoch_completed_total');
    expect(text).toContain('workflow_failures_total');

    server.close();
    server = undefined;
  });

  it('tracks workflow counters correctly', async () => {
    trackWorkflowCreated('wf-1', 'WorkSubmission');
    trackWorkflowCreated('wf-2', 'ScoreSubmission');
    trackWorkflowCreated('wf-3', 'CloseEpoch');
    trackWorkflowCreated('wf-4', 'WorkSubmission');

    trackWorkflowCompleted('wf-1');
    trackWorkflowCompleted('wf-2');
    trackWorkflowCompleted('wf-3');
    trackWorkflowFailed('wf-4');

    const metrics = await metricsRegistry.metrics();

    expect(metrics).toContain('work_submission_started_total 2');
    expect(metrics).toContain('work_submission_completed_total 1');
    expect(metrics).toContain('score_submission_completed_total 1');
    expect(metrics).toContain('close_epoch_completed_total 1');
    expect(metrics).toContain('workflow_failures_total{workflow_type="WorkSubmission"} 1');
  });

  it('non-/metrics path returns 404', async () => {
    const port = 19090 + Math.floor(Math.random() * 1000);
    server = startMetricsServer(port);

    await new Promise((r) => setTimeout(r, 200));

    const res = await fetch(`http://127.0.0.1:${port}/other`);
    expect(res.status).toBe(404);

    server.close();
    server = undefined;
  });
});
