import { timingSafeEqual } from 'node:crypto';
import { collectDefaultMetrics, Counter, Histogram, Gauge, Registry } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

export const register = new Registry();

// Collect default Node.js metrics (event loop lag, memory, CPU, etc.)
collectDefaultMetrics({ register });

// Custom counter: total HTTP requests
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status_code'] as const,
  registers: [register],
});

// Custom histogram: HTTP request duration
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// Custom gauge: active queue jobs
export const queueJobsActive = new Gauge({
  name: 'queue_jobs_active',
  help: 'Number of currently active jobs per queue',
  labelNames: ['queue_name'] as const,
  registers: [register],
});

// Custom histogram: database query duration
export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

// Custom histogram: external integration request duration
export const integrationRequestDuration = new Histogram({
  name: 'integration_request_duration_seconds',
  help: 'Duration of external integration requests in seconds',
  labelNames: ['provider'] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
});

// Custom gauge: currently running validation checks
export const validationChecksRunning = new Gauge({
  name: 'validation_checks_running',
  help: 'Number of currently running validation check sets',
  registers: [register],
});

export const documentOcrRunsTotal = new Counter({
  name: 'document_ocr_runs_total',
  help: 'Local OCR attempts by outcome',
  labelNames: ['outcome'] as const,
  registers: [register],
});

export const documentOcrPagesTotal = new Counter({
  name: 'document_ocr_pages_total',
  help: 'PDF pages rendered for local OCR',
  registers: [register],
});

export const documentOcrDuration = new Histogram({
  name: 'document_ocr_duration_seconds',
  help: 'End-to-end local OCR duration',
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  registers: [register],
});

/**
 * Entrega de alerta ao canal externo, por desfecho.
 *
 * Existe porque a tabela `alerts` acumulou 6.349 registros com ZERO entregues
 * ao Chat, e nada no sistema expunha isso: a deteccao funcionava e o aviso
 * morria na saida. Um contador de `failed` subindo enquanto `sent` fica parado
 * e o sinal de que o canal esta morto.
 */
export const alertDeliveryTotal = new Counter({
  name: 'alert_delivery_total',
  help: 'Alert deliveries to the external channel by outcome',
  labelNames: ['channel', 'outcome'] as const,
  registers: [register],
});

/**
 * Resposta da IA que veio fora do contrato JSON.
 *
 * A chamada em si e registrada como sucesso em `ai_usage_log` (o modelo
 * respondeu; o parse e que falhou depois), entao sem este contador a telemetria
 * mostra 100% de sucesso enquanto documentos ficam com todos os campos vazios.
 */
export const aiContractViolationsTotal = new Counter({
  name: 'ai_contract_violations_total',
  help: 'AI responses that were not usable JSON, by context and reason',
  labelNames: ['context', 'reason'] as const,
  registers: [register],
});

/**
 * Tamanho do prompt de extracao, em tokens estimados.
 *
 * Medicao de 17/08: das 22 extracoes de invoice, as 10 com prompt acima de 10k
 * tokens falharam TODAS; as de prompt normal passaram. Sem esta serie a
 * correlacao so aparece cavando o banco a mao.
 */
export const aiPromptTokens = new Histogram({
  name: 'ai_prompt_tokens',
  help: 'Estimated prompt size per AI extraction call',
  labelNames: ['context'] as const,
  buckets: [500, 1000, 2500, 5000, 10000, 20000, 40000, 80000],
  registers: [register],
});

/**
 * Rotulo `path` das series HTTP.
 *
 * Ate 29/08 o rotulo era o caminho da requisicao normalizado por expressao
 * regular: so segmento numerico e UUID viravam `:id`. Como `metricsMiddleware`
 * roda ANTES de qualquer roteamento e de qualquer autenticacao, e `/api` e
 * proxiado pelo edge, bastava pedir `/api/aaa1`, `/api/aaa2`, ... para criar
 * uma serie nova por valor — permanente, sem autenticacao, num container de
 * 512M. Cardinalidade ilimitada e memoria que nunca volta.
 *
 * Agora o rotulo vem da rota REGISTRADA no Express (`req.baseUrl` do router
 * montado + `req.route.path` do handler que casou), o que limita o conjunto de
 * valores ao numero de rotas do codigo. Requisicao que nao casa com nenhuma
 * rota — 404, middleware puro, arquivo estatico — cai num unico rotulo
 * `unknown`, entao N caminhos desconhecidos produzem UMA serie, nao N.
 *
 * Le-se dentro do `finish`: o handler responde e retorna sem chamar `next()`,
 * entao a pilha do router nao desempilha e `baseUrl`/`route` continuam valendo
 * o que valiam no handler.
 */
function routeLabel(req: Request): string {
  const rawPath = req.route?.path as string | string[] | RegExp | undefined;
  const routePath = Array.isArray(rawPath) ? rawPath[0] : rawPath;
  if (typeof routePath !== 'string') return 'unknown';

  const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  const label = routePath === '/' ? base : `${base}${routePath}`;
  return label || 'unknown';
}

/**
 * Express middleware that instruments every request with Prometheus metrics.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer();

  res.on('finish', () => {
    const path = routeLabel(req);
    httpRequestsTotal.inc({
      method: req.method,
      path,
      status_code: String(res.statusCode),
    });
    end({ method: req.method, path });
  });

  next();
}

/**
 * Comparacao de token em tempo constante.
 *
 * Usada pelo gate do endpoint `/metrics`. Tamanhos diferentes sao recusados
 * antes do `timingSafeEqual` — que lanca quando os buffers divergem em tamanho
 * — e isso vaza apenas o comprimento, nunca o conteudo.
 */
export function safeTokenEquals(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected) return false;

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
