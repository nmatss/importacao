# Technical Debt

Ultima atualizacao: 2026-06-18

## Validacao E Comparativo

- Consolidar terminologia e persistencia entre aceite do checklist e aceite do comparativo documental.
- Extrair tipos/helpers duplicados de validacao para modulo compartilhado no frontend.
- Substituir/complementar a fixture representativa de `allChecks` por PDFs ou
  extracoes reais anonimizadas de INV/PL/OHBL/Draft BL quando o negocio liberar
  amostras. Em 2026-06-17 foi adicionada cobertura representativa sem mock de
  `allChecks`.
- Persistir contrato relacional para aceite do comparativo, em vez de depender apenas de evento de timeline.
- Ao revalidar, definir se aceites manuais devem sobreviver ao novo run quando a divergencia persistir.
- Fortalecer E2E do fluxo documental com upload multipart real, magic-byte
  negativo, preview/download, permissao admin para reprocess/delete, processo
  travado e validacao ponta a ponta usando as rotas reais.

## IA E Extracao

- Unificar helpers de `parseNumber`, `parseDate`, FOC e normalizacao entre parsers, harness, validation e anomalies.
- Documentar a decisao final de provider: IA local, Vertex ou estrategia hibrida.
- Revisar latencia e timeout do provider local em CPU.
- Decidir contrato final para falha de schema Zod da IA: manter fallback
  permissivo com trust downgrade explicito ou tornar extracao estrita por tipo
  de documento.
- Implementar classificador por conteudo para anexos genericos de e-mail que
  hoje chegam como `other` quando nome/contexto nao resolvem tipo.
- Deduplicar reprocessamentos concorrentes com update condicional atomico,
  `SELECT FOR UPDATE` ou singleton por `documentId` na fila.

## Banco E Dados

- Criar documento de indices por tabela e queries criticas.
- Auditar indices redundantes e queries com risco de full scan.
- Avaliar historizacao e origem por campo para dados projetados no card do processo.
- Padronizar query keys do frontend com `processKeys`, `documentKeys`, `followUpKeys` e equivalentes de validacao.
- Unificar cache de `/api/documents/process/:id/comparison` entre comparativo e Draft BL.
- Avaliar invalidação granular de aceite manual/comparativo derivado quando
  `aiExtractedData` for reconstruído por delete/reprocessamento de documento.

## DevOps E Operacao

- Corrigir warnings conhecidos do script de backup para volumes ausentes.
- Adicionar alerta externo para falha do `scripts/restore-test.sh` e medir RTO em
  execucao recorrente. Restore manual e cron semanal validados em 2026-06-17.
- Evoluir autorizacao fina do proxy `/cert-api/`: hoje o Nginx exige JWT valido
  antes de injetar `X-API-Key`, mas a separacao por papel/escopo do modulo de
  certificacoes deve ser definida com o negocio.
- Resolver residuais de `npm audit` moderados sem downgrade inseguro: raiz do
  workspace com 11 moderadas; builder Docker da API com 8 moderadas de
  dev/tooling; runtime Docker da API sem vulnerabilidades em
  `npm audit --omit=dev --audit-level=high`. Pendencias principais:
  `drizzle-kit` via `@esbuild-kit/*`/`esbuild`, `@opentelemetry/*` transitivo do
  Sentry e `testcontainers` 11 via `dockerode`/`uuid` (v12 exige Node 22.19+ e
  quebrou E2E local em Node 20).

## Frontend

- Migrar modais especificos restantes de Settings e Agendamentos para Dialog
  compartilhado com foco inicial, trap, Escape, `aria-describedby` e restore
  focus. Modal de e-mail de correcao foi coberto em 2026-06-17; `ConfirmDialog`
  compartilhado foi coberto em 2026-06-18.
- Fortalecer formularios de Settings, Communications e CertCadastro com Zod/RHF,
  erros por campo, trim, validacao de URL/e-mail/porta/PDF e testes de conexao
  quando aplicavel.
- Criar experiencia mobile dedicada para tabelas largas e kanban operacional
  (cards por breakpoint, colunas prioritarias ou acordeoes), especialmente
  Cert Produtos, Pre-Cons, Email Ingestion e Follow-Up.
- Decidir se o checklist de Draft BL vira entidade auditavel ou permanece como anotacao local.

Concluido em 2026-06-18:

- Ordenacao acessivel na tabela de Produtos de Certificacoes com botoes focaveis
  e `aria-sort`.
- Estados acessiveis (`aria-pressed`, `role="switch"`, `aria-checked` e menu de
  tema) nos filtros/toggles visuais revisados.
- Upload de documentos acessivel com validacao client-side de extensao/tamanho e
  progresso semantico.
- Upload/reprocess/delete de documentos respeitam processo travado; extracoes
  com confianca menor que 40% ficam como evidencia, sem projecao operacional
  para validacao/espelho; comparativo e validacao usam documento vigente,
  processado, nao falho e acima do piso de confianca.
- Runbook/README reconciliados com `AI_PROVIDER=ialocal`, egress externo por
  opt-in e rollback rsync/snapshot sem `git checkout` no servidor.
- Rotas internas invalidas com fallback contextual em Importacao/Certificacoes.
- Linhas navegaveis por teclado nas tabelas operacionais revisadas.
- Validacao positiva/coerente em processos, cambios e cron de agendamentos.
