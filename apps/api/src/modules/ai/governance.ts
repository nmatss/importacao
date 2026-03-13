import { logger } from '../../shared/utils/logger.js';

export interface AIRequestLog {
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  status: 'success' | 'error';
  errorMessage?: string;
  context: string;
}

// In-memory store until migration 0004 creates the ai_request_logs table
const aiRequestLogs: AIRequestLog[] = [];
const MAX_IN_MEMORY_LOGS = 1000;

export function logAIRequest(log: AIRequestLog): void {
  if (aiRequestLogs.length >= MAX_IN_MEMORY_LOGS) {
    aiRequestLogs.splice(0, aiRequestLogs.length - MAX_IN_MEMORY_LOGS + 100);
  }
  aiRequestLogs.push(log);

  logger.info(
    {
      model: log.model,
      promptVersion: log.promptVersion,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      latencyMs: log.latencyMs,
      status: log.status,
      context: log.context,
    },
    'AI request logged',
  );
}

export function getRecentAIRequests(limit = 50): AIRequestLog[] {
  return aiRequestLogs.slice(-limit);
}

export function getAIRequestStats(): {
  totalRequests: number;
  successRate: number;
  avgLatencyMs: number;
  byModel: Record<string, { count: number; avgLatencyMs: number }>;
  byContext: Record<string, { count: number; avgLatencyMs: number }>;
} {
  const total = aiRequestLogs.length;
  if (total === 0) {
    return { totalRequests: 0, successRate: 0, avgLatencyMs: 0, byModel: {}, byContext: {} };
  }

  const successes = aiRequestLogs.filter((l) => l.status === 'success').length;
  const totalLatency = aiRequestLogs.reduce((sum, l) => sum + l.latencyMs, 0);

  const byModel: Record<string, { count: number; totalLatency: number }> = {};
  const byContext: Record<string, { count: number; totalLatency: number }> = {};

  for (const log of aiRequestLogs) {
    if (!byModel[log.model]) byModel[log.model] = { count: 0, totalLatency: 0 };
    byModel[log.model].count++;
    byModel[log.model].totalLatency += log.latencyMs;

    if (!byContext[log.context]) byContext[log.context] = { count: 0, totalLatency: 0 };
    byContext[log.context].count++;
    byContext[log.context].totalLatency += log.latencyMs;
  }

  const formatGroup = (group: Record<string, { count: number; totalLatency: number }>) =>
    Object.fromEntries(
      Object.entries(group).map(([k, v]) => [k, { count: v.count, avgLatencyMs: Math.round(v.totalLatency / v.count) }]),
    );

  return {
    totalRequests: total,
    successRate: Math.round((successes / total) * 100) / 100,
    avgLatencyMs: Math.round(totalLatency / total),
    byModel: formatGroup(byModel),
    byContext: formatGroup(byContext),
  };
}
