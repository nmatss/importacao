# Technical Debt

Ultima atualizacao: 2026-06-17

## Validacao E Comparativo

- Consolidar terminologia e persistencia entre aceite do checklist e aceite do comparativo documental.
- Extrair tipos/helpers duplicados de validacao para modulo compartilhado no frontend.
- Criar fixtures de integracao de `runAllChecks` com INV/PL/OHBL reais, sem mock de `allChecks`.
- Avaliar Draft BL como fonte parcial/fallback quando OHBL ainda nao existe.
- Persistir contrato relacional para aceite do comparativo, em vez de depender apenas de evento de timeline.
- Ao revalidar, definir se aceites manuais devem sobreviver ao novo run quando a divergencia persistir.

## IA E Extracao

- Unificar helpers de `parseNumber`, `parseDate`, FOC e normalizacao entre parsers, harness, validation e anomalies.
- Documentar a decisao final de provider: IA local, Vertex ou estrategia hibrida.
- Atualizar docs historicos que ainda descrevem Vertex como estado atual quando for decidido o padrao definitivo.
- Revisar latencia e timeout do provider local em CPU.

## Banco E Dados

- Criar documento de indices por tabela e queries criticas.
- Auditar indices redundantes e queries com risco de full scan.
- Avaliar historizacao e origem por campo para dados projetados no card do processo.
- Padronizar query keys do frontend com `processKeys`, `documentKeys`, `followUpKeys` e equivalentes de validacao.
- Criar endpoint/filtro backend para logs de e-mail por processo, evitando busca global limitada a 50 registros.
- Unificar cache de `/api/documents/process/:id/comparison` entre comparativo e Draft BL.
- Ao deletar/reprocessar documento, limpar ou recalcular `aiExtractedData` por tipo e invalidar comparativo/espelho derivado.

## DevOps E Operacao

- Resolver `.env.sops.yaml` em producao para reduzir dependencia de `.env` manual.
- Corrigir warnings conhecidos do script de backup para volumes ausentes.
- Automatizar `scripts/restore-test.sh` com crontab/alerta e medir RTO em execucao
  recorrente. Restore manual validado em 2026-06-17.
- Resolver residuais de `npm audit` moderados sem downgrade inseguro: `drizzle-kit` via `@esbuild-kit/*`/`esbuild`, `@opentelemetry/*` transitivo do Sentry, `js-yaml`, `protobufjs` e `testcontainers` 11 via `dockerode`/`uuid` (v12 exige Node 22.19+ e quebrou E2E local em Node 20).

## Frontend

- Melhorar focus trap/Escape nos modais.
- Revisar `contentEditable` de email para salvar conteudo atual antes de save/send mesmo sem blur.
- Melhorar ordenacao acessivel nas tabelas de Certificacoes/Produtos com botoes/`aria-sort`.
- Adicionar estado acessivel (`aria-pressed`, `role="switch"` ou equivalente) aos toggles/filtros visuais restantes.
- Decidir se o checklist de Draft BL vira entidade auditavel ou permanece como anotacao local.
