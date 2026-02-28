/**
 * Prometheus Metrics — Internal Only
 *
 * Counters for workflow lifecycle events.
 * Served on a separate internal port (default 9090), NOT on the public API path.
 */

import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { createServer, Server } from 'http';

export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry });

export const workSubmissionStarted = new Counter({
  name: 'work_submission_started_total',
  help: 'Number of work submission workflows started',
  registers: [metricsRegistry],
});

export const workSubmissionCompleted = new Counter({
  name: 'work_submission_completed_total',
  help: 'Number of work submission workflows completed',
  registers: [metricsRegistry],
});

export const scoreSubmissionCompleted = new Counter({
  name: 'score_submission_completed_total',
  help: 'Number of score submission workflows completed',
  registers: [metricsRegistry],
});

export const closeEpochCompleted = new Counter({
  name: 'close_epoch_completed_total',
  help: 'Number of close epoch workflows completed',
  registers: [metricsRegistry],
});

export const workflowFailures = new Counter({
  name: 'workflow_failures_total',
  help: 'Number of workflow failures (all types)',
  labelNames: ['workflow_type'] as const,
  registers: [metricsRegistry],
});

/**
 * Map workflowId → workflow type for tracking completions/failures
 * from engine events that only carry the workflowId.
 */
const workflowTypeMap = new Map<string, string>();

export function trackWorkflowCreated(workflowId: string, type: string): void {
  workflowTypeMap.set(workflowId, type);

  if (type === 'WorkSubmission') workSubmissionStarted.inc();
}

export function trackWorkflowCompleted(workflowId: string): void {
  const type = workflowTypeMap.get(workflowId);
  workflowTypeMap.delete(workflowId);

  switch (type) {
    case 'WorkSubmission':
      workSubmissionCompleted.inc();
      break;
    case 'ScoreSubmission':
      scoreSubmissionCompleted.inc();
      break;
    case 'CloseEpoch':
      closeEpochCompleted.inc();
      break;
  }
}

export function trackWorkflowFailed(workflowId: string): void {
  const type = workflowTypeMap.get(workflowId) ?? 'unknown';
  workflowTypeMap.delete(workflowId);
  workflowFailures.inc({ workflow_type: type });
}

/**
 * Start the internal metrics HTTP server.
 * Serves /metrics in Prometheus exposition format.
 */
export function startMetricsServer(port: number): Server {
  const server = createServer(async (_req, res) => {
    if (_req.url === '/metrics') {
      res.setHeader('Content-Type', metricsRegistry.contentType);
      res.end(await metricsRegistry.metrics());
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
  });

  server.listen(port, '0.0.0.0');
  return server;
}
