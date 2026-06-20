# Technical Debt

Ultima atualizacao: 2026-06-20

## Validacao E Comparativo

- Consolidar terminologia e persistencia entre aceite do checklist e aceite do comparativo documental.
- Extrair tipos/helpers duplicados de validacao para modulo compartilhado no frontend.
- Substituir/complementar a fixture representativa de `allChecks` por PDFs ou
  extracoes reais anonimizadas de INV/PL/OHBL/Draft BL quando o negocio liberar
  amostras. Em 2026-06-17 foi adicionada cobertura representativa sem mock de
  `allChecks`.
- Persistir contrato relacional para aceite do comparativo, em vez de depender apenas de evento de timeline.
- Ao revalidar, definir se aceites manuais devem sobreviver ao novo run quando a divergencia persistir. Em 2026-06-19 a validacao final passou a ter `validation_runs` canonico, mas a reutilizacao de aceite ainda precisa de politica por hash de evidencia.
- Fortalecer E2E do fluxo documental com upload multipart real, magic-byte
  negativo, preview/download, permissao admin para reprocess/delete, processo
  travado e validacao ponta a ponta usando as rotas reais.
- Tornar o intake por e-mail idempotente antes do ack/mark-as-read: hoje a
  auditoria indica risco de mensagem marcada como lida antes do processamento
  completo em caso de crash entre leitura e upload/processamento.

## IA E Extracao

- Unificar helpers de `parseNumber`, `parseDate`, FOC e normalizacao entre parsers, harness, validation e anomalies.
- Documentar a decisao final de provider: IA local, Vertex ou estrategia hibrida.
- Revisar latencia e timeout do provider local em CPU para PDFs imagem-only:
  em 2026-06-18 a Invoice KIOM foi resolvida por parser deterministico, mas a
  chamada multimodal ao gateway local ainda pode bater `Headers Timeout Error`
  em ~300s quando realmente precisar de VLM/OCR.
- Implementar classificador por conteudo para anexos genericos de e-mail que
  hoje chegam como `other` quando nome/contexto nao resolvem tipo.
- Deduplicar reprocessamentos concorrentes com update condicional atomico,
  `SELECT FOR UPDATE` ou singleton por `documentId` na fila.

## Banco E Dados

- Criar documento de indices por tabela e queries criticas.
- Auditar indices redundantes e queries com risco de full scan.
- Sydle: obter catalogo/permissao ou view/API consolidada para dados
  complementares de compra/pagamento internacional, com fixture sanitizada e
  testes de normalizacao antes de ativar campos sensiveis adicionais.
- Avaliar historizacao e origem por campo para dados projetados no card do processo.
- Padronizar query keys do frontend com `processKeys`, `documentKeys`, `followUpKeys` e equivalentes de validacao.
- Unificar cache de `/api/documents/process/:id/comparison` entre comparativo e Draft BL.
- Avaliar invalidação granular de aceite manual/comparativo derivado quando
  `aiExtractedData` for reconstruído por delete/reprocessamento de documento.

## DevOps E Operacao

- Corrigir warnings conhecidos do script de backup para volumes ausentes.
- Adicionar alerta externo para falha do `scripts/restore-test.sh` e medir RTO em
  execucao recorrente. Restore manual e cron semanal validados em 2026-06-17.
- Evoluir autorizacao fina do proxy `/cert-api/`: em 2026-06-20 o Nginx passou
  a exigir admin via `/api/auth/cert-api-access` antes de injetar `X-API-Key`.
  Ainda falta separar escopos como `cert.read`, `cert.write`, `cert.sync` e
  `cert.admin` quando o negocio definir usuarios leitores/escritores.
- Formalizar frescor minimo do estoque: o relatorio `Estoque Detalhado` exporta
  o cache `cert_stock`; se `/api/sync-stock` falhar parcialmente, WMS e
  e-commerce podem ter timestamps diferentes. Em 2026-06-19 o XLSX passou a
  expor `Sincronizado em`, mas ainda falta politica/SLA de bloqueio por dado
  velho.
- Harmonizar limpeza de estoque entre fontes: WMS apaga/reinsere `wms_biguacu`,
  mas e-commerce faz upsert sem remover SKUs que desapareceram da origem.
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
- Extrações processadas sem dado útil deixaram de contar como documento lido e
  novas respostas vazias da IA passam a virar falha de extração com alerta.
- Filas `pg-boss` agora sao criadas idempotentemente no boot da API antes de
  enviar jobs, evitando `ai-extraction` silenciosamente descartado por fila
  inexistente.
- Parser deterministico de Invoice cobre o layout compacto KIOM com campos e
  itens colados, total FOB, portos, data `CI DATE` e FREE OF CHARGE recorrente.
- Runbook/README reconciliados com `AI_PROVIDER=ialocal`, egress externo por
  opt-in e rollback rsync/snapshot sem `git checkout` no servidor.
- Rotas internas invalidas com fallback contextual em Importacao/Certificacoes.
- Linhas navegaveis por teclado nas tabelas operacionais revisadas.
- Validacao positiva/coerente em processos, cambios e cron de agendamentos.

Concluido em 2026-06-19:

- Falha de schema Zod da IA manteve fallback permissivo com downgrade explicito:
  `_trust.contractFailure` e confianca capada abaixo de 40%.
- Validacao parcial automatica deixou de executar efeitos finais; validacao
  final ganhou check `document-set-completeness`.
- `validation_runs` passou a ser entidade canonica vinculada a resultados,
  historico e correcoes.
- Historico de extracao deixou de depender de `ON DELETE CASCADE` do documento;
  delete arquiva a extracao com metadados antes da remocao.
- SYDLE mitigou riscos internos de cursor, matching, CSV truncado, acesso amplo
  e `raw_payload` sensivel.
- Relatorio de estoque detalhado passou a filtrar marca por
  `COALESCE(cp.brand, cs.brand)` normalizado, preservar WMS em filtros por marca,
  retornar erro claro para `cert-reports` sem permissao e expor `Sincronizado em`.
- Dockerfiles API/Web passaram a usar contexto raiz, manifests de workspaces e
  `npm ci --ignore-scripts` com `HUSKY=0`; E2E de documentos teve timeout local
  alinhado ao Vitest 4.
