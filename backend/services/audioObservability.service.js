const LATENCY_SAMPLE_LIMIT = 5000;
const CONFIDENCE_SAMPLE_LIMIT = 5000;

const metrics = {
  total: 0,
  processed: 0,
  discarded: 0,
  clarification: 0,
  lowConfidence: 0,
  confirmedActions: 0,
  executedActions: 0,
  sttRetries: 0,
  outOfOrder: 0,
  failureByType: {
    audio: 0,
    stt: 0,
    intent: 0,
    state: 0,
    timing: 0,
  },
  reasonCounts: {},
  latenciesMs: [],
  confidenceSamples: [],
  queue: {
    peakDepth: 0,
    rejected: 0,
    timeout: 0,
  },
};

function pushLimited(list, value, limit) {
  list.push(value);
  if (list.length > limit) {
    list.shift();
  }
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function recordQueueDepth(depth) {
  if (depth > metrics.queue.peakDepth) {
    metrics.queue.peakDepth = depth;
  }
}

function recordQueueRejection() {
  metrics.queue.rejected += 1;
}

function recordQueueTimeout() {
  metrics.queue.timeout += 1;
}

function record(event = {}) {
  metrics.total += 1;

  if (event.processed) metrics.processed += 1;
  if (event.discarded) metrics.discarded += 1;
  if (event.clarification) metrics.clarification += 1;
  if (event.lowConfidence) metrics.lowConfidence += 1;
  if (event.confirmedAction) metrics.confirmedActions += 1;
  if (event.executedAction) metrics.executedActions += 1;
  if (event.sttRetry) metrics.sttRetries += 1;
  if (event.outOfOrder) metrics.outOfOrder += 1;

  const failureType = event.failureType;
  if (failureType && metrics.failureByType[failureType] !== undefined) {
    metrics.failureByType[failureType] += 1;
  }

  if (event.reason) {
    metrics.reasonCounts[event.reason] = (metrics.reasonCounts[event.reason] || 0) + 1;
  }

  if (Number.isFinite(event.latencyMs)) {
    pushLimited(metrics.latenciesMs, Number(event.latencyMs), LATENCY_SAMPLE_LIMIT);
  }

  if (Number.isFinite(event.confidence)) {
    pushLimited(
      metrics.confidenceSamples,
      Math.max(0, Math.min(1, Number(event.confidence))),
      CONFIDENCE_SAMPLE_LIMIT
    );
  }
}

function getSnapshot() {
  const latency = metrics.latenciesMs;
  const confidence = metrics.confidenceSamples;
  const total = metrics.total || 1;
  const avgConfidence =
    confidence.length
      ? confidence.reduce((acc, x) => acc + x, 0) / confidence.length
      : 0;

  return {
    totals: {
      total: metrics.total,
      processed: metrics.processed,
      discarded: metrics.discarded,
      clarification: metrics.clarification,
      lowConfidence: metrics.lowConfidence,
      confirmedActions: metrics.confirmedActions,
      executedActions: metrics.executedActions,
      sttRetries: metrics.sttRetries,
      outOfOrder: metrics.outOfOrder,
    },
    ratios: {
      lowConfidencePct: Number(((metrics.lowConfidence / total) * 100).toFixed(2)),
      clarificationPct: Number(((metrics.clarification / total) * 100).toFixed(2)),
      executedVsConfirmedPct: metrics.confirmedActions
        ? Number(((metrics.executedActions / metrics.confirmedActions) * 100).toFixed(2))
        : 0,
    },
    failureByType: { ...metrics.failureByType },
    reasonCounts: { ...metrics.reasonCounts },
    latencyMs: {
      p50: Number(percentile(latency, 50).toFixed(2)),
      p95: Number(percentile(latency, 95).toFixed(2)),
      p99: Number(percentile(latency, 99).toFixed(2)),
    },
    confidence: {
      avg: Number(avgConfidence.toFixed(4)),
      p10: Number(percentile(confidence, 10).toFixed(4)),
      p50: Number(percentile(confidence, 50).toFixed(4)),
      p90: Number(percentile(confidence, 90).toFixed(4)),
    },
    queue: {
      peakDepth: metrics.queue.peakDepth,
      rejected: metrics.queue.rejected,
      timeout: metrics.queue.timeout,
    },
  };
}

function reset() {
  metrics.total = 0;
  metrics.processed = 0;
  metrics.discarded = 0;
  metrics.clarification = 0;
  metrics.lowConfidence = 0;
  metrics.confirmedActions = 0;
  metrics.executedActions = 0;
  metrics.sttRetries = 0;
  metrics.outOfOrder = 0;
  metrics.failureByType = {
    audio: 0,
    stt: 0,
    intent: 0,
    state: 0,
    timing: 0,
  };
  metrics.reasonCounts = {};
  metrics.latenciesMs = [];
  metrics.confidenceSamples = [];
  metrics.queue = {
    peakDepth: 0,
    rejected: 0,
    timeout: 0,
  };
}

module.exports = {
  record,
  getSnapshot,
  reset,
  recordQueueDepth,
  recordQueueRejection,
  recordQueueTimeout,
};
