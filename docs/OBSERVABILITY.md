# Observability

Ultima atualizacao: 2026-06-17

## Controles Existentes

- Endpoint de saude da API: `/health` e `/health/ready`.
- Endpoint Prometheus: `/metrics`.
- Logs Pino na API.
- Correlation ID em requests.
- Queue stats em endpoint admin.
- Alertas internos via modulo `alerts`.
- Google Chat webhook opcional.
- Sentry opcional via `SENTRY_DSN`.
- AI governance com logging de requisicoes/custos.

Evidencias:

- `README.md`
- `apps/api/src/modules/health/routes.ts`
- `apps/api/src/shared/observability`
- `apps/api/src/modules/ai/governance.ts`
- `apps/api/src/modules/ai/cost-tracker.ts`
- `docker-compose.prod.yml`

## Sinais Criticos

- API readiness.
- DB connectivity.
- Redis connectivity.
- Fila pg-boss.
- Falhas de cron/job.
- Latencia de IA.
- Custo mensal de IA.
- Falhas de email ingestion.
- Falhas de upload/extracao.
- Falhas de certificacao e relatorio.

## Gaps

- Dashboards Prometheus/Grafana nao estao documentados no repo.
- SLO/SLI ainda nao formalizados.
- Alertas externos precisam de runbook por severidade.
- Retencao de logs e politica de PII precisam de decisao formal.

## Recomendacao

Criar dashboard minimo:

- Request rate, error rate, latency p95.
- DB pool/latencia.
- Redis availability.
- Jobs por status.
- AI calls, latency, budget.
- Uploads/extractions por status.
